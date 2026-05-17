# Foundations — FastAPI, Testing, Pydantic, LangGraph

> **Purpose:** Everything taught before Phase 1 code started. Pure concepts, syntax reference,
> and interview prep. Read this before any technical interview or when you've been away from
> the project for a while.

---

## 1. WHY these foundations matter

You're building AI agents on top of a web server. The agents are the interesting part, but
they sit on top of FastAPI + Pydantic + async Python. If you don't understand that foundation,
you'll copy-paste code that works but you won't be able to debug it, extend it, or explain it.

The goal here is NOT to memorise every method. It's to understand:
- **How a web server actually lives in memory** (one process, many requests)
- **How FastAPI reads your function signature** to know where each param comes from
- **What testing actually is** and why it catches bugs you'd never find manually
- **What LangGraph state and reducers do** conceptually

Syntax you can look up. The WHY is what interviewers test.

---

## 2. How a Web Server Lives in Memory

This is the most important mental model. Get this wrong and nothing else makes sense.

```
uvicorn sentinel.main:app
        ↓
Python creates ONE app object, keeps it in RAM forever
app.state.graph = compiled_graph   ← stored ONCE at startup
        ↓
Request 1  →  handler runs  →  reads app.state.graph  ← same object
Request 2  →  handler runs  →  reads app.state.graph  ← same object
Request 3  →  handler runs  →  reads app.state.graph  ← same object
```

**The server is a singleton. Requests are visitors. Visitors can reach the singleton via `request.app`.**

Compare to Express.js:
```js
// Express
app.locals.graph = buildGraph()         // stored once on the server
app.post("/incidents", (req, res) => {
    const graph = req.app.locals.graph  // req.app = the same server app
})
```

```python
# FastAPI — identical concept, different names
app.state.graph = build_graph(checkpointer)   # stored once
async def trigger_incident(request: Request):
    graph = request.app.state.graph           # request.app = same app
```

**`app.state` is a FastAPI feature** — not Python. It's a namespace FastAPI gives you to store
server-lifetime resources (DB connections, compiled graphs, config caches). You could use a
module-level global instead but `app.state` is cleaner for testing and multi-app setups.

---

## 3. FastAPI — Bare Minimum Syntax

FastAPI's key trick: **it reads your function's type annotations to decide where each param comes from.**

| Param type | FastAPI reads it from |
|---|---|
| `str` / `int` with name matching `{id}` in path | URL path |
| `str` / `int` with name NOT in path | Query string `?key=value` |
| Pydantic `BaseModel` subclass | Request body (JSON) |
| `Request` | Raw HTTP request object |

### Create a router and register routes

```python
from fastapi import APIRouter
router = APIRouter(prefix="/users", tags=["users"])

@router.get("")          # GET /users
@router.post("")         # POST /users
@router.put("/{id}")     # PUT /users/{id}
@router.delete("/{id}")  # DELETE /users/{id}
```

### URL path param

```python
@router.get("/{user_id}")
async def get_user(user_id: str) -> dict[str, str]:
    return {"id": user_id}
# GET /users/abc123  →  user_id = "abc123"
```

### Query string param

```python
@router.get("")
async def list_users(limit: int = 10, offset: int = 0) -> dict[str, int]:
    return {"limit": limit, "offset": offset}
# GET /users?limit=5&offset=20  →  limit=5, offset=20
# GET /users                    →  limit=10, offset=0 (defaults)
```

### Request body (Pydantic model)

```python
from pydantic import BaseModel

class CreateUser(BaseModel):
    name: str
    age: int

@router.post("")
async def create_user(body: CreateUser) -> dict[str, str]:
    return {"name": body.name}
# POST /users  with JSON {"name":"Arnav","age":21}  →  body.name = "Arnav"
```

FastAPI automatically: reads JSON body → validates against `CreateUser` →
returns 422 if invalid → gives you typed `body.name`, `body.age`.

### Path param + body together

```python
@router.put("/{user_id}")
async def update_user(user_id: str, body: CreateUser) -> dict[str, str]:
    return {"updated": user_id, "name": body.name}
# FastAPI knows: user_id from URL, body from JSON — no confusion
```

### Optional query param

