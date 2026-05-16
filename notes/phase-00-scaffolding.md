# Phase 0 — Scaffolding & The Empty Stage

> **Status:** ✅ Green — mypy clean, ruff clean, 4/4 tests passing, LangSmith traces live.
>
> **Duration:** 1 session
>
> **Deliverable:** An incident payload POSTed to `/incidents` flows through an empty LangGraph, writes a checkpoint to SQLite, emits a trace to LangSmith.

---

## 1. WHY this phase exists

### Why build an "empty" system first?

Most LangGraph tutorials online start with "let's build an agent that calls an LLM" on line 1. That's how you end up with a project where, three weeks later, you hit a bug and have no idea whether it's in:

- the graph wiring
- the state management
- the prompt
- the tool call format
- the checkpointer
- the HTTP layer
- the environment config

You can't isolate because you never built each layer in isolation. **Phase 0's job is to build every layer except the intelligence**, verify each one with a test, and *then* start adding LLM logic on top of a foundation you trust.

### Why "production-grade from commit #1"

The temptation in a learning project is to write `checkpointer = MemorySaver()` because it's "just for now." The problem: when you swap to real persistence in Phase 6, every test you wrote against MemorySaver has to be rewritten, every bug that only reproduces with real SQLite gets discovered too late, and the "temporary" code becomes permanent because rewriting it is annoying.

Rule: **no placeholders that require rewriting later.** If the real thing is 20% harder to wire, take the hit today.

### Why this order (plumbing first, logic second)

Think of it like building a restaurant: you don't hire chefs before the kitchen has power, water, and a fire code sign-off. The "fake dough test" (does the oven work? does the POS print a ticket?) has to pass before real customers walk in.

---

## 2. WHAT we built — file-by-file tour

```
sentinel/
├── pyproject.toml              ← deps + tool config (ruff, mypy, pytest)
├── .env.example                ← template for LangSmith keys
├── .gitignore
│
├── src/sentinel/
│   ├── __init__.py             ← version string
│   ├── config.py               ← pydantic-settings — typed env loader
│   ├── logging.py              ← structlog JSON log setup
│   ├── main.py                 ← FastAPI app + lifespan (open/close checkpointer)
│   │
│   ├── api/
│   │   ├── health.py           ← GET /health  (always returns 200 ok)
│   │   └── incidents.py        ← POST /incidents  (runs the graph)
│   │
│   ├── agents/
│   │   ├── state.py            ← IncidentState (TypedDict) + Pydantic I/O models
│   │   └── graph.py            ← StateGraph with one node: "triager"
│   │
│   ├── checkpoint/
│   │   └── sqlite.py           ← AsyncSqliteSaver factory (async context manager)
│   │
│   └── lab/                    ← empty — Phase 1 fills this in
│
├── tests/
│   ├── conftest.py             ← shared httpx client fixture (with LifespanManager)
│   ├── test_graph_hello.py     ← graph-level tests (no HTTP)
│   └── test_health.py          ← HTTP-level tests (full stack)
│
├── notes/                      ← this folder, phase-by-phase notes
└── data/                       ← SQLite db file created here at runtime
```

### What each file does

| File | Purpose |
|---|---|
| `pyproject.toml` | Dependencies, tool configs, package discovery — the modern one-stop Python packaging file |
| `.env.example` | Template for secrets — real `.env` is gitignored |
| `config.py` | Loads env vars into a typed `Settings` object — fails fast on startup if config is bad |
| `logging.py` | Configures structlog to emit JSON logs with ISO timestamps + log levels |
| `agents/state.py` | Defines *what data* flows through the graph — `IncidentState` (TypedDict) + Pydantic models for I/O |
| `agents/graph.py` | Defines *the graph itself* — nodes, edges, compile with checkpointer |
| `checkpoint/sqlite.py` | Async context manager for opening `AsyncSqliteSaver` cleanly |
| `api/health.py` | Liveness probe endpoint |
| `api/incidents.py` | The main entry point — validates input, invokes graph, returns result |
| `main.py` | FastAPI app with `lifespan` that opens the checkpointer at startup |
| `tests/conftest.py` | Pytest fixture for an async HTTP test client that runs the full lifespan |
| `tests/test_graph_hello.py` | Tests the graph directly — no HTTP, no FastAPI, just the LangGraph machinery |
| `tests/test_health.py` | Tests the full HTTP stack with real lifespan |

