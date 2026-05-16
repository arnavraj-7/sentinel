# Phase 1 — Simulated Infra Lab

> **Status:** Complete — 8/8 tests passing, ruff clean.
>
> **Duration:** 1 session
>
> **Deliverable:** A fake production environment with 6 microservices, 7 failure modes,
> live-feeling metrics and logs, inject/heal endpoints — all in memory, no real infra needed.

---

## 1. WHY this phase exists

Real SRE tools talk to Kubernetes, Prometheus, Loki, Grafana. Getting all of that running
locally takes weeks of DevOps setup and requires knowledge of k8s, Helm, service meshes —
none of which is the point of this project.

The simulated lab solves this by asking: **what does an agent actually need from
infrastructure?** It needs:
- A way to see current metrics (CPU, memory, latency, error rate)
- A way to read logs
- A deterministic failure state it can reproduce for testing

That's it. We build a FastAPI sub-router that provides exactly those three things,
backed by a Python dict instead of real infrastructure. The agents never know the difference
— they hit HTTP endpoints and get realistic-looking data back.

**The deeper principle:** in AI agent development, your agents are the hard part. Everything
they depend on (tools, APIs, data sources) should be as simple as possible so you can
test agent behaviour in isolation. Simulate first, integrate real systems later.

---

## 2. WHAT we built — file by file

```
src/sentinel/lab/
├── models.py      ← FailureMode enum, ServiceState, MetricsSnapshot, LogLine
├── registry.py    ← ServiceRegistry class + singleton — the in-memory state store
├── generators.py  ← fake metric/log data per failure mode
└── routes.py      ← FastAPI router: list, metrics, logs, inject, heal

tests/
└── test_lab.py    ← 4 integration tests
```

**6 services:** api-gateway, auth-service, payment-service, db-proxy, cache-service, cert-manager

**7 failure modes:**
| Mode | What it simulates |
|---|---|
| `healthy` | Normal operation |
| `memory_leak` | Memory climbing, GC pressure |
| `crash_loop` | Process keeps restarting, uptime < 30s |
| `latency_spike` | p95 > 5s (was <50ms) |
| `surge_5xx` | Error rate > 50% |
| `db_pool_exhaustion` | All DB connections in use, queries queueing |
| `cert_expiry` | TLS cert expiring in < 24h |

**Endpoints:**
```
GET  /lab/services                          → list all services + their current mode
GET  /lab/services/{name}/metrics           → MetricsSnapshot for that service
GET  /lab/services/{name}/logs?count=8      → list of LogLines
POST /lab/services/{name}/inject  {"mode"}  → set failure mode
POST /lab/services/{name}/heal              → reset to healthy
```

---

## 3. WHAT — key design decisions

### Why simulate instead of mocking?

A mock replaces a function in your test process — it only works in tests. The simulated
lab is a real HTTP server that any code can talk to: your agents, your tests, curl, Postman.
This matters because your agents will call these endpoints the same way they'll call real
Prometheus — over HTTP, getting JSON back. The code path is identical.

### Immutable updates in the registry

```python
# We do this (replace the whole object):
self._state[name] = ServiceState(name=name, failure_mode=mode, injected_at=now)

# Not this (mutate in place):
self._state[name].failure_mode = mode
```

Pydantic models are designed to be immutable after creation. Replacing the whole object
means any code holding a reference to the old `ServiceState` still sees the old data —
no surprise mutations. Mutate the container (dict), not the value (ServiceState).

### `registry = ServiceRegistry()` — module-level singleton

One instance created when the module is first imported, shared across all requests.
This is the same pattern as `settings = Settings()` in config.py. It works because:
- We never swap out the registry object itself (only its contents change)
- Python's import system guarantees a module is only loaded once per process

---

## 4. HOW — concepts introduced this phase

### FastAPI `include_router` with prefix

```python
# main.py
from sentinel.lab.routes import router as lab_router
app.include_router(lab_router)

# routes.py
router = APIRouter(prefix="/lab", tags=["lab"])
# → all routes automatically prefixed with /lab
```