```python
@router.get("/search")
async def search(q: str | None = None) -> dict[str, str | None]:
    return {"query": q}
```

### `response_model` — controls what goes OUT

```python
class UserPublic(BaseModel):    # only public fields
    name: str

class UserInternal(BaseModel):  # internal, has secrets
    name: str
    password_hash: str

@router.get("/{id}", response_model=UserPublic)
async def get_user(id: str) -> UserInternal:
    return db.get(id)   # returns UserInternal but FastAPI strips password_hash
```

`response_model` does three things:
1. Strips fields not declared in it (security — no accidental leaks)
2. Validates the return value
3. Auto-generates the OpenAPI schema at `/docs`

### Attach a router to the main app

```python
# main.py
from sentinel.api.users import router as users_router
app.include_router(users_router)
```

### Access `app.state` inside a route

```python
from fastapi import Request

@router.post("")
async def trigger(request: Request) -> dict[str, str]:
    graph = request.app.state.graph   # reach server-lifetime resource
```

Only need `Request` when you need `app.state`. For body/params/headers,
FastAPI handles everything automatically from type annotations.

---

## 4. Pydantic — Bare Minimum

Pydantic validates data at runtime and gives you typed objects.

### Define a model

```python
from pydantic import BaseModel, Field

class Incident(BaseModel):
    alert_id: str
    service: str
    severity: str = "medium"          # default value
    labels: dict[str, str] = Field(default_factory=dict)  # mutable default — ALWAYS use Field
```

### Use it

```python
inc = Incident(alert_id="a-1", service="checkout")
inc.service        # "checkout"
inc.severity       # "medium"  (default)
inc.model_dump()   # {"alert_id": "a-1", "service": "checkout", "severity": "medium", "labels": {}}
```

### Validation

```python
Incident(alert_id=123)   # Pydantic coerces int → str, no error
Incident()               # ValidationError — alert_id is required
```

### Mutable default gotcha — ALWAYS use `Field(default_factory=...)`

```python
# WRONG — all instances share the SAME dict object
labels: dict[str, str] = {}

# RIGHT — each instance gets a NEW dict
labels: dict[str, str] = Field(default_factory=dict)
```

This is a classic Python gotcha, not Pydantic-specific.

### `StrEnum` — string that is also an enum (Python 3.11+)

```python
from enum import StrEnum

class Severity(StrEnum):
    HIGH = "high"
    LOW  = "low"

Severity.HIGH          # <Severity.HIGH: 'high'>
Severity.HIGH == "high"  # True  ← works in JSON comparison
payload.severity.value   # "high"  ← the raw string
```

Use `StrEnum` for any field that is a fixed set of strings. FastAPI/Pydantic validates
incoming JSON strings against the enum automatically.

---

## 5. TypedDict vs BaseModel — When to Use Which

| | `TypedDict` | `BaseModel` |
|---|---|---|
| Runtime validation | No | Yes |
| LangGraph reducers | Yes (via `Annotated`) | No |
| Serialization | Dict-like | `.model_dump()` |
| Used for | Graph state | API boundaries |

```python
from typing_extensions import TypedDict
from typing import Annotated
from operator import add

class IncidentState(TypedDict):         # graph state
    notes: Annotated[list[AgentNote], add]   # reducer attached here
    done: bool

class IncidentInput(BaseModel):         # API boundary
    service: str
    severity: Severity = Severity.MEDIUM
```

Rule of thumb: **TypedDict for internal graph state, BaseModel for anything crossing an API boundary.**

---

## 6. LangGraph — Bare Minimum

### The mental model

A LangGraph is a directed graph where:
- **Nodes** = Python functions that do work (call LLMs, query databases, write notes)
- **Edges** = arrows that define execution order
- **State** = a shared dict that flows through every node

Each node receives the current state, does work, returns a **partial dict** of only the
keys it changed. LangGraph merges that partial dict back into the full state.

### Reducers — the most important concept

```python
# Without reducer — node REPLACES the list each time
notes: list[AgentNote]           # triager writes [A], detective writes [B] → you only see [B]

# With reducer — node APPENDS to the list
notes: Annotated[list[AgentNote], add]  # triager writes [A], detective writes [B] → you see [A, B]
```

