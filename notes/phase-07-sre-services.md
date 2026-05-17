# Phase 7 — Real SRE Services (api-gateway)

> **Status:** Complete — api-gateway deployed to GCP Cloud Run, all endpoints live.
>
> **Duration:** 1 session
>
> **Deliverable:** A real FastAPI service deployed on Cloud Run that simulates three failure
> modes (crash_loop, memory_leak, latency_spike). Sentinel's investigators will call this
> service's real endpoints instead of the old in-process lab simulator.

---

## 1. WHY this phase exists

Phases 1-6 built the Sentinel pipeline but its data was fake — a local Python dict pretending
to be a service. Gemini was reasoning on made-up numbers. That's fine for testing the pipeline,
but it's not SRE. Real SRE tools read real signals from real services.

Phase 7 replaces the lab simulator with actual HTTP services deployed on GCP Cloud Run. The
same failure modes exist (crash_loop, memory_leak, latency_spike) but now they produce real
logs in Cloud Logging and real metrics from a real HTTP server — not Python dicts.

The path to "real":
1. Build simulator services with realistic failure behavior (this phase)
2. Wire Sentinel to call these real endpoints (next phase)
3. Replace simulators with real application code + Claude Code for actual fixes (future)

---

## 2. WHAT we built — file by file

```
sre-sandbox/
└── api-gateway/
    ├── main.py           ← FastAPI service with all endpoints
    ├── requirements.txt  ← fastapi + uvicorn[standard]
    └── Dockerfile        ← container definition for Cloud Run
```

### `requirements.txt`
```
fastapi
uvicorn[standard]
```

Two dependencies only. `uvicorn[standard]` includes websocket and HTTP/2 support via extras.

### `Dockerfile`
```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
```

### `main.py` — endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/health` | GET | Liveness check — returns 500 in crash_loop |
| `/metrics` | GET | Returns cpu, memory, latency, error_rate, uptime |
| `/sabotage` | POST | Injects a failure mode |
| `/heal` | GET | Resets to healthy |
| `/route` | GET | Simulates real traffic — updates request/error counts |

---

## 3. HOW it works — concept by concept

### 3a. Module-level state

```python
_failure_mode = "healthy"
_request_count = 0
_error_count = 0
_start_time = time.time()
_memory_sink: list = []
```

These live at module level — they persist for the entire process lifetime. FastAPI is a
long-running process, so these values accumulate across requests, exactly like real server
state. `_memory_sink` is a real memory leak — it actually grows Python's heap, not just
a number pretending to be memory.

### 3b. `global` keyword

```python
async def sabotage(request: SabotageRequest) -> Response:
    global _failure_mode
    _failure_mode = request.mode
```

`global` is only needed when **reassigning** a module-level variable inside a function.
Reading it works without `global`. Mutating it in place (like `_memory_sink.clear()`) also
works without `global` — you're not reassigning the variable, just changing what it points to.

### 3c. lifespan pattern

```python
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    log("INFO", "api-gateway STARTED")
    yield
    log("INFO", "api-gateway STOPPED")
```

The sandwich pattern: code before `yield` runs on startup, code after runs on shutdown.
`yield` is where the entire application lives. `@asynccontextmanager` turns a generator
function into a context manager — it handles the `__enter__`/`__exit__` protocol for you.

We had to look at Sentinel's code to remember this because the old `@app.on_event` decorator
is deprecated. Always use `lifespan` now.

### 3d. Structured JSON logging

```python
def log(level: str, message: str, **kwargs) -> None:
    print(json.dumps({
        "ts": datetime.now(UTC).isoformat(),
        "level": level,
        "service": "api-gateway",
        "message": message,
        **kwargs
    }), flush=True)
```

`flush=True` forces the output buffer to write immediately — critical in Docker/Cloud Run
where stdout is buffered. Without it, logs might never appear. `**kwargs` lets callers
attach arbitrary fields: `log("INFO", "healed", mode="healthy")`.

Cloud Run automatically captures stdout and sends it to Cloud Logging. No logging library
needed — just `print` to stdout.

### 3e. `_memory_sink` — real memory leak simulation

```python
_memory_sink.extend([0] * 10_000)              # in /route memory_leak branch
memory_mb = min(100 + len(_memory_sink) * 0.000008, 950)   # in /metrics
```

Every `/route` call in memory_leak mode appends 10,000 integers (each 8 bytes = 80KB) to
a list that never gets cleared. The list actually sits in Python's heap — this is a real
memory leak, not a fake number. `/metrics` reports it by reading `len(_memory_sink)` and
converting to MB: `elements × 8 bytes ÷ 1,000,000 bytes/MB = elements × 0.000008`.