---

## 3. HOW — key code snippets explained

### 3.1 Typed config with `pydantic-settings`

```python
# src/sentinel/config.py
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="SENTINEL_",
        extra="ignore",
    )

    env: str = "dev"
    log_level: str = "INFO"
    checkpoint_db: Path = Path("./data/checkpoints.sqlite")


settings = Settings()
```

**Line-by-line:**
- `BaseSettings` — a Pydantic model whose fields are loaded from env vars (and optionally a `.env` file)
- `env_file=".env"` — read from this file in dev
- `env_prefix="SENTINEL_"` — so `SENTINEL_LOG_LEVEL=DEBUG` maps to `settings.log_level`
- `extra="ignore"` — don't crash if there are extra unrelated env vars
- Each class attribute = one env var with a default, automatic type coercion, validation on startup
- `settings = Settings()` — instantiated once at import time; `from sentinel.config import settings` anywhere

**Why this matters:** If `SENTINEL_CHECKPOINT_DB` is unset, you get a real `Path` object not a string. If someone typos `SENTINEL_LOG_LEVL=DEBUG` you'll notice (it won't silently use INFO). Compare with `os.getenv(...)` which returns `str | None` forever.

### 3.2 Structured JSON logging with structlog

```python
# src/sentinel/logging.py
import logging
import sys
import structlog
from sentinel.config import settings


def configure_logging() -> None:
    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=settings.log_level)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            logging.getLevelName(settings.log_level),
        ),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


log = structlog.get_logger()
```

**What `processors` does:** Every log call flows through this list in order.
1. `merge_contextvars` — pulls bound context (e.g. `incident_id` set earlier) into this log line
2. `add_log_level` — adds `"level": "info"` field
3. `TimeStamper` — adds ISO timestamp
4. `StackInfoRenderer` + `format_exc_info` — serialize exceptions
5. `JSONRenderer` — turns the dict into a JSON string

**Usage later:**
```python
log.info("triager.run", incident_id="inc_abc", service="api-gateway")
```
Output:
```json
{"event": "triager.run", "incident_id": "inc_abc", "service": "api-gateway", "level": "info", "timestamp": "2026-04-13T10:15:42Z"}
```

Datadog, Loki, Cloud Logging can all parse this natively. No regexes.

### 3.3 Graph state — TypedDict + Pydantic hybrid

```python
# src/sentinel/agents/state.py
from datetime import UTC, datetime
from enum import StrEnum
from operator import add
from typing import Annotated
from pydantic import BaseModel, Field
from typing_extensions import TypedDict


class Severity(StrEnum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class IncidentInput(BaseModel):
    alert_id: str
    service: str
    message: str
    severity: Severity = Severity.MEDIUM
    labels: dict[str, str] = Field(default_factory=dict)


class AgentNote(BaseModel):
    agent: str
    content: str
    at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class IncidentState(TypedDict):
    incident_id: str
    input: IncidentInput
    notes: Annotated[list[AgentNote], add]
    done: bool
```

**The critical design decision:** TypedDict for the *state structure*, Pydantic for the *data inside the state*.

- `IncidentState` is a `TypedDict` because LangGraph's reducer system (`Annotated[list, add]`) plays cleanest with TypedDict
- `IncidentInput` and `AgentNote` are Pydantic `BaseModel` because they're at the API boundary and need runtime validation

**What `Annotated[list[AgentNote], add]` means:**
- Normal rule: "the new state field value replaces the old one"
- With `add` as reducer: "concatenate the new value onto the old one"
- So when triager returns `{"notes": [note]}`, LangGraph doesn't *replace* `notes` — it *appends*
- This is how Phase 2+ will have 5 agents each adding one note, and the final state has 5 notes

### 3.4 The graph itself — StateGraph pattern