The `add` reducer means "concatenate". When node returns `{"notes": [new_note]}`,
LangGraph runs `existing_notes + [new_note]` instead of replacing.

### Build and compile a graph

```python
from langgraph.graph import StateGraph, START, END

builder = StateGraph(IncidentState)        # declare state type
builder.add_node("triager", triager_fn)   # name → function
builder.add_node("analyst", analyst_fn)
builder.add_edge(START, "triager")         # entry point
builder.add_edge("triager", "analyst")    # sequential
builder.add_edge("analyst", END)           # exit
graph = builder.compile(checkpointer=cp)  # lock it in
```

### Node signature — always the same shape

```python
def my_node(state: IncidentState) -> dict[str, object]:
    # read from state
    service = state["input"].service
    # do work...
    note = AgentNote(agent="my_node", content="found something")
    # return PARTIAL dict — only keys you changed
    return {"notes": [note]}
```

### Invoke the graph

```python
# Synchronous
result = graph.invoke(initial_state, config={"configurable": {"thread_id": "inc_abc"}})

# Async (use this in FastAPI)
result = await graph.ainvoke(initial_state, config={"configurable": {"thread_id": "inc_abc"}})
```

`thread_id` = primary key for checkpointing. Same `thread_id` = same incident/conversation.

### Read saved state (checkpointing)

```python
snapshot = await graph.aget_state({"configurable": {"thread_id": "inc_abc"}})
snapshot.values["done"]    # the state dict
snapshot.values["notes"]
```

---

## 7. Sync vs Async — In Depth (interview-critical)

### Ground-up primer (read this FIRST — kitchen analogy)

Build the words bottom-up before any depth:

- **Computer** = a restaurant building.
- **Process** = one kitchen with its **own private pantry** (own memory). Two processes
  don't share memory; one crashing doesn't kill the other. `python main.py` = one kitchen.
- **Thread** = one cook **inside** a kitchen. A kitchen can have many cooks; all cooks in
  the same kitchen **share that kitchen's pantry** (threads share the process's memory).
  Different kitchens don't share a pantry.
- **CPU core** = a stove. A cook needs a stove to actually cook (run code). 4 stoves → 4
  cooks cook at the same instant; 1 stove → only 1 cooks at a time even if 10 cooks exist.
- **Parallelism** = many stoves + many cooks working the *same instant* (truly simultaneous).
- **Concurrency** = one cook *juggling* — start pasta boiling, chop veg while it boils,
  flip a steak — progress on many dishes by switching, NOT simultaneous.
- **Synchronous (blocking)** = a cook who puts pasta on and then *stands staring at the pot*
  for 10 min doing nothing until done. That idle waiting is **I/O** (network/disk/DB wait).
- **Event loop / async** = one smart cook + a notepad with one rule: *never stand idle — if
  something's just cooking, note it and go do other ready work*. One cook, one stove, no
  extra staff — just refuses to waste time during waits.
- **`await`** = the moment he writes "pasta @ 10:00" on the notepad and turns to another
  dish: "this part is just waiting — set aside, do other ready work, resume when it signals."
- **GIL (Global Interpreter Lock)** = the Python kitchen has exactly **one chef's hat**;
  only the cook wearing it may touch food (run Python bytecode). 10 threads → they pass the
  one hat around, never two at once → threads don't speed up **CPU** work. **Exception:** a
  cook just *waiting at the oven* (blocking I/O) isn't touching food, so he **drops the hat**
  while waiting → other cooks proceed → threads **do** help **I/O** work.
- **`asyncio.to_thread(fn)`** = hire a side cook (thread) to go hold a dumb no-timer
  appliance (a blocking library); main cook hands it off, keeps juggling, gets a proper
  "ring-me-back" object to `await`. The side cook drops the hat while waiting, so nothing
  freezes.

Now the depth:

### The one problem async exists to solve

A program does two kinds of work:
- **CPU work** — *computing* (math, parsing, loops). CPU is busy.
- **I/O work** — *waiting* (network, DB, disk, API). CPU is **idle**, waiting on something external.

