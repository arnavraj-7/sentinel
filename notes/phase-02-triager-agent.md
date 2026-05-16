# Phase 2 — Triager Agent (Real LLM)

> **Status:** Complete — 5/5 fast tests passing, 3 integration tests passing manually.
>
> **Duration:** 1 session
>
> **Deliverable:** Gemini 2.5 Flash reads live metrics + logs from the simulated lab,
> classifies the failure category, and returns a typed `TriagerFindings` object — not
> free text — stored in graph state for downstream agents.

---

## 1. WHY this phase exists

The Phase 0 triager was a stub — it just echoed the alert back. That was fine for proving
the plumbing worked. But a real SRE copilot needs to actually *reason* about the incident.

Phase 2 answers: **how do you get an LLM to produce structured, usable output instead of
a wall of text?** And: **how do you give the LLM real context before asking it to reason?**

Both of these are fundamental to every production AI agent. The pattern here —
fetch context → build prompt → LLM with structured output → store typed result —
repeats in every agent we build from Phase 3 onwards.

---

## 2. WHAT we built — file by file

```
src/sentinel/agents/
├── state.py          ← added FailureCategory, TriagerFindings, triager_findings in state
├── triager.py        ← NEW: fetches lab data, calls Gemini, returns TriagerFindings
└── graph.py          ← swapped stub node for real triager_node

src/sentinel/
├── config.py         ← added google_project, lab_base_url
└── api/incidents.py  ← IncidentResponse now includes triager_findings

tests/
├── test_graph_hello.py  ← marked as @pytest.mark.integration
└── test_health.py       ← marked as @pytest.mark.integration (incident endpoint test)

pyproject.toml        ← added langchain-google-genai, integration marker, addopts
.env.example          ← added SENTINEL_GOOGLE_PROJECT
```

---

## 3. WHAT — the full data flow

```
POST /incidents (alert: api-gateway, crash_loop)
        ↓
triager_node(state) runs
        ↓
_fetch_context("api-gateway")
  → GET /lab/services/api-gateway/metrics  → { cpu: 5%, error: 100%, uptime: 12s }
  → GET /lab/services/api-gateway/logs     → ["panic: nil pointer", "process exited"...]
        ↓
Build prompt with alert + metrics + logs
        ↓
Gemini 2.5 Flash (structured output mode)
        ↓
TriagerFindings(
    failure_category = "crash_loop",
    summary = "api-gateway is in a crash loop due to nil pointer panic",
    affected_services = ["api-gateway"],
    recommended_actions = ["Investigate nil pointer in logs", "Roll back deployment"]
)
        ↓
AgentNote written → stored in state["notes"] via reducer
TriagerFindings → stored in state["triager_findings"]
        ↓
HTTP response includes both
```

---

## 4. HOW — new concepts this phase

### Google Auth — Application Default Credentials (ADC)

Vertex AI / Gemini on GCP doesn't use API keys. It uses **Application Default Credentials**:
your Google account acts as the identity. When you run:

```powershell
gcloud auth application-default login
```

Google saves a credential file at:
`C:\Users\{you}\AppData\Roaming\gcloud\application_default_credentials.json`

Every Google Python SDK automatically finds and uses this file. You don't pass it anywhere
in your code — it just works. This is called ADC.

**Quota project matters:** ADC requires a billing project for rate limits and costs. Set it
with:
```powershell
gcloud auth application-default set-quota-project sentinel-496513
```

If you don't set this, API calls either fail or get billed to the wrong project.

**In production:** instead of your personal login, you'd use a **service account** — a
non-human Google identity created specifically for an app. Local dev uses ADC, prod uses
service accounts.

---

### `ChatGoogleGenerativeAI` — the LLM wrapper

```python
from langchain_google_genai import ChatGoogleGenerativeAI

llm = ChatGoogleGenerativeAI(
    model="gemini-2.5-flash",
    project=settings.google_project,
    temperature=0,        # 0 = deterministic, no creativity, best for classification
)
```