```python
# src/sentinel/agents/graph.py
from typing import Any
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from sentinel.agents.state import AgentNote, IncidentState
from sentinel.logging import log

IncidentGraph = CompiledStateGraph[IncidentState, Any, IncidentState, IncidentState]


def triager_node(state: IncidentState) -> dict[str, object]:
    incident_id = state["incident_id"]
    payload = state["input"]
    log.info("triager.run", incident_id=incident_id, service=payload.service,
             severity=payload.severity.value)
    note = AgentNote(
        agent="triager",
        content=f"Received alert for service={payload.service} "
                f"severity={payload.severity.value}: {payload.message}",
    )
    return {"notes": [note], "done": True}


def build_graph(checkpointer: AsyncSqliteSaver) -> IncidentGraph:
    builder: StateGraph[IncidentState, Any, IncidentState, IncidentState] = StateGraph(
        IncidentState,
    )
    builder.add_node("triager", triager_node)
    builder.add_edge(START, "triager")
    builder.add_edge("triager", END)
    return builder.compile(checkpointer=checkpointer)
```

**The canonical LangGraph pattern, memorize this:**

1. `builder = StateGraph(StateType)` — construct with the state schema
2. `builder.add_node("name", function)` — register a node
3. `builder.add_edge(FROM, TO)` — register an edge
4. `builder.add_edge(START, "first_node")` — mark the entry point
5. `builder.add_edge("last_node", END)` — mark the exit point
6. `builder.compile(checkpointer=...)` — returns a `CompiledStateGraph` you can `ainvoke` on

**Nodes are plain functions.** They take the current state and return a **dict of partial updates**. They don't mutate state directly — LangGraph merges their return dict into state via reducers.

### 3.5 AsyncSqliteSaver lifecycle

```python
# src/sentinel/checkpoint/sqlite.py
from contextlib import asynccontextmanager
from pathlib import Path
from collections.abc import AsyncIterator
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver


@asynccontextmanager
async def open_checkpointer(db_path: Path) -> AsyncIterator[AsyncSqliteSaver]:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
        yield saver
```

**Why this wrapper exists:**
- `AsyncSqliteSaver.from_conn_string()` is already an async context manager
- We wrap it in our own context manager to also create the parent directory
- Usage in `main.py`:
  ```python
  async with open_checkpointer(settings.checkpoint_db) as checkpointer:
      app.state.graph = build_graph(checkpointer)
      yield
  ```
- `yield` here hands control to FastAPI's request loop
- When shutdown begins, control returns past `yield`, the `async with` exits, the SQLite connection closes cleanly

### 3.6 FastAPI lifespan — the glue

```python
# src/sentinel/main.py
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from fastapi import FastAPI
from sentinel.agents.graph import build_graph
from sentinel.api.health import router as health_router
from sentinel.api.incidents import router as incidents_router
from sentinel.checkpoint.sqlite import open_checkpointer
from sentinel.config import settings
from sentinel.logging import configure_logging, log


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    log.info("sentinel.startup", env=settings.env, checkpoint_db=str(settings.checkpoint_db))
    async with open_checkpointer(settings.checkpoint_db) as checkpointer:
        app.state.graph = build_graph(checkpointer)
        log.info("sentinel.ready")
        yield
    log.info("sentinel.shutdown")


app = FastAPI(title="Sentinel", version="0.1.0", lifespan=lifespan)
app.include_router(health_router)
app.include_router(incidents_router)
```

**What happens at startup:**
1. `configure_logging()` runs — structlog is live
2. `open_checkpointer(...)` opens the SQLite async connection
3. `build_graph(checkpointer)` compiles the graph **once**, stored on `app.state.graph`
4. `yield` → FastAPI starts serving requests
5. At SIGTERM, control returns past yield → `async with` exits → checkpointer closes

**Why store graph on `app.state`:** Compiling a graph is cheap, but we only want to do it *once per process*, not once per request. `app.state` is FastAPI's official place for long-lived per-app objects.

### 3.7 The incident endpoint