A 200ms network call: ~0.1ms is real CPU work, ~199.9ms is the CPU doing **nothing**, waiting
for bytes. **Async exists to reclaim that wasted waiting time.** Everything else is mechanism.

### Mental model — one waiter in a restaurant

- **Sync waiter:** takes table 1's order → goes to kitchen → *stands there 10 min watching the
  chef* → serves table 1 → only now goes to table 2. 95% of his time wasted standing idle.
- **Async waiter:** takes table 1's order → hands to kitchen → *immediately* serves table 2,
  3, 4… → kitchen signals table 1's food ready → delivers it. One waiter serves everyone
  because cooking = waiting = time he doesn't need to be involved.

Map: waiter = thread/event loop · tables = tasks · cooking = I/O wait · `await` = "hand to
kitchen, I'm free until it's done." The async waiter isn't faster at cooking — the food still
takes 10 min. He just stops wasting *his own* time. **Async doesn't speed up I/O; it stops you
blocking on it.**

### The event loop

The "single waiter." A loop holding a set of tasks. Runs a task until it `await`s on pending
I/O → **parks** it → runs the next ready task → when I/O completes the parked task is flagged
ready → loop resumes it *at the exact line it paused*. One thread, never idle while any task
can progress. No second thread, no parallelism — just a loop that refuses to wait around.

### `await` — what it actually means (the #1 misconception)

`await x` = "this might block. Event loop: if `x` isn't ready, go run other tasks; resume me
here when it is."

- **NOT "run in parallel/background."** Sequential by itself: `await a()` then `await b()`
  runs a fully, then b. Parallelism needs `asyncio.gather(a(), b())`.
- Only valid inside `async def` (a *coroutine*).
- **Calling `async def` without `await` runs nothing** — you get a coroutine object that just
  sits there. Most common async bug ("why didn't my function run?").

### When async helps and when it's useless

- **I/O-bound** (network, DB, files, LLM/API calls) → huge win. Lots of waiting to reclaim.
  Sentinel's investigators (HTTP + Gemini) are textbook async.
- **CPU-bound** (image processing, crunching, ML inference) → async does **nothing**; no
  waiting to exploit. Worse: a heavy CPU loop in async **freezes the whole event loop**. Use
  multiple processes/cores instead.
- **The blocking trap:** calling a *synchronous blocking* function inside async —
  `time.sleep()`, a sync DB driver, the `google-cloud-logging` client — freezes the entire
  loop; every concurrent task stalls. Fix: `await asyncio.to_thread(blocking_fn, args)` to
  offload it to a worker thread. (This is exactly why `GCPDataSource.get_logs` wraps the
  sync Cloud Logging client in `to_thread`.)

### Which languages are sync vs async

No language is "an async language" — every language runs top-to-bottom by default. Async is
a concurrency model layered on:

| Language | Model |
|---|---|
| **JavaScript** | Async to the core. Single-threaded, event loop **built into the runtime**. Designed so UI never freezes. |
| **Python** | Sync-first. Async is **opt-in** via `asyncio` + `async/await`. GIL ⇒ threads don't help CPU; asyncio is the I/O answer. |
| **Go** | Goroutines — green threads + runtime scheduler. Write *sync-looking* concurrent code, no explicit `await`. |
| **C#** | `async/await`, Task-based. Nearly identical to Python's model. |
| **Rust** | `async/await`, you pick the runtime (tokio). |
| **Java** | Threads historically; now virtual threads (Project Loom). |

**Soundbite:** *"Sync vs async isn't a property of the language, it's a concurrency model.
JS is single-threaded event-loop async by design; Python is sync-first with an opt-in
asyncio loop; Go uses runtime-scheduled goroutines instead of await."*

### Concurrency vs Parallelism (they WILL ask)

- **Concurrency** = *dealing with* many things at once, interleaved on one worker (one waiter,
  ten tables). Structure.
- **Parallelism** = *doing* many things at the same instant, multiple workers (ten waiters).
  Execution.

async/event loop = **concurrency, not parallelism**. True parallelism needs multiple
cores/threads/processes. **Soundbite (Rob Pike):** *"Concurrency is about structure;
parallelism is about execution."*

### Interview Q&A