Routers let you split endpoints across files without making one giant `main.py`.
The `prefix` is applied to every route in the router. `tags` groups them in `/docs`.

### `HTTPException` — how FastAPI returns errors

```python
from fastapi import HTTPException

# Instead of:
return Response(status_code=404, content={"error": "not found"})

# You raise:
raise HTTPException(status_code=404, detail=f"unknown service '{name}'")
```

FastAPI catches `HTTPException` and converts it to an HTTP response automatically.
Always `raise`, never `return`. The client gets `{"detail": "your message"}` in the body.

### Query parameters with defaults

```python
@router.get("/services/{name}/logs")
async def get_logs(service_name: str, count: int = 8) -> list[LogLine]:
```

`count` isn't in the path, so FastAPI reads it from the query string: `/logs?count=20`.
Has a default of 8 so the parameter is optional. FastAPI validates it's an int automatically.

### Two levels of dict mutation

```python
# Level 1: mutate the dict (add/replace a key) — fine
self._state["api-gateway"] = ServiceState(...)

# Level 2: replace the value with a new object — fine for Pydantic models
ServiceState(name="api-gateway", failure_mode=CRASH_LOOP)
```

Rule: containers (list, dict) → mutate. Pydantic models → replace entirely.

---

## 5. HOW — testing concepts introduced this phase

### Test isolation — the singleton problem

The registry is a module-level singleton. If test 1 injects `crash_loop` into `api-gateway`,
test 2 will still see it broken. Tests interfere with each other and fail randomly depending
on run order — one of the worst bugs to debug.

**Fix: `autouse=True` fixture**

```python
@pytest.fixture(autouse=True)
def reset_lab() -> None:
    for name in ALL_SERVICES:
        registry.heal(name)
```

`autouse=True` means pytest runs this before every test in the file automatically without
being asked. Each test starts with a clean slate.

**Rule:** Any test that touches shared mutable state needs a reset fixture.
This applies to databases, caches, registries, anything that survives between tests.

### Testing error responses

```python
response = await client.post("/lab/services/fake-service/inject", json={"mode": "memory_leak"})
assert response.status_code == 404
assert "fake-service" in response.json()["detail"]
```

FastAPI's `HTTPException` always produces `{"detail": "..."}` in the response body.
Test both the status code AND the detail message — the code tells you the category of
error, the message tells you the specific cause.

### Multi-step state tests

```python
await client.post("/lab/services/db-proxy/inject", json={"mode": "memory_leak"})
await client.post("/lab/services/db-proxy/heal")
response = await client.get("/lab/services/db-proxy/metrics")
assert response.json()["failure_mode"] == "healthy"
```

Don't store responses you don't need. Only assert on the final observable state.
This tests behaviour, not implementation — you don't care HOW heal works, only that
after calling it the service is healthy.

---

## 6. MISTAKES & GOTCHAS

### ❌ Forgetting `autouse=True` on the reset fixture

**Symptom:** Tests pass individually but fail randomly when run together. Test order matters.
**Fix:** `@pytest.fixture(autouse=True)` on the reset fixture. Alternatively, add the
fixture name to every test parameter — but autouse is cleaner when it should apply to all.

### ❌ Returning instead of raising HTTPException

```python
# Wrong — FastAPI won't treat this as an error, sends 200 with None body
return HTTPException(status_code=404, detail="not found")

# Right
raise HTTPException(status_code=404, detail="not found")
```

### ❌ Mutating Pydantic model fields directly

```python
# Wrong — Pydantic v2 models are not frozen but mutating them is fragile
self._state[name].failure_mode = new_mode

# Right — replace the whole object
self._state[name] = ServiceState(name=name, failure_mode=new_mode)
```

### ❌ Mutable default in Pydantic model

```python
# Wrong — all instances share the same dict
labels: dict[str, str] = {}

# Right — each instance gets a new dict
labels: dict[str, str] = Field(default_factory=dict)
```

### ❌ Type annotation without BaseModel inheritance