```python
# src/sentinel/api/incidents.py
from typing import Any
from fastapi import APIRouter, Request
from pydantic import BaseModel
from sentinel.agents.state import AgentNote, IncidentInput, IncidentState, _new_incident_id

router = APIRouter(prefix="/incidents", tags=["incidents"])


class IncidentResponse(BaseModel):
    incident_id: str
    done: bool
    notes: list[AgentNote]


@router.post("", response_model=IncidentResponse)
async def trigger_incident(payload: IncidentInput, request: Request) -> IncidentResponse:
    graph = request.app.state.graph
    incident_id = _new_incident_id()
    config: dict[str, Any] = {"configurable": {"thread_id": incident_id}}
    initial: IncidentState = {
        "incident_id": incident_id,
        "input": payload,
        "notes": [],
        "done": False,
    }
    final_state = await graph.ainvoke(initial, config=config)
    return IncidentResponse(
        incident_id=incident_id,
        done=final_state["done"],
        notes=final_state["notes"],
    )
```

**Flow:**
1. FastAPI auto-validates the JSON body against `IncidentInput` (400 if invalid — free input validation)
2. We generate a fresh `incident_id` — this doubles as the `thread_id` for checkpointing
3. `config={"configurable": {"thread_id": ...}}` — the standard LangGraph pattern for identifying a run
4. `await graph.ainvoke(initial, config=config)` — run the graph async
5. LangGraph executes `triager_node`, writes checkpoints after each step, returns final state
6. We serialize the response via `IncidentResponse` (FastAPI handles this)

### 3.8 Tests — two levels

```python
# tests/test_graph_hello.py  (graph-level, no HTTP)
async def test_triager_node_produces_note_and_marks_done() -> None:
    async with AsyncSqliteSaver.from_conn_string(":memory:") as checkpointer:
        graph = build_graph(checkpointer)
        payload = IncidentInput(alert_id="a-1", service="api-gateway",
                                message="5xx spike", severity=Severity.HIGH)
        initial = {"incident_id": "inc_test_0001", "input": payload,
                   "notes": [], "done": False}
        config = {"configurable": {"thread_id": "inc_test_0001"}}
        result = await graph.ainvoke(initial, config=config)
        assert result["done"] is True
        assert len(result["notes"]) == 1
```

**Why `:memory:`:** In-memory SQLite for tests means no file cleanup, no flakiness, no shared state between tests. Each test gets a fresh fake DB.

```python
# tests/test_health.py  (HTTP-level, full stack)
async def test_incident_endpoint_runs_graph(client: AsyncClient) -> None:
    payload = {"alert_id": "a-http-1", "service": "checkout",
               "message": "latency p95 > 2s", "severity": "high"}
    response = await client.post("/incidents", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["done"] is True
```

**The `client` fixture is in `conftest.py`:**
```python
@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with (
        LifespanManager(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c,
    ):
        yield c
```

**Why `LifespanManager`:** Default `httpx.AsyncClient` + `ASGITransport` **does not run FastAPI's lifespan**. So without `asgi-lifespan.LifespanManager`, `app.state.graph` would never be created and the test would crash. `LifespanManager(app)` runs startup → yields → runs shutdown.

---

## 4. WHEN to use each pattern (for future projects)

| Pattern | When |
|---|---|
| `pyproject.toml` (no `requirements.txt`) | Every modern Python project. No exceptions. |
| `pydantic-settings` for env | Any app with more than 2 env vars |
| `structlog` JSON logs | Any app that will ship to prod OR any app you want traces/observability on |
| `TypedDict` for graph state | When your graph state needs reducers (`Annotated[list, add]`) |
| `Pydantic BaseModel` for graph state | When you don't need reducers and want runtime validation on state itself |
| `AsyncSqliteSaver` | Any LangGraph project — use `MemorySaver` only for one-off notebook experiments |
| FastAPI `lifespan` | Whenever the app opens any long-lived resource (DB, Redis, LLM client, vector store) |
| Layered tests (direct + HTTP) | Any project where you want to isolate bugs to the right layer |
| `LifespanManager` in tests | Whenever your app uses lifespan AND you test the HTTP layer |

---