- **Sync vs async in one sentence?** Sync blocks at each I/O call doing nothing; async yields
  during the wait so one thread progresses other tasks.
- **Does async make code faster?** Only I/O-bound, and only by overlapping the *waiting* —
  never speeds a single op. CPU-bound gets zero benefit.
- **What is the event loop?** Single-threaded loop that runs tasks until they `await` pending
  I/O, parks them, runs others, resumes them when I/O completes.
- **Does `await` run things in parallel?** No — it's a suspension point. Sequential unless
  you `gather`.
- **Why is JS single-threaded but non-blocking?** Built-in event loop + all I/O async by
  design, so the one thread never blocks.
- **Blocking sync call inside a coroutine — what happens?** Freezes the whole loop; every
  task stalls. Fix: offload to thread/process.
- **What's a coroutine?** An `async def` function that can suspend at `await` and resume
  later — scheduled by the event loop.
- **Concurrency vs parallelism?** Concurrency = interleaving on one worker (structure);
  parallelism = simultaneous workers (execution). Async is concurrency.

### Async-native vs blocking library (why you can't just `await` everything)

"Can I `await` this?" is **not** about API-call vs DB-call. It's about whether *that library*
speaks async:

- **Async-native** (`httpx.AsyncClient`, `asyncpg`): exposes awaitables; yields to the loop
  during its network wait. `await` works.
- **Blocking/sync** (`requests`, `psycopg2`, `google-cloud-logging` client): the thread just
  stops and waits. Returns a plain value/iterator, **not an awaitable**.

So a DB call may or may not be awaitable — `asyncpg` yes, `psycopg2` no. Two distinct
problems with a sync client in async code:
1. **Can't `await` it** — `await sync_call()` → `TypeError: object is not awaitable`.
2. **Calling it freezes the loop** — the blocking trap.

`asyncio.to_thread(fn, *args)` fixes both: runs `fn` on a worker thread (loop stays free)
and *itself* returns an awaitable you can `await`.

### The GIL — why threads work here but not for CPU

Python has real OS threads, but the **GIL** lets only **one thread run Python bytecode at a
time** → threads don't speed up CPU-bound Python. **Exception:** a thread doing blocking I/O
(or C-extension work) **releases the GIL while waiting**. So a blocked network call in a
worker thread parks with the GIL released; the event-loop thread keeps running everything
else. That's precisely why `to_thread` rescues a blocking library.

**Soundbite:** *"Python threads help I/O-bound blocking work because blocking I/O releases
the GIL; they don't help CPU-bound work because the GIL serializes bytecode — CPU
parallelism needs multiprocessing."*

### Tie-back to Sentinel

Investigators call HTTP + Cloud Logging + Gemini — all I/O, all waiting → async overlaps it
all on one thread. `httpx.AsyncClient` is async-native (safe to `await`). The
`google-cloud-logging` client is **sync** → must be wrapped in `await asyncio.to_thread(...)`
or it freezes the loop.

---

## 8. Testing — Everything You Need to Know

### What testing IS

You write code that automatically verifies your own code. Instead of manually clicking
through Postman every time you make a change, `pytest` does it in 3 seconds.

### Three tiers

```
UNIT TEST
  Tests one function in isolation — no network, no DB, no other modules
  Fast: milliseconds
  Example: "does triager_node() return a dict with agent='triager'?"

INTEGRATION TEST
  Tests multiple pieces working together — real SQLite (in-memory), real FastAPI
  Slower: seconds
  Example: "does POST /incidents flow through HTTP → graph → SQLite correctly?"

SMOKE TEST
  Tests the fully deployed real system — real network, real external services
  Slowest: minutes
  Example: "deploy to staging, POST an incident, verify LangSmith trace appeared"
```

Our Phase 0 tests are all integration tests.

### pytest basics

```python
# A test = function starting with test_
def test_something() -> None:
    result = add(2, 3)
    assert result == 5   # False → test FAILS with clear error

# Async test — exactly the same, just async
async def test_something_async() -> None:
    result = await some_coroutine()
    assert result["done"] is True
```

`asyncio_mode = "auto"` in `pyproject.toml` makes pytest handle async tests automatically.

