# Phase 3 — Parallel Investigators

> **Status:** Complete — all three investigators running in parallel, verified live with Gemini.
>
> **Duration:** 1 session
>
> **Deliverable:** Three specialist agents (log_detective, metric_analyst, topology_mapper)
> fan out in parallel from a supervisor routing function, each fetching its own data,
> calling Gemini with a specialist persona, and returning structured findings with
> confidence scores that accumulate in shared graph state.

---

## 1. WHY this phase exists

The triager classifies the incident — crash loop, memory leak, etc. But classification alone
isn't enough for an SRE. You need a full picture: *what exactly do the logs say? what do the
metrics confirm? what's the blast radius?*

These three questions are independent — they don't need each other's answers. That makes them
perfect candidates for parallel execution. Running them sequentially would just be wasted time.

Phase 3 answers: **how do you fan out work to multiple specialized agents in parallel, then
merge their results back into a single shared state?**

---

## 2. WHAT we built — file by file

```
src/sentinel/agents/
├── investigators.py   ← NEW: three investigator nodes + shared runner
├── supervisor.py      ← NEW: routing function that returns list[Send]
├── graph.py           ← UPDATED: add_conditional_edges replaces add_node("supervisor")
├── state.py           ← UPDATED: InvestigatorFindings model + reducer on state
└── triager.py         ← unchanged

src/sentinel/api/
└── incidents.py       ← UPDATED: investigator_findings in IncidentResponse
```

---

## 3. HOW it works — concept by concept

### 3a. The `Send` API — dynamic fan-out

LangGraph has two ways to wire up edges:

| Method | When to use |
|---|---|
| `add_edge(A, B)` | Always go from A to B |
| `add_conditional_edges(A, fn)` | Let `fn` decide which nodes to run next |

When `fn` returns a `list[Send]`, LangGraph fans out and runs all of them **in parallel**:

```python
from langgraph.types import Send

def supervisor_node(state: IncidentState) -> list[Send]:
    agents = _CATEGORY_AGENTS[state["triager_findings"].failure_category]
    return [Send(agent_name, state) for agent_name in agents]
```

`Send(node_name, state)` says: "run this node, give it this state." Multiple Sends =
multiple parallel branches.

**Key rule: a function that returns `list[Send]` is NOT a node.** It's a routing function
passed as the second argument to `add_conditional_edges`. If you register it with
`add_node` instead, LangGraph throws:

```
InvalidUpdateError: Expected dict, got [Send(node='log_detective', ...)]
```

Because nodes must return state dicts — only routing functions return Send objects.

### 3b. The routing table

The supervisor doesn't ask Gemini which investigators to run — it's a deterministic lookup
table based on the triager's failure category:

```python
_CATEGORY_AGENTS: dict[FailureCategory, list[str]] = {
    FailureCategory.MEMORY_LEAK:        ["log_detective", "metric_analyst"],
    FailureCategory.CRASH_LOOP:         ["log_detective", "metric_analyst", "topology_mapper"],
    FailureCategory.LATENCY_SPIKE:      ["log_detective", "metric_analyst", "topology_mapper"],
    FailureCategory.SURGE_5xx:          ["log_detective", "metric_analyst"],
    FailureCategory.DB_POOL_EXHAUSTION: ["metric_analyst", "topology_mapper"],
    FailureCategory.CERT_EXPIRY:        ["metric_analyst", "topology_mapper"],
    FailureCategory.UNKNOWN:            ["log_detective", "metric_analyst", "topology_mapper"],
}
```

Why not LLM? Because this routing logic is deterministic engineering knowledge —
cert_expiry never shows up in app logs, db_pool_exhaustion always affects topology.
LLMs add latency, cost, and non-determinism. Use them where reasoning is needed;
use code where logic is clear.

### 3c. The shared runner — `_investigate()`

All three investigators follow the exact same pattern:
1. Fetch data from the lab (different endpoint per agent)
2. Build a user prompt with that data
3. Call Gemini with a specialist persona as the system prompt
4. Return `{"investigator_findings": [findings], "notes": [note]}`

Rather than copy-pasting this logic, a shared `_investigate()` function handles steps 3-4.
Each node only needs to fetch its data and build its prompt:

```python
async def _investigate(agent_name, system_prompt, user_content, state):
    messages = [SystemMessage(content=system_prompt), HumanMessage(content=user_content)]
    raw: _InvestigatorOutput = await _structured_llm.ainvoke(messages)
    findings = InvestigatorFindings(agent=agent_name, **raw.model_dump())
    note = AgentNote(agent=agent_name, content=f"[{findings.focus} | conf={findings.confidence:.0%}] {findings.summary}")
    return {"investigator_findings": [findings], "notes": [note]}
```

### 3d. Why `_InvestigatorOutput` is separate from `InvestigatorFindings`

`InvestigatorFindings` (in state.py) has an `agent` field. But the LLM shouldn't fill that in
— it doesn't know its own name (and we don't want to trust it to get it right).

`_InvestigatorOutput` is the LLM's schema: same fields minus `agent`. After the LLM responds,
we add `agent` programmatically:

```python
findings = InvestigatorFindings(agent=agent_name, **raw.model_dump())
```

### 3e. The `add` reducer — merging parallel results