## 5. KEY CONCEPTS

### Checkpointer
A LangGraph component that persists graph state after every node execution. Enables:
- **Resume after crash** — process dies mid-graph, restart picks up from last checkpoint
- **Human-in-the-loop** — `interrupt()` pauses, human approves 20 minutes later, `ainvoke` resumes
- **Time travel** — inspect or replay from any prior step
- **Conversation memory** — same `thread_id` across invocations = shared history

### Reducer
A function that says "when a node returns an update for this field, how should it merge with the existing value?" Default: replace. With `Annotated[list, add]`: concatenate. With a custom function: anything you want.

### `thread_id`
The primary key that identifies a single graph execution (or conversation, or incident) in the checkpointer. Two invocations with the same thread_id share state; two with different thread_ids are isolated.

### FastAPI `lifespan`
An async context manager registered with FastAPI. Code before `yield` runs at startup, code after runs at shutdown. Replaces the older `@app.on_event("startup")` decorators.

### `TypedDict` vs `dict`
`dict` has no compile-time field guarantees. `TypedDict` gives you exact-field typing with zero runtime cost — mypy catches `state["incidnt_id"]` typos, but Python still stores a plain dict.

### Pydantic `BaseModel`
Runtime validation + coercion. When FastAPI sees `payload: IncidentInput` in your route signature, it deserializes + validates the JSON body automatically and returns a 422 if invalid.

### Generic type parameters in LangGraph 1.x
`CompiledStateGraph[StateT, ContextT, InputT, OutputT]`:
- `StateT` — the schema of the state dict
- `ContextT` — optional runtime context (usually `Any` unless you use it)
- `InputT` — the type `.ainvoke()` accepts
- `OutputT` — the type `.ainvoke()` returns

Strict mypy refuses `CompiledStateGraph` without the params. We aliased it as `IncidentGraph` to keep code clean.

---

## 6. MISTAKES & GOTCHAS (real ones we hit)

### ❌ `CompiledStateGraph` without generics — mypy error
**Error:** `Missing type arguments for generic type "CompiledStateGraph"`
**Fix:** Parametrize it. LangGraph 1.x `CompiledStateGraph` is `Generic[StateT, ContextT, InputT, OutputT]`. Aliased as `IncidentGraph`.

### ❌ `class Severity(str, Enum)` deprecated in 3.11+
**Error:** `UP042 Class Severity inherits from both str and enum.Enum`
**Fix:** `from enum import StrEnum; class Severity(StrEnum):`

### ❌ Nested `with` statements flagged
**Error:** `SIM117 Use a single with statement with multiple contexts`
**Fix:** Python 3.10+ parenthesized syntax:
```python
async with (
    LifespanManager(app),
    AsyncClient(...) as c,
):
```

### ❌ `ANN101`/`ANN102` in ruff ignore list
**Warning:** Those rules were removed from ruff. Just delete them from the ignore list.

### ❌ `source .venv/Scripts/activate` on PowerShell
**Error:** `The term 'source' is not recognized`
**Fix:** On PowerShell use `.\.venv\Scripts\Activate.ps1`. On bash use `source .venv/Scripts/activate`. On cmd.exe use `.venv\Scripts\activate.bat`.

### ⚠️ VS Code IntelliCode popup
**Symptom:** Red popup "Sorry, something went wrong activating IntelliCode..."
**Fix:** Ignore it, or disable the IntelliCode extension — it's old tech and Pylance does the real work. Venv creation succeeds regardless.

### ⚠️ PowerShell's `curl` mangles JSON
**Symptom:** POST requests fail with weird errors when using `curl` in PowerShell
**Reason:** `curl` in PowerShell is an alias for `Invoke-WebRequest`, which uses different syntax
**Fix:** Use `curl.exe` explicitly (forces the real curl binary) and escape quotes with `\"`

### ⚠️ Default `httpx.AsyncClient` + `ASGITransport` does NOT run lifespan
**Symptom:** `AttributeError: 'State' object has no attribute 'graph'`
**Fix:** Wrap in `asgi_lifespan.LifespanManager(app)` in the fixture. This is why we added `asgi-lifespan` to dev deps.