### Fixtures — reusable setup/teardown

```python
# conftest.py — shared across all test files in the same directory
import pytest

@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with LifespanManager(app):          # startup
        async with AsyncClient(...) as c:
            yield c                           # test runs here
                                              # teardown happens after yield

# test file — ask for fixture by name in params
async def test_health(client: AsyncClient) -> None:
    #              ↑ pytest injects this automatically
    response = await client.get("/health")
    assert response.status_code == 200
```

`conftest.py` is special — pytest automatically finds it and makes its fixtures available
to all test files in the same folder.

### Why `LifespanManager`?

FastAPI's startup code (lifespan) doesn't run automatically in tests. Without it,
`app.state.graph` doesn't exist and your tests crash with `AttributeError`.
`asgi_lifespan.LifespanManager(app)` runs the startup/shutdown for you in tests.

### `ASGITransport` — no real network in tests

```python
AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
```

This tells httpx "talk to this FastAPI app directly in memory, don't open a real socket."
Tests run fast and work offline.

---

## 9. Structured Logging — Why and How

### Why not `print()`?

```python
print(f"triager ran on {service}")
# output: "triager ran on checkout"
# Grafana/Datadog can't filter this. Can't alert on it. Useless in production.
```

### Structured JSON logging with structlog

```python
log.info("triager.run", service="checkout", incident_id="inc_abc", severity="high")
# output: {"level":"info","event":"triager.run","service":"checkout","incident_id":"inc_abc","severity":"high","timestamp":"2026-05-16T10:23:11Z"}
```

Now Grafana can filter by `service="checkout"`, alert when `severity="critical"`,
group by `incident_id`. This is how real production systems work.

### How to call it

```python
from sentinel.logging import log

log.info("event.name", key="value", another_key=123)   # structured info
log.warning("event.name", key="value")
log.error("event.name", exc_info=True)                 # includes traceback
```

Rule: event name is always `"noun.verb"` format (e.g. `"triager.run"`, `"checkpoint.save"`).
Extra fields are keyword args.

### The setup in `logging.py` is boilerplate — copy it to every project.

---

## 10. pydantic-settings — Typed Config

```python
# config.py
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="SENTINEL_",
        extra="ignore",         # silently ignore unknown vars
    )
    env: str = "dev"            # reads SENTINEL_ENV from env
    log_level: str = "INFO"     # reads SENTINEL_LOG_LEVEL from env
    checkpoint_db: Path = Path("./data/checkpoints.sqlite")

settings = Settings()           # singleton — import this everywhere
```

`env_prefix="SENTINEL_"` means the env var for `log_level` is `SENTINEL_LOG_LEVEL`.
Namespacing prevents collisions with other apps' env vars.

**Critical:** `pydantic-settings` only reads fields declared on the class. It does NOT
push all `.env` keys into `os.environ`. That's why you need `load_dotenv()` separately
for third-party SDKs like LangSmith that read env vars directly.

---

## 11. Boilerplate vs. Own It

| File | Copy-paste? | Must understand deeply |
|---|---|---|
| `config.py` | Pattern yes, fields no | Why env_prefix, why typed settings |
| `logging.py` | Almost entirely | Why structured JSON, how to call log.info() |
| `checkpoint/sqlite.py` | Yes | What a checkpointer IS and why it needs to stay open |
| `api/health.py` | 100% | Load balancers use /health |
| `main.py` lifespan pattern | Yes | load_dotenv ordering, lifespan concept |
| `agents/state.py` | NO — core domain | Reducers, TypedDict vs BaseModel, StrEnum |
| `agents/graph.py` | NO — core domain | Node signature, edges, compile(), thread_id |
| `api/incidents.py` | NO — core domain | Full request→graph→response flow |
| Tests | NO — verify YOUR logic | What each assert checks and why |

---

## 12. Interview Q&A

### Q: What is the difference between TypedDict and Pydantic BaseModel?
**A:** `TypedDict` is pure type-hint metadata — no runtime validation, but LangGraph can
attach reducers to fields via `Annotated`. `BaseModel` validates at runtime and serializes
cleanly to JSON. I use `TypedDict` for LangGraph state (needs reducers) and `BaseModel`
for API boundaries (needs validation and auto-docs).

