# Phase 11 — Eval Harness

> **Status:** Complete. Leak-free eval suite runs against the lab; first run scored
> triage **83% (5/6)**, root-cause **100% (6/6, but a weak metric — see §6)**, and
> surfaced a concrete, named weakness a demo never would.
>
> **Duration:** 1 session
>
> **Deliverable:** `eval/` (repo root, sibling to `src/`/`tests/`): `cases.py` (labeled
> fixtures), `runner.py` (one case → graph → score), `scorer.py` (diagnosable result),
> `main.py` (loop + per-case isolation + aggregate + JSON export). Run against the lab
> datasource for determinism.

---

## 1. WHY

Phases 1–10 made us *believe* the pipeline works. An eval makes it *provable* with
numbers — and, more importantly, finds weaknesses a live demo hides. This is the artifact
that turns "impressive demo" into "measured system" in an interview: *"83% triage accuracy,
and here is the exact failure mode I found and why."*

---

## 2. WHAT — file by file

```
eval/                         ← repo ROOT, NOT src/ (it measures the product, isn't shipped)
├── __init__.py
├── cases.py    ← EvalCase model + EVAL_CASES: one labeled case per lab FailureMode
├── runner.py   ← run_eval_cases(): inject → trigger → approve → evaluate (one case)
├── scorer.py   ← evaluate(): triager_score + root_cause_score + diagnosable fields
└── main.py     ← loop EVAL_CASES, per-case try/except, means, JSON report
```

`eval/` lives at repo root because dependency direction is one-way: `eval` imports
`sentinel`; `sentinel` must never import `eval`. `pyproject` packages only `src/`, so eval
is auto-excluded from the deployed wheel. Same category as `tests/`.

---

## 3. HOW — the methodology that matters

### 3a. The cardinal rule — no label leakage

The triager's prompt includes the alert `message`. If the message contains the failure
mode (`"order-service is crash looping"`), the triager just **copies the answer out of the
prompt** — the eval would report fake 100% accuracy while measuring "can the LLM echo a
string." This is testing-on-the-answer, the eval equivalent of training on the test set.

Fix: the alert message is **symptom-level and category-agnostic**:
`"Automated monitoring alert: anomaly detected on {service}"`. The triager must derive the
category from the lab's logs+metrics — the only honest measurement. Everything that encodes
the answer (`name`, `inject_mode`, `expected_category`, `expected_root_cause_keywords`)
lives **scorer-side only** and never enters the prompt. (Earlier Phase 8/10 *demo* runs had
leaky messages — but they were integration smoke tests, never accuracy claims, so no prior
result is invalidated. Accuracy is measured only here, leak-free.)

### 3b. Eval runs on the lab — permanently, by design

Ground truth only exists where *we* injected the failure. Real GCP has no label and is
non-deterministic — you cannot score against it, ever. So eval ↔ lab is a permanent
pairing, selected by **purpose, not phase**: production uses `gcp`; the eval suite uses
`lab`. Same pipeline code, one config switch (the Phase 8 factory). Prod default stays
`datasource="gcp"`; the eval's server is launched with `SENTINEL_DATASOURCE=lab`.

### 3c. Runner / scorer / report separation

- **runner** = one case end-to-end (inject → trigger → approve → score), returns a result.
- **scorer** = pure scoring; returns a *diagnosable* `EvalResult` (expected vs actual,
  missed keywords, elapsed) — so a failing row explains *why*, not just *that*.
- **main** = loop + **per-case `try/except`** (one flaky case must not abort the suite —
  the eval must survive the failures it measures) + means + JSON.

Principle threaded through: *a function either computes or presents, not both; a result
must be diagnosable, not just a number; measure in the runner what you'll report later.*

---

## 4. RESULTS (first run, lab, leak-free)

| Case | Triage | Root cause |
|---|---|---|
| crash loop | ✅ | ✅ |
| memory leak | ✅ | ✅ |
| latency spike | ✅ | ✅ |
| **5xx surge** | **❌** | ✅ |
| connection pool | ✅ | ✅ |
| cert expiry | ✅ | ✅ |

**Triage 83% (5/6). Root-cause 100% (6/6).**

---

## 5. THE FINDING (the actual point of an eval)

