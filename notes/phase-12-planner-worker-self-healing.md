# Phase 12 — Planner–Worker + Self-Healing Verification

> **Status:** Complete. The self-healing loop (plan → execute → verify → replan →
> bounded-exhaust → escalate → classified outcome → post-mortem) is wired and proven:
> a live lab e2e exercised the EXHAUSTED path end-to-end; a deterministic test suite
> proves RESOLVED/ESCALATED/REJECTED/EXHAUSTED + verify routing.
>
> **Duration:** the longest phase — heavy design back-and-forth (this is where Arnav
> started driving the decomposition himself).
>
> **Deliverable:** Runbook Planner (LLM, structured plan) → step-iterating Executor
> (deterministic dispatch, critical-step early-stop) → deterministic Verifier
> (health → metrics → time-windowed error logs) → routing loop bounded by
> `remediation_attempts` → `finalize` classifies a deterministic `IncidentOutcome`.

---

## 1. WHY

The old executor did one hardcoded `ds.heal()`. Real remediation is a *sequence*, it
can *fail*, and the system must *verify* recovery and *escalate* honestly when it can't.
This phase is the spine the Phase 16 Claude-Code real-fix agent plugs into — build the
inert-plan / step-worker / verify-loop seam now; add real execution later as one more
action.

---

## 2. WHAT — file by file

```
src/sentinel/agents/
├── state.py    ← RemediationAction enum, RemediationStep(+critical), RemediationPlan
│                  (steps min_length=1), StepResult(ok/detail), VerificationResult,
│                  IncidentOutcome enum + state fields (remediation_plan,
│                  executor_result[add], verification, remediation_attempts,
│                  remediation_applied_at, outcome)
├── planner.py  ← runbook_planner_node + after_planner_routing (bounded by
│                  _MAX_REMEDIATION_ATTEMPTS; replan reads prior failure)
├── executor.py ← execute_step (match-dispatch), executor_node (critical early-stop),
│                  after_executor_routing
├── verifier.py ← verifier_node (deterministic 3-layer) + after_verify_routing
├── finalize.py ← NEW: terminal outcome classifier (moved out of analyst.py)
└── graph.py    ← planner/verifier nodes + the conditional-edge web
src/sentinel/datasource/  ← get_health added to ABC + Lab + GCP (status-code based)
src/sentinel/lab/routes.py ← /health route (200 / 503)
src/sentinel/api/incidents.py ← surface outcome (+ plan/executor/verification)
tests/test_phase12_finalize.py ← deterministic proof of all outcome branches
```

---

## 3. HOW — the concepts that matter