### Q: What is a LangGraph reducer and why do you need one?
**A:** A reducer tells LangGraph how to merge a node's partial output into the full state.
`Annotated[list[AgentNote], add]` means "append, don't replace." Without it, each node
overwrites the list and you only see the last agent's output. With it, all agents accumulate
their findings — critical for parallel fan-out where multiple agents run simultaneously.

### Q: How does FastAPI know where each function parameter comes from?
**A:** It reads the type annotation. A Pydantic model → request body. A primitive (`str`,
`int`) whose name matches a path segment → URL param. A primitive not in the path → query
string. `Request` → raw request object. This is why FastAPI has almost no boilerplate —
the type system does the routing.

### Q: What is `response_model` in FastAPI?
**A:** It's the output schema. FastAPI validates the return value against it, strips any
fields not declared in it (security — prevents leaking internal data), and uses it to
generate OpenAPI docs. You can return an internal model with secrets and `response_model`
will filter them out before the JSON is sent.

### Q: Why does `load_dotenv()` need to run before imports?
**A:** SDKs like LangSmith read config env vars at import time, not at call time. If
`LANGSMITH_API_KEY` isn't in `os.environ` when `langsmith` is first imported, tracing is
permanently disabled for that process — even if you set the var later. So `load_dotenv()`
must be the very first statement in `main.py`, before any other imports.

### Q: Why use `app.state` instead of a module-level global?
**A:** `app.state` is scoped to one FastAPI app instance. Module-level globals are shared
across the whole Python process. In tests, `app.state` is cleaner — each test can get a
fresh app if needed. Globals leak between tests and between apps in the same process.
`app.state` also makes the dependency explicit — you can see exactly what resources an
app needs at startup.

### Q: What is async/await and why does FastAPI use it?
**A:** `async/await` is cooperative multitasking. When a handler hits `await`, it yields
control back to the event loop so other requests can run. This means one Python thread can
handle hundreds of concurrent requests as long as the bottlenecks are I/O (network calls,
DB queries, LLM API calls). For a system like Sentinel that makes many LLM API calls,
async is essential — otherwise the server blocks on every LLM call and can only handle
one request at a time.

### Q: What is a pytest fixture and what is conftest.py?
**A:** A fixture is reusable setup/teardown code. You declare it with `@pytest.fixture`,
and tests receive it by listing its name as a parameter. `conftest.py` is a special file
pytest discovers automatically — fixtures defined there are available to all test files
in the same directory without explicit imports. It's the canonical place for shared
test infrastructure like HTTP clients and database connections.

### Q: Why do integration tests not catch LangSmith tracing being broken?
**A:** Three reasons: (1) LangSmith fails silently by design — missing API key means no
traces, no errors. (2) Tests assert on graph output and HTTP responses, not on whether
a trace was emitted. (3) Tests use in-memory SQLite and Settings defaults so they don't
even need a real `.env` file. Silent failures (missing observability, empty RAG results,
LLM returning malformed output) require smoke tests that verify the signal was actually
received on the other side.

---

## 13. Commands Cheat Sheet

```powershell
# Activate virtualenv (PowerShell)
.\.venv\Scripts\Activate.ps1

# Run the server
uvicorn sentinel.main:app --reload

# Run tests
pytest

# Run tests with output (see print/log statements)
pytest -s

# Run one specific test
pytest tests/test_health.py::test_health_returns_ok

# Type check
mypy src/

# Lint + format check
ruff check src/ tests/
ruff format src/ tests/

# Auto-fix lint issues
ruff check --fix src/ tests/
```

---

## 14. What's Next

Phase 1 — Simulated Infra Lab:
- Build a FastAPI sub-app that pretends to be 6 microservices
- `api-gateway`, `auth-service`, `payment-service`, `db-proxy`, `cache-service`, `cert-manager`
- Expose `/logs` and `/metrics` endpoints that return fake but realistic data
- Add a control endpoint to inject deterministic failures: memory leak, crash loop,
  latency spike, 5xx surge, DB pool exhaustion, cert expiry
- This gives Sentinel a "fake production environment" to diagnose without needing real k8s