### ❌ `pydantic-settings` does NOT leak `.env` keys into `os.environ`
**Symptom:** `.env` file had `LANGSMITH_API_KEY=...` and `LANGSMITH_TRACING=true`, but LangSmith dashboard stayed empty. No errors. Tests still green. App ran normally.

**Root cause:** `pydantic-settings` reads the `.env` file **only to populate fields declared on the `Settings` class**. Any other keys in the file are completely ignored — they do NOT reach `os.environ`. The `langsmith` SDK reads `LANGSMITH_*` directly from `os.environ`, so it never sees the values.

**Fix:** Call `python-dotenv`'s `load_dotenv()` at application startup **before importing anything that reads env vars**:
```python
# src/sentinel/main.py — top of file, before any other imports
from dotenv import load_dotenv
load_dotenv()

# then the rest of the imports (with noqa: E402 because ruff hates imports after code)
from fastapi import FastAPI  # noqa: E402
...
```
And add `python-dotenv>=1.0` to `[project.dependencies]` in `pyproject.toml`.

**Why this is a "production-grade" gotcha worth remembering:** `load_dotenv()` must run **before the first import of any module that reads env vars on import**. The `langsmith` SDK checks `LANGSMITH_*` at import time to decide whether to initialize its background trace uploader — if those vars aren't in `os.environ` at that moment, tracing is permanently disabled for the process even if you set them later. This is a classic gotcha with env-var-driven SDKs.

### ⚠️⚠️⚠️ Why the green tests DIDN'T catch the missing `.env`

This is the most important lesson of Phase 0 — write it on the wall.

**Question:** If the `.env` file was missing and LangSmith never received a trace, why did all 4 tests pass?

**Three layered reasons:**

**1. LangSmith fails silently by design.**
The `langsmith` SDK is built so that if tracing is misconfigured, the app keeps working. No exceptions, no warnings. This is *deliberate* — you don't want your app to crash at 3am because Datadog is down. So missing API key → silent drop → no signal.

**2. Our tests don't check whether a trace was sent.**

| Test | What it asserts | Touches LangSmith? |
|---|---|---|
| `test_triager_node_produces_note_and_marks_done` | Graph output is correct | No |
| `test_graph_checkpoint_persists_across_second_invocation` | State survives across calls | No |
| `test_health_returns_ok` | `/health` returns 200 | No |
| `test_incident_endpoint_runs_graph` | POST returns correct JSON | No |

Tests only verify what they assert. Silent failures (missing logs/metrics/traces) slip past green test runs constantly in real production.

**3. Tests don't even need `.env`.**
Every `Settings` field has a default, so a missing `.env` is silently accepted. Tests use in-memory SQLite (`:memory:`), so they never touch disk paths. The whole test suite is *isolated* from real environment config — a feature for speed/determinism, but a gap for config-related bugs.

**The production lesson — three tiers of testing:**

| Tier | What it checks | Speed |
|---|---|---|
| **Unit** | Pure logic with mocks | Milliseconds |
| **Integration** | Real deps in-process (our current tests) | Seconds |
| **Smoke** | Real deployed env, real external services | Minutes |

A smoke test for this bug would be: "after deploy, POST an incident, then query the LangSmith API for a trace with that incident_id — fail if not found within 30s." That's the level of rigor that catches "traces aren't being emitted."

**Three silent failures to watch for in every AI project (memorize these):**
1. **Observability drops** — traces/metrics/logs not emitted. Caught only by smoke tests or manual verification.
2. **LLM fallthrough** — provider returns empty string or malformed JSON, code keeps running with bad data. Caught by schema validation + output evals.
3. **RAG retrieval returns nothing** — search returns 0 docs, agent hallucinates from "general knowledge." Caught by retrieval-hit assertions in evals.

Sentinel will hit all three at some point. Instinctively ask "what's the silent failure mode?" for every new component.

---

## 7. INTERVIEW Q&A