When three parallel branches all write to `investigator_findings` at the same time, how does
LangGraph merge them without overwriting?

Answer: the `Annotated[list[InvestigatorFindings], add]` reducer in state.py. `add` is just
Python's `operator.add` — it appends lists together. So all three findings accumulate:

```python
investigator_findings: Annotated[list[InvestigatorFindings], add]
```

Without this annotation, LangGraph would pick one branch's result and discard the others.
The `notes` field uses the same pattern for the same reason.

### 3f. Specialist personas — `SystemMessage` vs `HumanMessage`

Each investigator gets a different `SystemMessage` that defines who it is:

```python
_LOG_DETECTIVE_SYSTEM = """You are the Log Detective, an expert SRE specialist in log analysis.
Your job: find error patterns, stack traces, crash sequences, and timing clues in raw logs..."""
```

The same `_structured_llm` instance is reused — the persona is injected per-call, not baked
into the LLM object. `SystemMessage` = persistent persona/instructions.
`HumanMessage` = the actual data to analyze.

### 3g. `httpx.AsyncClient` inside agent nodes

Each investigator node fetches its own data using httpx inside the node body, not in a
separate tool or pre-fetch step:

```python
async with httpx.AsyncClient(base_url=settings.lab_base_url, timeout=10.0) as client:
    logs = (await client.get(f"/lab/services/{service}/logs", params={"count": 20})).json()
```

This is the **pre-fetch pattern**: get the data, format it as text, put it in the prompt.
The alternative (ReAct tool-calling) lets the LLM decide when/what to fetch — more flexible
but more tokens, more latency, and harder to control. Pre-fetch is better when you know
exactly what data you need.

---

## 4. The graph structure after Phase 3

```
START
  ↓
triager
  ↓ (add_conditional_edges → supervisor_node)
  ├──────────────────────────────────────────────┐
  ↓                      ↓                       ↓
log_detective      metric_analyst         topology_mapper
  ↓                      ↓                       ↓
 END                    END                     END
           (findings accumulate via `add` reducer)
```

---

## 5. WHEN to use each pattern

| Pattern | Use when |
|---|---|
| Regular node (`add_node`) | Agent does work and returns a state dict |
| Routing function (`add_conditional_edges`) | Agent decides *which* nodes to run next |
| `Send` fan-out | Multiple independent tasks can run in parallel |
| `add` reducer | Multiple parallel branches write to the same list field |
| Lookup table routing | Routing logic is deterministic engineering knowledge |
| LLM routing | Routing requires genuine reasoning about ambiguous state |

---

## 6. Mistakes made (learn from these)

### Mistake 1: `supervisor_node` registered as a node
```python
# WRONG
builder.add_node("supervisor", supervisor_node)  # returns list[Send], not dict!
builder.add_edge("triager", "supervisor")
```
Error: `InvalidUpdateError: Expected dict, got [Send(node='log_detective', ...)]`

Fix: routing functions go in `add_conditional_edges`, not `add_node`.

```python
# CORRECT
builder.add_conditional_edges("triager", supervisor_node)
```

---

## 7. Interview questions this phase prepares you for

**Q: How does LangGraph support parallel agent execution?**
> Via `add_conditional_edges` with a routing function that returns `list[Send]`. Each
> `Send(node_name, state)` spawns an independent branch. LangGraph runs them concurrently
> and merges results using the state reducers.

**Q: What's the difference between a node and a routing function in LangGraph?**
> A node is registered with `add_node` and must return a state dict (partial state update).
> A routing function is passed to `add_conditional_edges` and returns either a node name
> (string), a list of node names, or a list of `Send` objects for dynamic fan-out.

**Q: How do you merge results from parallel agents without data loss?**
> Use the `Annotated[list[X], add]` reducer pattern in the TypedDict state. `add` is
> `operator.add` — it appends lists rather than overwriting. Each parallel branch returns
> a single-item list; the reducer merges all of them.

**Q: When would you use a lookup table for routing vs. asking the LLM?**
> Use a lookup table when the routing logic is deterministic engineering knowledge — you
> know from domain expertise which agents are relevant for each failure type. Use LLM
> routing when the decision requires genuine reasoning about ambiguous or novel state.

**Q: Why separate `_InvestigatorOutput` from `InvestigatorFindings`?**
> `InvestigatorFindings` has an `agent` field that should be set programmatically, not
> by the LLM. `_InvestigatorOutput` is the LLM's schema with that field omitted. This
> prevents the LLM from hallucinating its own name or being confused by the field.

---

## 8. Key commands

```bash
# Run the server
uv run uvicorn sentinel.main:app --reload --port 8000

# Inject a failure
Invoke-RestMethod -Uri "http://localhost:8000/lab/services/api-gateway/inject" -Method POST -ContentType "application/json" -Body '{"failure_mode":"crash_loop"}'

# Trigger an incident (all on one line — backtick multiline breaks when pasted)
Invoke-RestMethod -Uri "http://localhost:8000/incidents" -Method POST -ContentType "application/json" -Body '{"alert_id":"test-phase3","service":"api-gateway","message":"Service is crash-looping","severity":"critical"}' | ConvertTo-Json -Depth 10

# Run fast tests only
uv run pytest

# Run integration tests (needs server + lab running)
uv run pytest -m integration
```