Capped at 950MB so reported value doesn't exceed realistic RAM limits.

### 3f. crash_loop uptime simulation

```python
uptime_seconds=uptime_seconds % 17
```

A crash_looping service restarts every few seconds — uptime should always be tiny. Modulo
keeps the reported uptime small by returning the remainder: `47 % 17 = 13`, `51 % 17 = 0`.
Since uptime is a float, hitting exactly a multiple of 17 is nearly impossible. Any small
prime works — 17 was chosen because fewer numbers are divisible by it.

### 3g. `asyncio.sleep` vs `time.sleep`

```python
# WRONG in async functions:
time.sleep(delay)       # blocks the entire event loop

# CORRECT:
await asyncio.sleep(delay)   # yields control, other requests can run
```

FastAPI runs on an async event loop. `time.sleep` is synchronous — it freezes the entire
process for every request waiting on it. `asyncio.sleep` yields control back to the event
loop so other requests are processed while this one waits. Always use `await asyncio.sleep`
in async functions.

### 3h. error_rate_pct calculation

```python
error_rate_pct = (_error_count / _request_count * 100) if _request_count > 0 else 0.0
```

Guard against division by zero with a ternary. `_request_count` starts at 0 — dividing
before any requests would raise `ZeroDivisionError`. The ternary returns `0.0` until at
least one request has been made via `/route`.

---

## 4. Docker — the mental model

### Container vs VM

| | VM | Docker Container |
|---|---|---|
| Own OS kernel | Yes — full separate kernel | No — shares host kernel |
| Startup time | Minutes | Milliseconds |
| RAM overhead | GBs (entire OS) | MBs (just your app) |
| Isolation | Full hardware emulation | Process + filesystem + network |

Containers are NOT VMs. They're isolated processes that share the host OS kernel. Docker
adds a private filesystem and private network namespace around a normal process.

### Port mapping

The container has its own network namespace — completely isolated from your machine. The
server runs on port 8080 *inside* that namespace, invisible to the outside world.
`-p 8080:8080` cuts a hole: "forward traffic from host port 8080 into container port 8080."

### Layer caching — why order matters in Dockerfile

```dockerfile
COPY requirements.txt .        # ← copy deps FIRST
RUN pip install -r requirements.txt   # ← install deps
COPY . .                       # ← copy code LAST
```

Docker caches each layer. If you copy all code first, any code change (even one line)
invalidates the pip install layer and re-runs it — wasting minutes. Copying `requirements.txt`
first means pip only reruns when dependencies actually change.

---

## 5. Cloud Run — the mental model

Cloud Run is serverless containers. You give Google a container, it handles everything else:

- **No VMs to provision** — Google manages the underlying machines
- **Scales to zero** — no requests coming in = container shuts down = you pay nothing
- **Auto-scales up** — 1000 simultaneous requests = Google spins up multiple containers
- **Port 8080** — Cloud Run always expects your app on port 8080 (configurable but convention)
- **`--host 0.0.0.0`** — must accept connections from outside the container (not just localhost)

Cost for a dev/testing project like this: essentially $0. Free tier is 2 million requests/month.
No need to shut down deployments — Cloud Run scales to zero automatically.

---

## 6. MISTAKES & GOTCHAS

### Decorator with a colon
```python
# WRONG — colon after decorator
@app.get("/metrics", response_model=MetricsResponse):
    async def metrics():

# CORRECT
@app.get("/metrics", response_model=MetricsResponse)
async def metrics():
```
Decorators are function calls, not control flow. No colon.

### Function indented inside decorator
The `async def` was indented under the decorator, making Python think the function was
inside something. Decorators don't create a scope — the function definition should be at
module level (no indentation relative to the decorator).

### `global` for `.clear()` is unnecessary
```python
# UNNECESSARY — .clear() mutates in place, no reassignment
global _failure_mode, _memory_sink

# ONLY _failure_mode needs global (it gets reassigned)
global _failure_mode
```

### `random.unifrom` typo
`random.unifrom` → `random.uniform`. Python won't catch this until runtime.

### `time.sleep` in async handler
Using `time.sleep` in an `async def` blocks the entire event loop. Every other request
queues up behind it. Always `await asyncio.sleep` in async functions.

### GCP permissions on new projects
A fresh GCP project's service account has no roles by default. Cloud Build needs three
explicit grants before it can build and deploy:
- `roles/storage.objectViewer` — read source from GCS bucket
- `roles/logging.logWriter` — write build logs to Cloud Logging
- `roles/artifactregistry.writer` — push built container image

