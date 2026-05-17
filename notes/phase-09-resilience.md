# Phase 9 — Resilience Core

> **Status:** Complete — every LLM call now routes through one resilient path with
> timeout + transient-retry + schema-repair + model fallback. Proven by 3 passing tests
> that simulate each failure mode with zero real API calls (0.25s, offline).
>
> **Duration:** 1 session
>
> **Deliverable:** `sentinel/agents/llm.py` — a single `structured_invoke(schema, messages)`
> that all four agents (triager, investigators, analyst, scribe) call instead of building
> their own LLM. A rate-limit, hang, or malformed-JSON no longer crashes an incident.

---

## 1. WHY this phase exists

Before Phase 9, every agent did `_llm.with_structured_output(X).ainvoke(...)` directly —
four copies, zero protection. On free-tier Gemini, one 429 mid-incident crashed the entire
graph. An SRE tool that falls over under load is not demoable. Resilience had to land before
any further features, or everything built on top sits on sand.

The fix is one hardened invocation path every agent shares. Harden once → all agents benefit.

---

## 2. WHAT we built — file by file

```
src/sentinel/agents/
├── llm.py        ← NEW: structured_invoke + _invoke_with_retry + _append_repair
├── triager.py    ← UPDATED: calls structured_invoke; deleted _llm + settings import
├── investigators.py ← UPDATED: same
├── analyst.py    ← UPDATED: same (two call sites: analyst + critic)
└── scribe.py     ← UPDATED: same

tests/
└── test_resilience.py ← NEW: 3 tests proving retry / repair / fallback
```

---

## 3. HOW it works — the four layers, inside out

### 3a. The seam — one function, generically typed

```python
_T = TypeVar("_T", bound=BaseModel)

async def structured_invoke(schema: type[_T], messages: list[BaseMessage] | str) -> _T: ...
```

`TypeVar` bound to `BaseModel` + `type[_T] -> _T`: pass `TriagerFindings`, get
`TriagerFindings` back — correctly typed for every agent from one function. A function, not
a class, because there's no state to hold (counterpoint to the DataSource ABC — reach for a
class only when there's state or a contract).

### 3b. Layer 1 — hard timeout

```python
await asyncio.wait_for(structured.ainvoke(messages), timeout=_TIMEOUT_S)
```

`ainvoke(messages)` is *called but not awaited* — it returns a coroutine; `wait_for` awaits
it with a stopwatch. Converts "hangs forever" into "fails at 60s." Without it a stalled
Gemini call freezes the incident node permanently with no error.

### 3c. Layer 2 — transient-retry with exponential backoff

```python
for attempt in range(_MAX_ATTEMPTS):
    try:
        return await asyncio.wait_for(...)
    except _RETRYABLE:
        if attempt == _MAX_ATTEMPTS - 1:
            raise
        await asyncio.sleep(_BASE_BACKOFF_S * (2 ** attempt))   # 1s, 2s
```

`_RETRYABLE` is a **curated tuple** (timeout, 429, 503, 500, google DeadlineExceeded) — never
bare `except Exception`, which would wrongly retry permanent errors. Backoff is exponential
because hammering a rate-limited service makes it worse. `asyncio.sleep`, not `time.sleep` —
the recurring async rule (sleeping must yield the loop). Last attempt re-raises so the next
layer can catch it.

### 3d. Layer 3 — schema-repair retry (a *different* retry)

```python
except (ValidationError, OutputParserException) as e:
    if attempt == _MAX_ATTEMPTS - 1:
        raise
    messages = _append_repair(messages, e)   # feed the error back, try again
```