`temperature=0` is important for a triager — you want consistent, reliable classification,
not creative variation. Use `temperature > 0` only for generative tasks like writing
post-mortems.

This is a **LangChain chat model** — the same interface works for OpenAI, Anthropic, Mistral
etc. Swapping models means changing one import and one constructor. The rest of your code
is unchanged.

---

### `.with_structured_output()` — the most important pattern in production AI

Without structured output, the LLM returns a string. You'd have to parse it yourself —
fragile, breaks on formatting changes, hard to type.

With structured output, you pass a Pydantic schema and the LLM is *forced* to return
valid JSON matching that schema:

```python
class TriagerFindings(BaseModel):
    failure_category: FailureCategory
    summary: str
    affected_services: list[str]
    recommended_actions: list[str]

structured_llm = llm.with_structured_output(TriagerFindings)

result = await structured_llm.ainvoke("classify this incident...")
# result is a TriagerFindings object — not a string
result.failure_category   # FailureCategory.CRASH_LOOP
result.summary            # "api-gateway is crashing due to..."
```

Under the hood, LangChain converts your Pydantic schema to a JSON Schema, sends it to
Gemini as a "function definition", and Gemini's function-calling mode guarantees it only
returns JSON matching that shape. Pydantic then validates and constructs the object.

**Why this matters:** Every downstream agent (Root-Cause Analyst, Runbook Planner) can
access `state["triager_findings"].failure_category` as a typed Python value — no parsing,
no "what if the LLM said something unexpected."

**Interview answer:** "I use `.with_structured_output(PydanticModel)` to force LLMs to
return typed objects. It uses function-calling under the hood, so the LLM can't return
free text — it must fill in the schema fields. This eliminates output parsing code and
makes agent-to-agent data passing type-safe."

---

### `NotRequired` in TypedDict

```python
from typing import NotRequired
from typing_extensions import TypedDict

class IncidentState(TypedDict):
    incident_id: str
    input: IncidentInput
    notes: Annotated[list[AgentNote], add]
    triager_findings: NotRequired[TriagerFindings | None]  # can be absent
    done: bool
```

Regular `TypedDict` fields are required — you must include them when building the dict.
`NotRequired[X]` means the key can be completely absent. Used for fields that don't exist
at the start of the graph and only appear after a specific node runs.

```python
# Initial state — no triager_findings key at all, that's fine
initial: IncidentState = {
    "incident_id": incident_id,
    "input": payload,
    "notes": [],
    "done": False,
}

# After triager runs, the key exists
final_state["triager_findings"]  # TriagerFindings object
```

---

### Fetching context in a node — httpx inside async functions

```python
async def _fetch_context(service: str) -> tuple[dict, list]:
    async with httpx.AsyncClient(base_url=settings.lab_base_url, timeout=10.0) as client:
        metrics = (await client.get(f"/lab/services/{service}/metrics")).json()
        logs = (await client.get(f"/lab/services/{service}/logs")).json()
    return metrics, logs
```

`httpx.AsyncClient` is the async version of the `requests` library. Key details:
- `async with` — the client manages a connection pool. Open it, use it, close it.
- `timeout=10.0` — always set a timeout. Without it, a hanging lab service would hang
  the whole agent indefinitely.
- `base_url` — set once on the client, then use relative paths (`/lab/...`).

This pattern — "fetch context, then reason" — is how every real agent works. The LLM
is useless without data. Your job as the agent designer is to decide *what data* to fetch
and *how to present it* in the prompt.

---

### Prompt design — what matters

```python
prompt = f"""You are an SRE triager. An alert has fired.
Analyse the data below and classify the incident.

ALERT
-----
Service  : {payload.service}
Message  : {payload.message}
Severity : {payload.severity.value}

CURRENT METRICS
---------------
CPU          : {metrics['cpu_pct']}%
...

VALID FAILURE CATEGORIES
-------------------------
{", ".join(c.value for c in FailureCategory)}

Classify this incident. Base your answer strictly on the data above."""
```

Three things that make this prompt work:

1. **Role first** — "You are an SRE triager" sets the reasoning frame before any data.
2. **Structured sections** — headers and separators help the LLM parse the input.
3. **List valid categories explicitly** — don't make the LLM guess what values are valid.
   The `with_structured_output` schema enforces the enum, but listing them in the prompt
   also improves accuracy.
4. **"Base your answer strictly on the data above"** — reduces hallucination. Without this,
   the LLM might invent facts not in the data.

---

### Integration test markers — the right test split

When a node calls an LLM or external HTTP service, it can't run in fast unit tests.
The solution: a pytest marker that excludes such tests by default.

```toml
# pyproject.toml
[tool.pytest.ini_options]
addopts = "-m 'not integration'"   # skip integration tests unless asked
markers = ["integration: requires real LLM / external services"]
```

```python
# In test files
@pytest.mark.integration
async def test_triager_node_produces_note_and_marks_done() -> None:
    """Requires: lab server on localhost:8000 + valid GCP credentials."""
    ...
```

```powershell
pytest           # runs fast tests only (5 tests, <1s)
pytest -m integration  # runs LLM tests (requires server + credentials)
```

In CI/CD you'd have two jobs:
- **PR checks:** `pytest` — fast, no credentials needed, runs on every push
- **Nightly/pre-release:** `pytest -m integration` — slow, needs secrets, runs less often

---

## 5. MISTAKES & GOTCHAS

### ❌ In-memory state dies on server restart

**Symptom:** You inject `crash_loop`, make code changes, server hot-reloads, you trigger
an incident — Gemini sees healthy metrics and classifies as `unknown`.

**Root cause:** The lab registry lives in RAM. `uvicorn --reload` restarts the Python
process, wiping the registry. Every restart = all services back to healthy.

**Fix:** Inject the failure immediately before triggering the incident. Don't touch code
files between inject and invoke.

**Production lesson:** In-memory state is ephemeral. For production, the lab would use
a real database. Any state that must survive a restart must be persisted.

---

### ❌ Service name in test doesn't exist in the lab

**Symptom:** `TypeError: string indices must be integers, not 'str'` in triager node.

**Root cause:** Test used service `"checkout"` which doesn't exist in the lab. The lab's
`GET /lab/services/checkout/metrics` returned `{"detail": "unknown service 'checkout'"}`.
The triager tried to iterate over that error JSON as a list of log lines — `entry` was
a character, not a dict.

**Fix:** Use only valid service names: `api-gateway`, `auth-service`, `payment-service`,
`db-proxy`, `cache-service`, `cert-manager`.

**Broader lesson:** Always validate tool inputs before using the result. The triager should
check the HTTP status code before calling `.json()` and trusting the result.

---

### ❌ PowerShell eating JSON in curl.exe calls

**Symptom:** `json_invalid`, `Could not resolve host: unreachable`, args being split.

**Root cause:** curl.exe is a native executable. PowerShell splits arguments on spaces
and mangles escape sequences differently from bash.

**Fix:** Use `Invoke-RestMethod` instead — PowerShell's native HTTP client handles JSON
without any escaping:
```powershell
$body = @{ key = "value" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://... -ContentType "application/json" -Body $body
```

Or if you must use curl, quote the variable: `-d "$body"`.

---

### ❌ Quota project billed to wrong GCP project

**Symptom:** API calls succeed but credits are deducted from a different project.

**Root cause:** ADC quota project defaulted to a previous project (e.g. `orbi-491507`).

**Fix:**
```powershell
gcloud auth application-default set-quota-project sentinel-496513
```

Always check the quota project line in the ADC output after login.

---

## 6. INTERVIEW Q&A

### Q: What is `.with_structured_output()` and why use it over parsing LLM text?
**A:** `.with_structured_output(PydanticModel)` uses the LLM's function-calling mode to
guarantee the response matches a JSON schema — converted from the Pydantic model. The LLM
physically cannot return free text; it must fill in the schema fields. The result is a
typed Python object, not a string. This eliminates all output parsing code and makes
downstream code type-safe. Parsing free text is fragile — any formatting change breaks
it. Function-calling mode is stable and validated by Pydantic on the way in.

