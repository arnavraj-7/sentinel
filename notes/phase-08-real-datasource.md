# Phase 8 — Real DataSource (Cloud Logging + the abstraction)

> **Status:** Complete — verified end-to-end against real GCP. A crash_loop incident on the
> live `order-service` was triaged, investigated with real Cloud Logging data, root-caused,
> human-approved, healed via the real `/heal`, and post-mortemed. The project crossed the
> tutorial→real line here.
>
> **Duration:** 1 session
>
> **Deliverable:** A `DataSource` abstraction (ABC + Lab/GCP implementations + a factory).
> Investigators/triager/executor no longer know where data comes from. The GCP impl reads
> real metrics over HTTP and real logs from the Cloud Logging API. Topology comes from a
> declared registry, not LLM hallucination.

---

## 1. WHY this phase exists

Phases 1–6 reasoned on fake data (a local dict). Phase 7 deployed real services. Phase 8
connects them: Gemini now reasons on real Cloud Run metrics and real Cloud Logging entries.

The architectural problem: investigators hardcoded `httpx` calls to `settings.lab_base_url`.
To switch to real GCP you'd edit every agent. The fix is an **abstraction** — a contract
(`DataSource`) that callers depend on, with swappable implementations behind it. Switching
lab↔GCP becomes one config value, zero agent edits. That's the Open/Closed Principle.

---

## 2. WHAT we built — file by file

```
src/sentinel/datasource/
├── __init__.py     ← NEW: get_datasource() factory (the ONLY place concrete classes appear)
├── base.py         ← NEW: DataSource ABC — the contract
├── lab.py          ← NEW: LabDataSource — wraps localhost:8000 (keeps tests working)
├── gcp.py          ← NEW: GCPDataSource — real Cloud Run HTTP + Cloud Logging API
└── registry.py     ← NEW: SERVICE_REGISTRY + topology helpers (real dependency graph)

src/sentinel/
├── config.py       ← UPDATED: `datasource: str = "gcp"` selector
└── agents/
    ├── investigators.py  ← UPDATED: get_datasource(); topology_mapper uses registry
    ├── triager.py        ← UPDATED: get_datasource() inside _fetch_context
    ├── executor.py       ← UPDATED: await ds.heal(service)
    └── state.py          ← UPDATED (earlier): HIGH_ERROR_RATE, DATA_CORRUPTION categories

pyproject.toml      ← UPDATED: google-cloud-logging>=3.11
```

---

## 3. HOW it works — concept by concept

### 3a. The ABC — a contract with no implementation

```python
class DataSource(ABC):
    @abstractmethod
    async def get_metrics(self, service: str) -> dict[str, Any]: ...
    @abstractmethod
    async def get_logs(self, service: str, count: int = 20) -> list[dict[str, Any]]: ...
    @abstractmethod
    async def heal(self, service: str) -> dict[str, Any]: ...
```

`ABC` = the parent's superpower is "cannot be instantiated, only subclassed." `@abstractmethod`
= "a child that doesn't implement this can't be instantiated either" — the contract is
enforced at object-creation time, not three nodes later. Same inheritance idea as `BaseModel`
/`StrEnum`, different superpower.

### 3b. Polymorphism — the payoff

Two children fulfill the contract differently:
- `LabDataSource.heal` → HTTP **POST** to localhost lab
- `GCPDataSource.heal` → HTTP **GET** to real Cloud Run

The investigator calls `await ds.heal(service)` and **cannot tell which one it got**. Same
call, different behaviour. That is polymorphism in one sentence.

### 3c. The factory + lazy singleton

```python
_instance: DataSource | None = None

def get_datasource() -> DataSource:
    global _instance
    if _instance is None:
        _instance = GCPDataSource() if settings.datasource == "gcp" else LabDataSource()
    return _instance
```

- **Return type is the ABC**, never the concrete class — callers see only the contract.
- **The ONLY file that names `GCPDataSource`/`LabDataSource`.** Grep the codebase; the class
  names appear nowhere else. Swapping = this one `if` + one config value.
- **Lazy singleton:** built on first *call*, cached for process life. NOT a constructor, NOT
  startup code. Modules run once on import and cache — that run-once rule is why the
  module-level `_instance` works as a singleton.

### 3d. Why `get_datasource()` is called *inside* node functions, not at module top

`GCPDataSource.__init__` builds the Cloud Logging client (auth + network). At module top that
runs at **import time** → breaks `pytest` collection and makes imports fragile. Calling it
inside the function defers it to first real use; the singleton cache still builds it once.

### 3e. Cloud Logging — the genuinely new part

Services `print(json.dumps(...))` to stdout → Cloud Run captures it → a valid-JSON line
becomes a queryable `jsonPayload`. We query with a filter string:

```python
filter_str = ('resource.type="cloud_run_revision" '
              f'resource.labels.service_name="{service}"')
entries = self._log_client.list_entries(
    filter_=filter_str, order_by=gcloud_logging.DESCENDING, max_results=count)
```

The client is **synchronous/blocking** — calling it in async code freezes the event loop,
and you can't `await` it (it returns a plain iterator, not an awaitable). So:

```python
def _fetch_logs_sync(self, service, count):   # all blocking work here
    ...
async def get_logs(self, service, count=20):
    return await asyncio.to_thread(self._fetch_logs_sync, service, count)
```

`to_thread` runs the blocking call on a worker thread (event loop stays free) and itself
returns an awaitable. The blocked thread releases the GIL during its network wait, so the
loop keeps running. (Full theory: foundations.md §7.)