The `surge_5xx` case was misclassified. Its root cause: *"a recurring `index out of range`
panic … causing frequent process restarts and an elevated error rate"* → the model called
it a **crash loop**. But the lab's surge_5xx signal is **uptime 86400s (normal) + 52% error
rate (partial)**; a crash loop is **uptime 12s + 100% errors**. The model **over-indexed on
"panic/restart" log phrasing and ignored the distinguishing metrics**. Named weakness:
*log-text pattern-matching overriding metric evidence on the surge_5xx↔crash_loop boundary.*
A demo would never have shown this. The eval did. That is the whole value.

---

## 6. HONEST LIMITATION — the 100% is weak, not a win

A test is only useful if it *can fail*. Triage (83%) failed once → it discriminates →
the number means something. Root-cause scoring only checks whether one common word
(`crash`, `memory`, `error`…) appears in the text — almost any on-topic root cause passes,
so it effectively **cannot fail**. Proof from this run: the 5xx case scored root-cause
**1.0 while triage was 0.0** — a *wrong* diagnosis passed, because `"error"` happened to
appear. So 100% here means "on-topic," not "correct." A metric that never fails is
decoration. **v2 fix:** stricter keyword sets or an LLM-as-judge that grades correctness,
not topicality. Stating this is rigor; flaunting the 100% would be the thing a sharp
interviewer dismantles in one question.

---

## 7. MISTAKES & GOTCHAS

| Mistake | Fix / lesson |
|---|---|
| `httpx.Client()` used with `await` | sync client; async needs `httpx.AsyncClient()` |
| scorer did `case_output["x"].failure_mode` | `response.json()` is plain dicts — `["x"]["failure_category"]`, no attribute access |
| `["failure_category"].value` on JSON | JSON leaf is already a `str`; enums don't survive JSON — no `.value` |
| `expected_keywords = expected_category` (×3) | wrong attr; `expected_category` is a StrEnum → iterating it yields *characters* |
| `e` referenced in `finally` | Py3 unbinds `except as e` at block exit — not available in `finally` |
| leaky alert message (mine, ×2) | symptom-level, category-agnostic message — hard rule now |
| `CaseReport.model_dump()` | `model_dump()` is a Pydantic-*instance* method; a `list` has none — serialize the *elements* (`.model_dump(mode="json")`) at append time |
| `py main.py` from inside `eval/` | absolute imports need `python -m eval.main` from repo root |
| timing set after trigger | measured only the cheap half; `Start_Time` must precede the trigger to span real MTTR |
| `datasource="lab"` left as default | prod default must be `gcp`; eval overrides via env |

## 8. INTERVIEW Q&A

**Q: How do you keep an LLM eval honest?**
> No label leakage — the input must not contain the answer. The alert message is
> symptom-level; everything encoding the expected result is scorer-side and never enters
> the prompt. Run against a deterministic fixture (the lab) with known ground truth, never
> against non-deterministic prod (no label, can't score).

**Q: Your root-cause score is 100% — great, right?**
> No — it's a weak metric. It only checks keyword presence, so it effectively can't fail;
> a wrong diagnosis passed it in my run. A metric that never fails has no discriminative
> power. The 83% triage number is the meaningful one. v2 needs a correctness judge.

**Q: Why does the eval run on the lab, not real services?**
> Ground truth. We inject the failure into the lab, so we know the correct label and it's
> deterministic. Real GCP has no label and varies run to run — unscoreable by definition.
> Same pipeline, datasource swapped by the factory; purpose-based, not a dev phase.

**Q: One case threw an exception — what happens to the suite?**
> Per-case `try/except` in the loop isolates it: that case is recorded as a failure (score
> 0, error captured) and the suite continues. An eval must survive the failures it measures.

## 9. COMMANDS

```powershell
# Terminal 1 — server with the LAB datasource (env overrides the gcp default)
cd D:\projects\sentinel
$env:SENTINEL_DATASOURCE = "lab"
.venv\Scripts\python.exe -m uvicorn sentinel.main:app --port 8000   # wait for sentinel.ready

# Terminal 2 — the eval, from repo ROOT (absolute imports need -m)
cd D:\projects\sentinel
.venv\Scripts\python.exe -m eval.main          # prints per-case + means, writes eval_report.json
```

## 10. WHAT'S NEXT

Phase 12 — Planner–Worker + Self-Healing Verification: the Runbook Planner emits a strict
numbered remediation array; the Executor iterates it step-by-step; a post-fix verification
step (re-check health/metrics) with automatic revert on failure. Core machinery the Phase
16 Claude Code agent plugs into.

(Deferred v2 eval items, deliberately: diagnosable JSON already done; add MTTR trend,
stricter/LLM-judge root-cause scoring, and `error_rate` as a separate metric.)