### Q: What is Application Default Credentials and why does it matter?
**A:** ADC is Google's mechanism for finding credentials without hardcoding them. The SDK
checks a priority chain: env var → well-known file (from `gcloud auth application-default
login`) → service account metadata. Code never contains credentials — the environment
provides them. In local dev you use your personal login via gcloud. In production you
use a service account attached to the VM or container. The same code works in both
environments with no changes.

### Q: Why set `temperature=0` for a classifier agent?
**A:** Temperature controls randomness in generation. At 0, the model always picks the
highest-probability token — output is deterministic and consistent. At higher temperatures,
the model samples more creatively. For classification (triager, severity assessment) you
want the same incident to always produce the same category — temperature=0. For creative
tasks (post-mortem summaries, runbook prose) a small temperature (0.3-0.7) produces
better writing.

### Q: How do you test code that calls an LLM without spending money on every test run?
**A:** Separate tests into tiers with pytest markers. Fast unit/integration tests run by
default and never touch external services. LLM tests are marked `@pytest.mark.integration`
and excluded by default via `addopts = "-m 'not integration'"` in pytest config. Integration
tests only run manually (or in a separate nightly CI job) when you explicitly pass
`-m integration`. In practice you'd also add a mock LLM (LangChain provides
`FakeListChatModel`) for unit-level agent logic tests.

### Q: Why does the triager fetch context from the lab instead of just using the alert?
**A:** The alert only contains what the alerting system detected — service name, a message,
severity. That's insufficient for root cause classification. The triager needs to know:
what are the current CPU, memory, latency, and error metrics? What do the logs actually
say? A crash loop and a DB pool exhaustion can both produce "service unreachable" alerts
but require completely different remediation. Fetching live metrics and logs is what gives
the LLM the data to distinguish them. "Fetch context, then reason" is the universal
pattern for grounded LLM agents.

### Q: What is `NotRequired` in a TypedDict and when do you use it?
**A:** `NotRequired[T]` marks a TypedDict field as optional — the key can be completely
absent from the dict. Use it for fields that don't exist at graph initialization and only
appear after a specific node runs. Without it, you'd have to include every field in every
initial state dict (as `None`), which is verbose and misleading. `NotRequired` makes the
TypedDict accurately describe what's actually in the dict at each stage of the graph.

---

## 7. COMMANDS CHEAT SHEET

```powershell
# Activate venv
.\.venv\Scripts\Activate.ps1

# Run fast tests only (default)
pytest -v

# Run integration tests (requires server + credentials)
pytest -m integration -v

# Start server
uvicorn sentinel.main:app --reload

# Inject failure then immediately trigger incident (PowerShell)
Invoke-RestMethod -Method Post `
    -Uri http://localhost:8000/lab/services/api-gateway/inject `
    -ContentType "application/json" `
    -Body '{"mode": "crash_loop"}'

$body = @{
    alert_id = "a-001"
    service = "api-gateway"
    message = "service unreachable liveness probe failing"
    severity = "high"
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:8000/incidents `
    -ContentType "application/json" -Body $body | ConvertTo-Json -Depth 5

# Check GCP auth
gcloud auth application-default print-access-token
gcloud config get project
```

---

## 8. WHAT'S NEXT

**Phase 3 — Parallel Investigators**

Three specialist agents run in parallel after the triager:

- **Log Detective** — deep-dives into log patterns, finds error sequences and timings
- **Metric Analyst** — analyses metric trends, identifies anomalies and correlations
- **Topology Mapper** — checks which services depend on the failing one, maps blast radius

New LangGraph concepts:
- `add_conditional_edges` — fan out to multiple nodes based on state
- Parallel node execution — LangGraph runs them concurrently
- Joining parallel results — all three write to `notes` via the reducer

New LLM concepts:
- Each agent gets a specialist prompt (not a generalist one)
- Agents read `triager_findings` from state to focus their investigation
- The reducer merges all three agents' notes into one list automatically