### 3a. Plan-then-execute, NOT ReAct
The planner LLM emits a *complete inert plan* from a constrained enum; a deterministic
worker dispatches it. The LLM is **not** in the execution loop. Why this beats ReAct
here: the whole plan exists *before* anything runs → it's auditable / HITL-gate-able /
dry-runnable; execution is deterministic & cheap (one planning call, not N round-trips);
the enum is a pre-validated tool registry. (Arnav derived this from the "isn't
execute_step redundant?" observation.)

### 3b. The loop is ONE level (plan-level), not three
Per-step success = inline `StepResult.ok` (the executor knows immediately, no node).
Overall recovery = the verifier, **once**, after the plan. The retry loop is
plan↔verify, bounded by `remediation_attempts` (= the Phase 4 reflection pattern, re-
derived). No per-step verify node, no per-step retry, no "current step" state.

### 3c. Critical-step early-stop + check results-not-plan
Executor `break`s on the first `not ok and step.critical`. Routing checks
`executor_result` (what *ran*), never `remediation_plan.steps` (what was *planned*) — a
critical break can skip a trailing step, so the plan can contain actions that never
executed. This made the routing robust even to a prompt-violating trailing ESCALATE.

### 3d. Deterministic verifier, asymmetric safety
Health → metrics → **time-windowed** error logs (`ts > remediation_applied_at` — the
stale-log fix from Phase 10, applied here), layered short-circuit. No LLM: it's a
control-flow gate in a retry loop; an LLM there is nondeterministic + costs a call every
attempt. The "is it flapping vs stale?" ambiguity that *seemed* to need an LLM is
solved by the timestamp window, not judgment. Any LLM judgment moved to the *planner*
(context-rich) reading the raw failure on replan — never a lossy verifier-LLM
intermediary between evidence and the reasoner.

### 3e. Make illegal states unrepresentable
`RemediationPlan.remediation_steps = Field(min_length=1)` → an empty plan is a
`ValidationError` → the Phase 9 schema-repair loop self-corrects. Prompt *asks*,
schema *enforces*, repair-loop *fixes* — three cheap layers, zero runtime gymnastics.
(Recommended follow-on: a `model_validator` enforcing "ESCALATE ⇒ sole step" the same way.)

### 3f. finalize = deterministic outcome classifier
Routing functions return a route and **cannot mutate state**; recording the terminal
outcome is mutation → it lives in `finalize`, the convergence node. Order matters
(rejected → exhausted/None → escalated → resolved → defect) because earlier branches
imply a None plan and would crash a later `.attr` access. The deterministic `outcome`
(surfaced in the API + fed to the scribe) replaces brittle prose inference.

---

## 4. THE LIVE FINDING (lab e2e, leak-free)

crash_loop injected → triager/investigators correctly diagnosed → planner chose
**`rollback`** (textbook-correct for a code-defect crash loop, following the root
cause's recommended fix) → executor ran it (`ok`) → **verifier FAIL: HTTP 503** ×3 →
`remediation_attempts` guard fired at 3 → escalated → `outcome=exhausted` →
post-mortem. **Every Phase 12 mechanism verified live.** It exhausted *because* only
`HEAL` is wired to a real effect in the simulator (`rollback` is an honest no-op stub);
the verifier *correctly* caught non-recovery via the real health endpoint (503, *not*
stale logs — it short-circuited at layer 1). The system **failed honestly and safely
(escalate), never falsely claimed resolved** — the asymmetric-safety principle, proven.
This *motivates* Phase 16 (real executor) rather than being a bug.

---

## 5. MISTAKES & GOTCHAS

| Mistake | Lesson |
|---|---|
| `?:` / `step:step` (JS-isms in Python) | Python ternary `a if c else b`; kwargs use `=` |
| `(x for x in y)` in an `if` | a bare genexp is **always truthy** — use `any()`/`all()` |
| `finalize` touched `plan.steps` before the None check | check None-implying branches FIRST at a convergence node |
| `state.get("verification").verified` | convergence/terminal nodes validate inputs — guard None |
| checked the *plan* for ESCALATE | check `executor_result` (what ran), not the plan |
| `datetime(UTC)` | `datetime.now(UTC)`; constructor takes y/m/d, not a tz |
| named routers `*_node` | a router returns a route, not state → `*_routing` (match the existing convention; uniformity toward the *correct* one) |
| scribe `Status:` from a resolution-string heuristic | render from the deterministic `outcome`; never infer status from LLM prose |
| state field `remediation_applied` vs executor key `_at` | a key not in the TypedDict silently drops — names must match |
| lab error_rate jitter > 100% (cosmetic) | clamp jittered rates at 100 (deferred) |

---

## 6. INTERVIEW Q&A

**Q: Plan-then-execute vs ReAct — when/why?**
> Plan-then-execute when you need the full plan auditable/gate-able before acting and
> deterministic cheap execution (ops remediation). ReAct when the next action genuinely
> depends on observing the previous (exploratory). The enum is a pre-validated tool set.

**Q: Why is your verifier deterministic, not an LLM?**
> It's a control-flow gate inside a bounded retry loop — nondeterminism deciding
> loop-or-stop is unsafe, and an LLM call every attempt is costly. The apparent
> need for judgment (stale vs real errors) is solved deterministically with a
> post-remediation timestamp window. Judgment that *is* needed happens in the planner
> on replan, with full context and raw evidence.

**Q: A node must record an outcome — where, and why not in routing?**
> In a node, never a routing function (routers return a route, they don't mutate
> state). Specifically the convergence/terminal node (`finalize`), checked in an
> order where None-implying cases are handled before any attribute access.

**Q: How do you stop the LLM emitting an invalid plan (empty / mixed-escalate)?**
> Make it unrepresentable: a schema constraint (`min_length=1`, a `model_validator`)
> → ValidationError → the resilience layer's schema-repair loop re-prompts and the
> model fixes it. Prompt asks, schema enforces, repair fixes.

**Q: The post-mortem said "resolved" on an exhausted incident — what was wrong?**
> The Status was inferred from the LLM's prose via a brittle string check. Fixed to
> render from the deterministic `outcome` set by `finalize`. Structured field over
> LLM prose — the recurring rule.

---

## 7. COMMANDS

```powershell
.venv\Scripts\python.exe -m pytest tests/test_phase12_finalize.py -q   # all outcome branches
# lab e2e: server with SENTINEL_DATASOURCE=lab, then inject + trigger + approve
$env:SENTINEL_DATASOURCE="lab"; uvicorn sentinel.main:app --port 8000
# (forensics lesson) POST /lab/.../inject ALWAYS hits the in-process lab,
# regardless of datasource. Real Cloud Run is downed only by POST {url}/sabotage.
# datasource controls what the graph READS, not where an explicit inject GOES.
```

---

## 8. PROCESS LESSON (the meta-deliverable)

This phase introduced the **7-question decomposition framework** (Goal / Contract /
State / Seams / Data shapes / Failure-loop-branch / Reuse) and the mode shift: Arnav
drives the decomposition, Claude critiques. Skipping the 7 questions repeatedly
produced exactly the omissions they would have caught (missing notes, un-incremented
attempts, missing state wiring) — the framework's value, demonstrated by its absence.

---

## 9. CARRIED FORWARD (deferred, deliberate)

- Scribe body "Resolution" prose: now constrained (fed real executed steps + outcome,
  instructed not to invent) — full fidelity at Phase 16 (real remediation semantics).
- `model_validator` for "ESCALATE ⇒ sole step" — recommended, not yet added.
- lab generator error-rate clamp at 100% — cosmetic.
- Per-step `critical` accuracy is an unverified LLM judgment — eval candidate.
- RESOLVED proven by unit test; a live RESOLVED e2e awaits a HEAL-effective scenario
  (or Phase 16's real executor).

## 10. WHAT'S NEXT

Phase 13 — Safety guardrails: dual-track tools (Safe read-only vs Dangerous
write/destructive, the latter gated by the HITL `interrupt()`), and indirect
prompt-injection isolation (delimit + flag untrusted log text as data, not
instructions). Prerequisite before Phase 16 lets Claude Code touch real code/infra.