### Q: Why use a checkpointer if your Phase 0 agent does nothing real?
**A:** Plumbing bugs are cheapest to fix when the surrounding code is trivial. If I wire the checkpointer later with 9 agents already in place, any checkpointing bug is tangled with agent logic bugs. By wiring AsyncSqliteSaver against a placeholder and proving with a test that state persists across invocations, I eliminate one variable permanently. When something breaks in Phase 6, I know it's not the checkpointer.

### Q: Why TypedDict for state instead of Pydantic BaseModel?
**A:** LangGraph's reducer system — `Annotated[list, add]` — is cleanest with TypedDict. Pydantic state works but adds serialization friction when reducers run. I use Pydantic where runtime validation matters most: at the API boundary (`IncidentInput` on the HTTP request) and for values that flow through the graph (`AgentNote`). TypedDict for the state *shape*, Pydantic for the *contents*.

### Q: Why `AsyncSqliteSaver` from day 1 and not `MemorySaver`?
**A:** "No placeholders that require rewriting." `MemorySaver` throws state away on process exit, so every test I write against it has to be rewritten when I swap to real persistence. `AsyncSqliteSaver` shares the same `BaseCheckpointSaver` interface as the Postgres checkpointer — I can move to Postgres in production with zero test changes.

### Q: What is `thread_id` and why does it matter?
**A:** It's the primary key the checkpointer uses to identify a run. In Sentinel's case, one incident = one `thread_id`. This is critical for Phase 6's HITL approval: the graph hits `interrupt()`, a human approves 20 minutes later, we call `ainvoke` again with the same `thread_id`, and LangGraph resumes from exactly where it stopped. Without `thread_id` there is no resume — the second call would be a fresh run.

### Q: Why `structlog` over stdlib `logging`?
**A:** Stdlib logging defaults to free-text strings that are painful to parse in Datadog or Loki. structlog makes JSON the default and lets you bind context: `log.info("triager.run", incident_id="inc_abc", severity="high")`. Retrofitting structured logging after the fact is a multi-day refactor; wiring it on day 1 is free.

### Q: Why FastAPI `lifespan`?
**A:** The checkpointer holds a long-lived async SQLite connection. If we open it per request, we eat the connection cost every time. If we open it in module-level code, it never closes cleanly on shutdown and can leave SQLite lock files. `lifespan` is FastAPI's official startup/shutdown hook — the async-context-manager pattern guarantees both open and close run exactly once.

### Q: Why do you have tests that skip the HTTP layer?
**A:** Layered testing. `test_graph_hello.py` tests the graph as a pure Python object — fast (~0.02s), deterministic, no FastAPI involvement. `test_health.py` tests the full HTTP stack — slower but catches routing and lifespan bugs. If the graph test passes and the HTTP test fails, I know the bug is in FastAPI wiring, not the agent. This isolation compounds: by Phase 5 I'll have 30 graph-level tests that run in under a second because they skip HTTP entirely.

### Q: What does `Annotated[list[AgentNote], add]` do?
**A:** It tells LangGraph: when a node returns `{"notes": [new_note]}`, merge the new list into the existing list by concatenation (`operator.add` on lists = `extend`). Without this annotation, the default rule is "replace" — so the notes would be overwritten by each node instead of accumulated. This is how 5 agents can each contribute one note and the final state has all 5.

### Q: Why did mypy require 4 generic type parameters on `CompiledStateGraph`?
**A:** In LangGraph 1.x, `CompiledStateGraph` is `Generic[StateT, ContextT, InputT, OutputT]`. Under mypy strict mode (`disallow_any_generics` implied by `strict = true`), any generic must be parametrized. I aliased it as `IncidentGraph = CompiledStateGraph[IncidentState, Any, IncidentState, IncidentState]` so the 4-param signature doesn't spread through the codebase.

### Q: Your tests passed but LangSmith tracing was broken. How does that happen, and how do you prevent it?
**A:** Three reasons it happened:

1. **LangSmith fails silently by design** — missing API key → no trace → no error. This is correct behavior for observability infrastructure (you don't want your app to crash because your tracing provider is down), but it means misconfiguration can't be caught by a crash test.
2. **The tests didn't assert anything about LangSmith** — they checked graph output, checkpointing, and HTTP responses. None of those touch LangSmith, so LangSmith can be completely broken and all tests still pass.
3. **Tests used in-memory SQLite and default Settings** — they didn't even *need* a `.env` file, so "missing `.env`" wasn't a test-breaking condition.

How to prevent it: add a **smoke test tier** on top of unit + integration tests. A smoke test runs against a real deployed environment and verifies end-to-end — including "did a trace actually show up in LangSmith within 30 seconds." The general rule: for any component that can fail silently (observability, caching, async message publishing), you need an affirmative test that the signal was actually received on the other side, not just that your code called the API.

Three silent failure modes to watch for in every AI project:
- **Observability drops** (no traces, metrics, or logs emitted)
- **LLM fallthrough** (empty or malformed response, code keeps running with bad data)
- **RAG returns zero results** (agent answers from "general knowledge" and hallucinates)

### Q: Why does `load_dotenv()` have to run before importing other modules?
**A:** Many SDKs — including `langsmith` — read their config env vars **at import time**, not at first use. If `LANGSMITH_API_KEY` isn't in `os.environ` when `langsmith` gets imported, it decides tracing is disabled and that decision is permanent for the process. Even if you set the var later, the SDK has already initialized in "no tracing" mode. So `load_dotenv()` has to be the very first thing that touches the environment, before any `from langsmith...` import chain runs. That's why we put it at the top of `main.py` with `# noqa: E402` on the subsequent imports — ruff hates code-before-imports but this is the correct production pattern.

### Q: Why doesn't `pydantic-settings` handle the LangSmith env vars automatically if it's already reading `.env`?
**A:** Because `pydantic-settings` only cares about fields *declared on the Settings class*. It reads `.env` line by line and asks "is this key a field on Settings? If yes, set it. If no, ignore." `LANGSMITH_API_KEY` isn't a field on our `Settings` class (it's consumed by a third-party SDK), so `pydantic-settings` reads the line and drops it. The keys never reach `os.environ`. Two ways to fix: (a) add `LANGSMITH_*` as fields on Settings and manually push them to `os.environ` at startup, or (b) use `python-dotenv`'s `load_dotenv()` which pushes *every* key from `.env` into `os.environ` regardless. Option (b) is simpler and is what we did.

---

## 8. COMMANDS CHEAT SHEET

```powershell
# ---- first-time setup ----
cd D:\projects\sentinel
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -e ".[dev]"
Copy-Item .env.example .env   # then edit .env with LangSmith key

# ---- daily dev ----
.\.venv\Scripts\Activate.ps1

# type check
mypy src

# lint
ruff check src tests
ruff check src tests --fix            # auto-fix safe issues

# tests
pytest -v                              # full run
pytest tests/test_graph_hello.py -v    # one file
pytest -k "checkpoint" -v              # filter by name

# run the server
uvicorn sentinel.main:app --reload

# manual test the endpoint (PowerShell — use curl.exe and escape quotes)
curl.exe -X POST http://localhost:8000/incidents `
  -H "Content-Type: application/json" `
  -d '{\"alert_id\":\"a1\",\"service\":\"api-gateway\",\"message\":\"5xx spike\",\"severity\":\"high\"}'

# ---- git ----
git init
git add .
git commit -m "phase 0: project scaffolding + hello graph"
```

---

## 9. WHAT'S NEXT — Phase 1: The Simulated Infra Lab

We build a FastAPI sub-app that hosts **6 fake microservices** running as async tasks inside the same process. Each service exposes metrics and logs through Loki-style and Prometheus-style endpoints, and can be deterministically broken on demand via a control panel: memory leak, crash loop, latency spike, 5xx surge, DB connection pool exhaustion, cert expiry.

This is the environment that real Sentinel agents will observe in Phase 2+. The deterministic failures mean we get **replayable regression tests for free** — same failure, same observable signals, same expected diagnosis every time. Without this lab, we'd need real infrastructure to test against, which would be slow, flaky, and expensive. With it, Sentinel becomes a project you can demo on a laptop with zero external dependencies.