---

## 7. INTERVIEW Q&A

**Q: Why use structured JSON logging instead of print statements?**
> Cloud Logging (and most log aggregation systems) can parse JSON fields directly — you can
> filter by `level`, search by `service`, or query by custom fields like `mode`. Plain strings
> require regex to extract the same data. `flush=True` is critical in containers to prevent
> buffered output from being lost on crash.

**Q: What's the difference between `time.sleep` and `asyncio.sleep`?**
> `time.sleep` is a blocking call — it halts the OS thread for the duration. In an async
> framework, that freezes the entire event loop: no other requests can be handled. `asyncio.sleep`
> is a coroutine — it suspends only the current coroutine and yields the event loop to process
> other work. Always use `await asyncio.sleep` inside `async def` functions.

**Q: Why does Docker layer order matter?**
> Docker caches each instruction as a layer. When a layer's input changes, all subsequent layers
> are invalidated. Copying `requirements.txt` before code means the expensive `pip install` layer
> only reruns when dependencies change, not on every code change. Putting `COPY . .` first would
> re-run pip on every save.

**Q: What does Cloud Run's "scales to zero" mean in practice?**
> When no requests are coming in, Cloud Run terminates your container instances. You pay nothing
> during idle periods. When a new request arrives, Google starts a new container (cold start,
> ~200-500ms for Python), handles the request, and keeps the container warm for subsequent
> requests. For dev projects this means essentially zero cost. For production, you can set
> minimum instances > 0 to avoid cold starts at the cost of always paying for at least one instance.

**Q: Why does the executor call `/heal` instead of fixing code?**
> Right now the services are simulators — failure modes are a variable, not a real bug. The `/heal`
> endpoint is the remediation contract for the simulator phase. In a later phase, when services
> have real code with real bugs, the executor will spawn Claude Code to read logs, identify the
> failing line, write a patch, commit it, and trigger a redeploy. The `/heal` pattern establishes
> the executor→service interface before the real fix mechanism exists.

**Q: When would you use Cloud Run vs a VM (Compute Engine)?**
> Cloud Run: stateless APIs, microservices, event-driven workloads, anything where you want
> auto-scaling and zero ops overhead. VM: long-running processes that need persistent state,
> custom OS configuration, GPU workloads, or when you need a specific network topology.
> For an API gateway, Cloud Run is always the right answer.

---

## 8. COMMANDS CHEAT SHEET

```powershell
# Build Docker image locally
docker build -t api-gateway .

# Run locally (maps host 8080 → container 8080)
docker run -p 8080:8080 api-gateway

# Deploy to Cloud Run (builds + pushes + deploys in one command)
gcloud run deploy api-gateway `
  --source . `
  --region us-central1 `
  --allow-unauthenticated `
  --port 8080

# Grant Cloud Build service account permissions (run once per new GCP project)
gcloud projects add-iam-policy-binding sentinel-496513 `
  --member="serviceAccount:717499257054-compute@developer.gserviceaccount.com" `
  --role="roles/storage.objectViewer"

gcloud projects add-iam-policy-binding sentinel-496513 `
  --member="serviceAccount:717499257054-compute@developer.gserviceaccount.com" `
  --role="roles/logging.logWriter"

gcloud projects add-iam-policy-binding sentinel-496513 `
  --member="serviceAccount:717499257054-compute@developer.gserviceaccount.com" `
  --role="roles/artifactregistry.writer"

# Check recent builds
gcloud builds list --region=us-central1 --limit=5

# Get build logs
gcloud builds log <BUILD_ID> --region=us-central1

# Test endpoints
Invoke-RestMethod https://api-gateway-717499257054.us-central1.run.app/health
Invoke-RestMethod https://api-gateway-717499257054.us-central1.run.app/metrics
Invoke-RestMethod -Method POST -Uri https://api-gateway-717499257054.us-central1.run.app/sabotage `
  -ContentType "application/json" -Body '{"mode":"crash_loop"}'
Invoke-RestMethod https://api-gateway-717499257054.us-central1.run.app/heal
```

---

## 9. WHAT'S NEXT

Phase 7 continues with `order-service` and `inventory-service` — same pattern, different
failure characteristics. Then Phase 8 wires Sentinel's investigators to call these real Cloud
Run URLs instead of the old lab simulator, so Gemini reasons on real HTTP responses and real
Cloud Logging data for the first time.