### 3f. Topology from the registry, not the LLM

```python
SERVICE_REGISTRY = {
    "api-gateway":      {"url": "...", "depends_on": ["order-service", "inventory-service"]},
    "order-service":    {"url": "...", "depends_on": ["inventory-service"]},
    "inventory-service":{"url": "...", "depends_on": []},
}
```

`describe_topology(service)` formats real declared dependencies + reverse-lookup dependents.
The old `_TOPOLOGY_MAPPER_SYSTEM` said *"use your knowledge of typical architectures"* — pure
guessing. Now it's fed the real graph and told to treat it as ground truth. Verified in the
live run: topology evidence was the real registry data, zero hallucination.

---

## 4. MISTAKES & GOTCHAS (all hit this phase)

| Mistake | Why it broke | Fix |
|---|---|---|
| `from sentinel.datasource import _instance as ds` | Imports bind the *value* now; `_instance` was `None` at import and stayed `None` forever | Import & call the function `get_datasource()` |
| Missing `await` on `ds.get_metrics`/`ds.heal` | async fn without `await` = coroutine object, not data; crashes on use | `await` every datasource call |
| `from supabase_auth import Any` | Editor autocomplete garbage | `from typing import Any` |
| `Response(status_code=200, content={"k":"v"})` | base `Response` does `content.encode()`; dict has no `.encode()` → 500 | `-> dict` + `return {...}` (FastAPI auto-JSON) |
| `get_service_url()` no arg | signature needs `service` | `get_service_url(service)` |
| `describe_topology()` no arg | same | `describe_topology(service)` |
| `ds = get_datasource()` at module top | builds GCP client at import; breaks pytest | call inside the node function |
| `heal` as POST in GCP impl | real `/heal` is GET | `client.get` |

The recurring theme: **every DataSource method is `async` → every call site needs `await`.**
The foundations async lesson, live in our own code.

---

## 5. INTERVIEW Q&A

**Q: Why an ABC instead of just two classes / if-else in the agents?**
> The agents depend on the contract, not the implementation. New data source = new subclass +
> one factory line; zero changes to consumers. Open for extension, closed for modification.

**Q: Why is the factory a function and a singleton, not a module-level instance?**
> Module-level would build the GCP/Cloud Logging client at import time (auth + network),
> breaking test collection and slowing imports. The function defers construction to first
> use; the `_instance` cache guarantees it's built exactly once per process.

**Q: Why can't you `await` the Cloud Logging client directly?**
> It's a synchronous library — `list_entries` returns a plain iterator, not an awaitable, and
> calling it blocks the event loop. You wrap it in `asyncio.to_thread`, which offloads the
> blocking call to a worker thread (GIL released during its I/O wait) and returns an
> awaitable.

**Q: How do you avoid the topology agent hallucinating the architecture?**
> Don't ask the LLM to guess. Declare the dependency graph in a registry and feed it as
> ground truth, instructing the model not to infer architecture.

**Q: Fresh-fetch per investigator vs. fetch-once-into-state — tradeoff?**
> Fresh = current data for a live, evolving incident, at the cost of extra calls and possible
> inconsistency between agents. Once-into-state = consistency + fewer calls, at the cost of
> staleness and bloating checkpointed state with raw logs. For live IR, fresh usually wins;
> the smarter version (narrow, time-windowed queries) is roadmap Phase 10.

---

## 6. COMMANDS CHEAT SHEET

```powershell
# ADC for client libraries (separate from `gcloud auth login`)
gcloud auth application-default login

# install the new dep
pip install google-cloud-logging      # or: uv add google-cloud-logging

# verify a real service's JSON /heal
Invoke-RestMethod https://order-service-717499257054.us-central1.run.app/heal

# sabotage + generate real logs + wait for ingestion
Invoke-RestMethod -Method POST -Uri .../sabotage -ContentType "application/json" -Body '{"mode":"crash_loop"}'
1..8 | ForEach-Object { try { Invoke-RestMethod .../route } catch {} }   # generate ERROR logs
# wait ~30s — Cloud Logging ingestion delay

# run Sentinel against real GCP (datasource defaults to "gcp")
uvicorn sentinel.main:app --port 8000

# trigger + approve
Invoke-RestMethod -Method POST -Uri http://localhost:8000/incidents -ContentType "application/json" -Body '{"alert_id":"p8","service":"order-service","message":"crash looping","severity":"critical"}'
Invoke-RestMethod -Method POST -Uri http://localhost:8000/incidents/INC_ID/approve -ContentType "application/json" -Body '{"approved":true}'

# flip back to lab without code changes (the OCP payoff)
$env:SENTINEL_DATASOURCE = "lab"
```

---

## 7. KNOWN GAPS (carried forward)

1. **Post-mortem confabulates resolution** — claims a "rollback" the executor never did
   (executor only calls `/heal`). Cosmetic until Phase 16 (Claude Code does real remediation
   and scribe reports actual executor actions).
2. **Log staleness** — investigators fetch a broad recent slice; for subtle failures the age
   could mislead. Roadmap Phase 10 (context surgery: time-windowed, targeted queries).
3. **No resilience** — a single Gemini rate-limit or Cloud Logging timeout crashes the graph.
   This is the immediate next phase.

---

## 8. WHAT'S NEXT

Phase 9 — Resilience core: shared `structured_invoke()` with retry + Pydantic
schema-repair + model fallback, and `asyncio.wait_for` timeouts on every tool/LLM call.
Nothing else is safe to demo on free-tier Gemini until this lands.