```python
# Wrong — annotations are just hints, no runtime behaviour
class ServiceState():
    name: str              # this does NOTHING at runtime

# Right
class ServiceState(BaseModel):
    name: str              # now Pydantic validates and creates real attributes
```

---

## 7. INTERVIEW Q&A

### Q: Why simulate infrastructure instead of using mocks?
**A:** Mocks replace functions inside the test process — they only work in tests and don't
exercise the real HTTP serialisation, routing, or error handling. The simulated lab is a
real HTTP server: any code can talk to it over HTTP the same way it will talk to real
Prometheus or Loki in production. The code path is identical. It also gives us a
reproducible "incident scenario" we can replay 100 times to regression-test agent behaviour.

### Q: What is `autouse=True` on a pytest fixture and when do you use it?
**A:** `autouse=True` tells pytest to run the fixture before every test in scope without
the test having to declare it as a parameter. Use it for reset/cleanup logic that must
run before every test — especially when your tests share mutable global state like a
registry or a database. Without it, one test that forgets to declare the fixture will
see dirty state from the previous test, causing random failures depending on run order.

### Q: How does FastAPI decide where a function parameter comes from?
**A:** By its type annotation. A Pydantic `BaseModel` subclass → request body JSON.
A primitive (`str`, `int`) whose name matches a `{segment}` in the path → URL path param.
A primitive not in the path → query string. `Request` → the raw HTTP request object.
This is why FastAPI routes have almost no boilerplate — the type system does the routing.

### Q: Why replace the whole Pydantic object instead of mutating a field?
**A:** Pydantic models represent a complete, consistent snapshot of a thing. If you mutate
a field in place, any other part of the code holding a reference to that object will see
the mutation unexpectedly — a hidden side effect. Replacing the whole object means the old
reference still points to the old data, and the new state lives at a new object. It's
safer, easier to reason about, and consistent with how functional/immutable patterns work.

### Q: What does `raise HTTPException` do compared to `return`?
**A:** `raise HTTPException` signals FastAPI's exception handler to convert it into an
HTTP error response with the given status code and `{"detail": "..."}` body. If you
`return` an `HTTPException` object, FastAPI treats it as a successful 200 response with
the exception object as the body — a silent bug. Always `raise` for errors in FastAPI.

### Q: How does the registry singleton work across multiple requests?
**A:** Python's import system guarantees a module is only executed once per process.
`registry = ServiceRegistry()` at module level means the first import creates the object;
every subsequent import gets the same object from the module cache. All request handlers
import the same `registry` reference and therefore see the same state. This is safe as
long as you only replace values in the dict (not the dict itself) and don't have
concurrent writes — which we don't since Python's GIL serialises dict operations.

---

## 8. COMMANDS CHEAT SHEET

```powershell
# Activate venv
.\.venv\Scripts\Activate.ps1

# Run server
uvicorn sentinel.main:app --reload

# Test all lab endpoints manually
curl.exe http://localhost:8000/lab/services
curl.exe http://localhost:8000/lab/services/api-gateway/metrics
curl.exe http://localhost:8000/lab/services/api-gateway/logs
curl.exe -X POST http://localhost:8000/lab/services/api-gateway/inject `
  -H "Content-Type: application/json" -d '{\"mode\": \"crash_loop\"}'
curl.exe -X POST http://localhost:8000/lab/services/api-gateway/heal

# Run only lab tests
pytest tests/test_lab.py -v

# Run all tests
pytest -v

# Lint
ruff check src/ tests/
```

---

## 9. WHAT'S NEXT

**Phase 2 — Triager Agent (real LLM)**

The stub `triager_node` in `graph.py` currently just echoes back the alert.
Phase 2 replaces it with a real Gemini 2.5 Flash call that:
- Reads the alert payload
- Queries the lab's `/metrics` and `/logs` endpoints for the affected service
- Classifies: severity, likely failure category, which other services might be affected
- Writes a structured `AgentNote` with its findings

New concepts coming: LangChain/LangGraph tool calling, Vertex AI Gemini integration,
prompt design for structured output, Pydantic output parsers.