Two `except` blocks on one `try`. Python matches top-to-bottom; `ValidationError` is
deliberately **excluded** from `_RETRYABLE` so a bad-schema error falls to this second block.
Different trigger, different recovery: transient = *wait, same request*; schema = *modify the
request* (append the validation error so the model self-corrects), **no backoff** (waiting
doesn't fix comprehension; feedback does). `_append_repair` normalizes `str`-or-`list`
messages to a list, then appends a corrective `HumanMessage`.

### 3e. Layer 4 — model fallback (extract + parameterize)

```python
async def _invoke_with_retry(llm, schema, messages) -> _T:   # the loop, parameterized
    ...

async def structured_invoke(schema, messages) -> _T:
    try:
        return await _invoke_with_retry(_PRIMARY, schema, messages)
    except Exception as e:
        log.warning("llm.primary_exhausted_falling_back", error=str(e))
        return await _invoke_with_retry(_FALLBACK, schema, messages)
```

The retry loop is extracted **once** and parameterized by `llm`. Primary and fallback are
*guaranteed* identical behaviour because they run the same code with a different argument —
not two copies that drift. `except Exception` is correct **here** (final fallback boundary:
"primary dead for any reason → try backup") even though it was wrong inside the retry filter.
**Breadth of an `except` depends on its position in the stack** — narrow when filtering which
errors to retry, broad at a last-resort boundary. If the fallback also fails, it propagates:
both models down = a real outage, must surface loudly, not be hidden. The `log.warning` makes
a silent fallback visible — primary degrading for hours otherwise goes unnoticed.

Fallback model = `gemini-2.0-flash`, NOT `2.5-pro` (pro has the *tightest* free-tier limits;
falling back from a rate-limited model to a more-rate-limited one is pointless). Constants
named `_PRIMARY`/`_FALLBACK` (role, not model name) so swapping models is one line, isolated.

---

## 4. HOW we proved it — testing failure you can't trigger on demand

`tests/test_resilience.py`, 3 tests, 0.25s, zero real API calls. The flight-simulator idea:
you don't crash a real plane to train for engine failure — you simulate the exact failure
safely and repeatedly. Same for error-handling code.

- **Seam:** all calls go through `_PRIMARY`/`_FALLBACK` → swap those two = control everything.
- **`monkeypatch`:** replace `llm._PRIMARY` with a fake for one test, auto-restored after.
- **`AsyncMock(side_effect=...)`:** the scripted actor. `[error, good]` = "raise first call,
  succeed second" = a transient failure manufactured precisely. Bare exception = "raise
  every call" = a dead model (proves fallback).
- **`monkeypatch.setattr(llm, "_BASE_BACKOFF_S", 0.0)`:** don't *wait* in tests — test logic,
  not the clock. 3 retries in microseconds.
- **Assert return value AND behaviour:** `== good` plus
  `fallback.with_structured_output.assert_called_once()` (proves the backup actually ran,
  not luck).

This is the testability payoff of the DRY refactor — good architecture is testable
architecture, not a coincidence.

---

## 5. MISTAKES & GOTCHAS

| Mistake | Fix |
|---|---|
| Wrote a "return a structured llm" getter | Resilience wraps the *await*; the seam must be the *call*, not the object — nothing to retry on a getter |
| Re-defined `with_structured_output` with a `self` param outside a class; invented `with_response_format` | `.with_structured_output` already exists on the LLM; `self` is meaningless outside a class (read-docs rule) |
| Chose `gemini-2.5-pro` as fallback | Pro = tightest free-tier limits; use `2.0-flash` |
| Copy-pasted the whole retry loop for the fallback | Extract once, parameterize by `llm` — two copies drift and bite at 2am |
| `log("WARN", ...)` | Sentinel's `log` is structlog: `log.warning("event", key=val)` (the `log(level, msg)` form is the *services'* function, different codebase) |
| Forgot `OutputParserException` import | Used but unimported → NameError |
| Left unused `settings` import in 4 agents after deleting `_llm` | ruff F401 — delete it |

---

## 6. INTERVIEW Q&A

**Q: Two kinds of retry in one function — why, and how do they not collide?**
> Transient-infra failure (429/5xx/timeout) → wait + identical request. Bad-schema output →
> modify the request (feed the error back) + retry, no wait. They're separate `except`
> blocks; `ValidationError` is excluded from the retryable tuple so it falls through to the
> repair handler. Different cause, different recovery.

**Q: When is bare `except Exception` acceptable?**
> Only at a last-resort boundary where the intent is genuinely "recover from anything" — e.g.
> the fallback wrapper ("primary dead for any reason → try backup"). Inside a retry filter
> it's wrong: it'd retry permanent errors. Breadth depends on stack position.

**Q: How do you test code that handles failures you can't reproduce on demand?**
> Dependency injection so the failing component is swappable, then a mock with a scripted
> `side_effect` to inject the exact failure sequence deterministically. Assert both the
> return value and the recovery behaviour (e.g. that the fallback was actually invoked).

**Q: Why not just use LangChain's `.with_retry()` / `.with_fallbacks()`?**
> They cover transient retry and model fallback, but not schema-repair (re-prompting with the
> validation error) or a single unified policy with observability. A thin custom layer keeps
> all four concerns in one tested place with one log signal.

---

## 7. COMMANDS CHEAT SHEET

```powershell
# run the resilience proof
.venv\Scripts\python.exe -m pytest tests/test_resilience.py -v

# lint a file (ruff lives in the venv, not global python)
.venv\Scripts\python.exe -m ruff check src/sentinel/agents/llm.py

# auto-fix only import sorting on specific files (safe, targeted)
.venv\Scripts\python.exe -m ruff check --fix --select I <files>
```

---

## 8. KNOWN GAPS / CARRIED FORWARD

- Pre-existing lint debt (E501 long lines, an ambiguous `l`, a missing comma-space in
  `after_critic_routing`) predates Phase 9, untouched here. A strict CI lint would fail;
  worth a dedicated cleanup pass, out of scope for this phase.
- Exact Gemini transient exception classes (`_RETRYABLE`) are the best-known set from
  `google.api_core`; if a real 429 surfaces as a different type, adjust the tuple. Verify
  against a real rate-limit when one naturally occurs.

---

## 9. WHAT'S NEXT

Phase 10 — Scratchpad + Context Surgery: add a `thinking_process` field to every agent
schema (force reasoning before the answer) and replace blind 20-line log dumps with
targeted, time-windowed log queries. Biggest single jump in reasoning quality.
