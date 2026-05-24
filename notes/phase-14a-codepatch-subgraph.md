# Phase 14a — Code-Patch Sub-Graph + Per-Step Executor

> **Status:** Wired and verified — graph compiles (16 nodes), 13 tests pass.
> The code-patch path is now a self-contained sub-graph with a distinct
> state schema; the parent executor is per-step; one shared router serves
> three callers. The next phase (16c) is intentionally deferred until this
> shape is in place — otherwise 16c gets built on a flat-state architecture
> and immediately refactored away.
>
> **Deliverable:** A real architectural boundary around the code-patch
> path. From the parent graph's perspective, "produce a verified patch" is
> one atomic node. The retry loop, the differential check, the bounded
> attempts, the per-attempt accumulators — all of that lives inside the
> sub-graph and never appears in `IncidentState`.

---

## 1. WHY

Two pressures converged here.

**Pressure A — multi-step plans that include a code patch.** Up to 16b,
the code-patch path was wired into the parent graph as flat nodes:
`executor → sandbox_verifier → (retry) executor → ...`. That worked
because every test plan was a single APPLY_CODE_PATCH step. The moment a
real plan looks like `[APPLY_CODE_PATCH, verify_health]`, the executor —
written to iterate the *whole plan* in one node invocation — has to
somehow yield control back to the graph mid-loop so `sandbox_verifier`
can run on the patch before `verify_health` does. That's not a
configurable feature of the executor; it's a different execution model.

**Pressure B — bounded context, separate concern.** The code-patch path
already has its own retry loop (16b), its own state (`patch_reports`,
`patch_verifications`), and its own outcome semantics (verified / fake
test / fix failed / exhausted). None of that has any business sitting
inside `IncidentState`, where the planner / executor / prod verifier
already live. Putting it there means every future agent reads or writes
fields that have nothing to do with its job — the textbook God-state
problem.

The sub-graph extraction solves both. The internal multi-attempt loop is
**encapsulated** behind one parent node, so the parent's per-step model
doesn't care that the patch took five iterations to verify. The parent
state shrinks to one cohesive result field (`CodePatchResult`) instead of
two per-attempt accumulators.

**Why before 16c?** 16c is "promote + validate-and-promote loop closure."
If we'd built that on the flat-state architecture, we'd have had to wire
the promote step + HITL gate + outcome handling against `patch_reports`
/ `patch_verification` directly — and then immediately refactor it into
the sub-graph when 14a landed. Doubly-done work. Building 14a first means
16c gets built once, on the clean shape.

---

## 2. WHAT — file by file

```
src/sentinel/subgraph/codepatch/                       (NEW package)
  __init__.py
        INTENTIONALLY EMPTY. The "public API __init__.py" pattern would
        re-export code_patch_node from graph.py, but graph.py imports
        IncidentState from agents/state.py, and agents/state.py wants
        CodePatchResult from this package — circular. Empty __init__
        breaks the cycle (see §3f). Consumers import from leaf modules.

  state.py
        + class PatchReport(BaseModel)              (moved from agents/state.py)
        + class PatchVerification(BaseModel)        (moved from agents/state.py)
        + class CodePatchState(TypedDict)
            - inputs:     incident_id, log_evidence, log_summary,
                          root_cause, recommended_fix,
                          patch_step_description
            - accumulators (Annotated, add reducer):
                          patch_reports, patch_verifications
            - terminal:   outcome (NotRequired Literal: verified /
                          exhausted / fix_failed / fake_test / error)
        + class CodePatchResult(BaseModel)
            outcome, last_report, last_verification, attempts
            — the cohesive summary the parent sees. The lists stay
            private to the sub-graph; the parent never reads them.

  codefixer.py                                          (moved from agents/code_fixer.py)
        + code_fixer_node(state: CodePatchState) -> dict
              wraps the CC SDK call; returns {"patch_reports": [report]}
              so the add reducer extends the accumulator.
        + _produce_patch(state, cwd) -> PatchReport
              builds the CC prompt from FLAT CodePatchState inputs
              (no parent state to traverse). Resumes the CC session on
              retry via prior_reports[-1].cc_session_id.

  patchverifier.py                                      (moved from agents/code_fixer.py)
        + sandbox_verifier_node(state: CodePatchState) -> dict
              the 16b differential check, retargeted at CodePatchState.
              Reads patch_reports[-1], writes one PatchVerification.

  helpers.py                                            (moved from agents/code_fixer.py)
        create_sandbox_env, fetch_sync_code, git, is_test_file, run_tests
        — shared by codefixer + patchverifier, no parent-state coupling.

  graph.py                                              (NEW — the compiled sub-graph)
        + build_code_patch_subgraph() -> CompiledStateGraph
              builder = StateGraph(CodePatchState)
              code_fixer → sandbox_verifier
                              ├ verified           → _done_verified → END
                              ├ failed, attempts<5 → code_fixer      (loop)
                              └ exhausted          → _done_exhausted → END
              No checkpointer passed — sub-graph inherits the parent's.
              Compiled at module load (one global instance, not per-call).
        + _after_verifier_routing(state)
              the internal loop router. Bound = len(patch_reports) < 5.
        + _done_verified_node / _done_exhausted_node
              terminal nodes that set state["outcome"] before END so the
              wrapper can read a deterministic outcome string. The
              _done_exhausted node classifies failure mode from the
              last verification's description.startswith(...).
        + code_patch_node(parent_state: IncidentState) -> dict
              THE WRAPPER. Three responsibilities:
                1. INPUT MAPPING — extract sub-graph inputs from
                   parent state (log_detective evidence, RCA, the
                   APPLY_CODE_PATCH step).
                2. INVOKE — await code_patch_subgraph.ainvoke(initial).
                3. OUTPUT MAPPING — translate sub-graph terminal state
                   into a parent delta:
                     code_patch_result: CodePatchResult
                     executor_result += [StepResult]  (so the existing
                                       critical-fail routing still fires)
                     next_step_index += 1            (advance the pointer)

src/sentinel/agents/state.py
  - class PatchReport, class PatchVerification       (moved to sub-graph)
  - IncidentState.patch_reports, .patch_verification (moved to sub-graph)
  + IncidentState.next_step_index: NotRequired[int]
        the per-step pointer (Option 3). No reducer — last-write-wins is
        correct here (executor and planner never write in the same
        superstep; the planner RESETS it on every plan).
  + IncidentState.code_patch_result: NotRequired[CodePatchResult | None]
        single cohesive result. Imported from
        sentinel.subgraph.codepatch.state (the leaf module — see §3f).

src/sentinel/agents/planner.py
  ~ planner_node returns {..., "next_step_index": 0, ...} on EVERY plan
        Fresh plans and replans alike — replan without this reset would
        inherit the prior plan's mid-list pointer (IndexError on a
        shorter new plan; skipped steps on a longer one).

src/sentinel/agents/executor.py
  ~ executor_node — REWRITTEN as per-step (Option 3)
        idx = state.get("next_step_index", 0)
        step = plan.remediation_steps[idx]
        result = await execute_step(step, ds, service)
        delta = {"executor_result": [result],            # one entry — add reducer
                 "next_step_index": idx + 1}
        On the last step also emit a summary note + remediation_applied_at.
        NEVER sees APPLY_CODE_PATCH — routing dispatches code_patch
        BEFORE the executor would run.
  ~ after_executor_routing → RENAMED to after_step_routing
        Decisions, in order:
          - no plan / no results so far → finalize
          - last result was critical+failed → planner (replan)
          - last result was ESCALATE → finalize
          - next_step_index >= len(steps) → verifier (prod-verify)
          - next step is APPLY_CODE_PATCH → code_patch
          - else → executor
        ONE router, THREE callers: executor, code_patch, and
        human_approval_plan-on-approve (delegated below).
  ~ after_human_plan_routing — approved branch delegates:
        approved → return after_step_routing(state)
        because a plan whose step 0 is APPLY_CODE_PATCH would crash an
        unconditional "approved → executor" edge. The shared router
        already knows how to dispatch.
  - dead imports + after_sandbox_verifier_routing + _MAX_PATCH_ATTEMPTS
        all gone; the retry loop lives inside the sub-graph now.

src/sentinel/agents/graph.py
  - imports from sentinel.agents.code_fixer            (file deleted)
  - convert_to_node                                    (broken stub deleted)
  - "sandbox_verifier" parent node + its router edge   (sub-graph internal)
  + import code_patch_node from sentinel.subgraph.codepatch.graph
        (leaf, not __init__.py — see §3f for why)
  + builder.add_node("code_patch", code_patch_node)
  + builder.add_conditional_edges("executor",   after_step_routing)
  + builder.add_conditional_edges("code_patch", after_step_routing)
  + builder.add_conditional_edges("human_approval_plan", after_human_plan_routing)
        (the approved branch internally calls after_step_routing)

src/sentinel/agents/code_fixer.py                      (DELETED)
        ~420 lines split across the sub-graph's codefixer.py,
        patchverifier.py, helpers.py. Nothing left at the parent level.

tests/_check_codefixer.py
  ~ entry point changed from agents.code_fixer.code_fixer (function over
    IncidentState) to subgraph.codepatch.codefixer.code_fixer_node
    (function over CodePatchState). The hand-built state is now FLAT
    sub-graph inputs — exactly what the wrapper would construct.
```

---

## 3. HOW — the headline ideas

### 3a. Why a sub-graph and not "just a folder of nodes"

The temptation: leave the code_fixer + sandbox_verifier nodes at the
parent level, just *move the files* into a folder for tidiness. That's
folder-cohesion, not architecture. The retry loop's edges still attach
to the parent graph; the patch state still pollutes IncidentState; the
bound (`len(patch_reports) < 5`) is still read off parent state.

A sub-graph is a real boundary, not a folder:

- It has its **own compiled StateGraph** with its own START/END.
- It has its **own TypedDict state schema** — `IncidentState` is
  invisible from inside.
- The retry loop is a closed cycle inside that compiled graph — the
  parent graph's routing function knows nothing about it.
- The parent graph treats the sub-graph as one node with one input and
  one output. The wrapper does input mapping → ainvoke → output mapping.

That's encapsulation. Folder cohesion is hygiene.

### 3b. Distinct schema vs shared — and the wrapper

Two ways to register a sub-graph in LangGraph:

1. **Shared schema:** the sub-graph reads/writes the same TypedDict the
   parent uses. Convenient (no mapping code), invasive (every field the
   sub-graph touches is parent state — every node in the parent can
   read it). The "God state" trap.

2. **Distinct schema:** sub-graph has its own TypedDict; the parent's
   wrapper translates parent→child on entry and child→parent on exit.
   More code (the wrapper), real boundary (the parent state has zero
   per-attempt accumulators).

Distinct was the right call here precisely because the sub-graph has
internal accumulators (`patch_reports`, `patch_verifications`) the
parent has no business knowing about. The parent only needs the
*answer*: did we get a verified patch, what does it look like, how
many attempts.

The wrapper (`code_patch_node`) is where the boundary lives:

```python
async def code_patch_node(parent_state: IncidentState) -> dict:
    # INPUT MAPPING — gather what the sub-graph needs from parent state
    initial: CodePatchState = {
        "incident_id":        parent_state["incident_id"],
        "log_evidence":       <from log_detective>,
        "log_summary":        <from log_detective>,
        "root_cause":         <from RCA>,
        "recommended_fix":    <from RCA>,
        "patch_step_description": <the APPLY_CODE_PATCH step's description>,
        "patch_reports":      [],
        "patch_verifications": [],
    }

    # INVOKE — sub-graph runs its retry loop to a terminal state
    sub_result = await code_patch_subgraph.ainvoke(initial)

    # OUTPUT MAPPING — translate to parent delta
    result = CodePatchResult(
        outcome=sub_result.get("outcome", "error"),
        last_report=...,
        last_verification=...,
        attempts=len(sub_result.get("patch_reports") or []),
    )
    return {
        "code_patch_result": result,
        "executor_result":   [StepResult(...)],      # for critical-fail routing
        "next_step_index":   parent_state.get("next_step_index", 0) + 1,
    }
```

The wrapper is also the one place the sub-graph's `outcome` Literal is
translated into something the parent can act on — and where the
sub-graph's per-attempt verbosity collapses into one summary.

### 3c. Option 3 (step-pointer) — and why it beats the two alternatives

Three execution models for "multi-step plan with a sub-graph in the
middle":

| Option | Shape | Why not |
|---|---|---|
| **1. Single-step constraint** | Force every plan to be exactly one step (APPLY_CODE_PATCH or `[restart, verify_health]` but never mixed). | Pushes the problem into the planner with no real solution — what if the right plan IS mixed? Solves the symptom, not the cause. |
| **2. Embedded sub-graph call** | Executor iterates all steps in one node, calls `await code_patch_subgraph.ainvoke(...)` inline for an APPLY_CODE_PATCH step. | **Re-run-from-top hazard.** When the sub-graph eventually adds an HITL interrupt() (Phase 16d), the parent node *re-runs from its top* on resume. Anything before the interrupt runs twice — including the already-completed prior steps in the same plan. |
| **3. Step-pointer (chosen)** | Executor processes ONE step per node invocation, advances `next_step_index`, returns. The router peeks the next step and dispatches to executor or code_patch. | Each invocation does atomically one step. The sub-graph is its own node (its own interrupt re-run scope, not the parent's). The graph topology *is* the iteration, visible in the dashboard. |

Option 3 means the **graph itself is the for-loop.** Every iteration of
the plan is one superstep, persisted by the checkpointer, replayable.
That's the same architectural choice Phase 12 made with the
plan↔verify cycle (a real graph cycle, not a Python `while` inside a
node) — applied at the step level instead of the plan level.

### 3d. One router, three triggers — the naming change

The shared router gets called from three places:

```
human_approval_plan ──(approved)──► after_step_routing
        executor   ───────────────► after_step_routing
        code_patch ───────────────► after_step_routing
```

It was originally named `after_executor_routing`, then doubled as
"after code_patch" routing too, then `human_approval_plan` started
delegating to it. At that point the name was lying. Renamed to
`after_step_routing` because the routing unit is one plan **step** —
independent of which node produced it.

Tell that the abstraction is at the right level: all three callers can
share the same router, no `if came_from_codepatch: ...` branches inside
it. When two distinct triggers route on the same logic, the trigger
isn't what they have in common; the *thing being routed on* is. Name
the router after that.

The human-approval delegation is also where the dispatch happens for
step 0:

```python
def after_human_plan_routing(state):
    if state["human_decision_plan"] == "approved":
        return after_step_routing(state)   # dispatch step 0 correctly
    return "finalize"
```

A naive `approved → "executor"` would have routed an APPLY_CODE_PATCH
plan straight to the executor, which crashes (`execute_step` doesn't
handle APPLY_CODE_PATCH). The router already knows what to do with
step 0; delegate.

### 3e. The wrapper bumps next_step_index — and why the routing after code_patch is identical to after executor

The wrapper itself writes `next_step_index += 1`. Consequence: by the
time the routing function fires after code_patch, the pointer is
already advanced — same state as when the executor returns. So the
router's "peek the next step and dispatch" logic works for *both*
upstream nodes without any if/else.

This is the cleanest tell that the sub-graph abstraction is the right
shape. If the router needed to know which node it came from, the
boundary would be in the wrong place. It doesn't.

### 3f. The circular import — when "public API __init__.py" bites

The intended public API was:

```python
# subgraph/codepatch/__init__.py
from sentinel.subgraph.codepatch.graph import code_patch_node
from sentinel.subgraph.codepatch.state import CodePatchResult
__all__ = ["code_patch_node", "CodePatchResult"]
```

So that consumers could `from sentinel.subgraph.codepatch import
code_patch_node, CodePatchResult`. Tidy. Broken.

The cycle:

```
agents/state.py
  └─ needs CodePatchResult (type of the code_patch_result field)
  └─ from sentinel.subgraph.codepatch.state import CodePatchResult
        ↓ Python ALWAYS runs the package __init__.py first
  └─ subgraph/codepatch/__init__.py
       └─ from sentinel.subgraph.codepatch.graph import code_patch_node
            └─ subgraph/codepatch/graph.py
                 └─ from sentinel.agents.state import IncidentState
                      ↓ but agents/state.py is STILL LOADING
                      ↓ IncidentState is not yet defined
                      └─ ImportError
```

The Python rule: **importing any submodule of a package runs the
package's `__init__.py` first**, fully, before exposing the submodule.
There's no way around that. So a "public API __init__.py" only works
when none of its re-exports transitively depend on a module that's
importing back into the package.

Here, `graph.py` legitimately needs `IncidentState` from the parent
(the wrapper takes parent state). That couples `__init__.py` to
`agents/state.py` — and `agents/state.py` needs `CodePatchResult` from
this package. Cycle.

The fix is structural: **make `__init__.py` empty.** Consumers import
from leaf modules directly:

```python
# agents/state.py    — leaf state, no parent imports → safe
from sentinel.subgraph.codepatch.state import CodePatchResult

# agents/graph.py    — by now agents/state.py is fully loaded
from sentinel.subgraph.codepatch.graph import code_patch_node
```

Two things to understand:

1. Importing `subgraph.codepatch.state` still triggers
   `subgraph/codepatch/__init__.py` first — but now that file does
   nothing, so it completes immediately. Then state.py loads (it has no
   imports from `agents/`, so it's pure data — no cycle).
2. By the time `agents/graph.py` imports
   `subgraph.codepatch.graph`, `agents/state.py` is fully loaded.
   `graph.py` can pull `IncidentState` without seeing a partial module.

The general rule, written down:

> A package's `__init__.py` should re-export **only** from submodules that
> have no transitive dependency on any module that might import this
> package. If even one re-exported module needs the parent's types, leave
> `__init__.py` empty and let consumers import leaves directly.

### 3g. The "moved" files — what's deliberately the same, what's deliberately different

`codefixer.py`, `patchverifier.py`, `helpers.py` are not blind copies of
the old `agents/code_fixer.py`. They're shaped for the new boundary:

- They take **`CodePatchState`**, not `IncidentState`. The function
  signatures change from `state: IncidentState` to `state:
  CodePatchState`. Inside, there's no `state.get("input").service` or
  `state.get("investigator_findings")` — those are parent fields. The
  inputs are flat (`state["root_cause"]`, `state["log_summary"]`) —
  exactly what the wrapper put there.
- They write to **`patch_verifications`** (plural). The old parent
  field was `patch_verification` (singular — a naming bug that would
  have hidden later when something read the singular form expecting
  the plural). Cleaned up at the boundary.
- The retry loop bound (`_MAX_PATCH_ATTEMPTS = 5`) lives inside the
  sub-graph's `graph.py`, not the parent's executor. The parent has
  no concept of "patch attempts."

What stays identical: the CC system prompt (verbatim — that's the
contract with the SDK), the differential-check algorithm (16b's
contribution — `pass-on-fix AND fail-on-parent`), the failure-mode
naming convention (`FIX FAILED` / `FAKE TEST` / `CODE FIX FAILED` /
`VERIFICATION ERROR` as the first token of `description`).

### 3h. Sub-graph inherits parent's checkpointer — do NOT pass one

In `build_code_patch_subgraph()`:

```python
return builder.compile()   # no checkpointer=
```

LangGraph passes the parent's checkpointer down to sub-graphs
automatically when they're invoked as nodes. Compiling the sub-graph
with its own checkpointer creates *two* persistence layers; on resume
they fight. The right shape is the parent owns checkpointing; the
sub-graph just compiles.

This matters more in 16d when HITL inside the sub-graph lands — but
it's a free correctness win to set up now.

---

## 4. MISTAKES & GOTCHAS

| Mistake | Lesson |
|---|---|
| `Field(...)` inside a `TypedDict` | TypedDicts are not Pydantic models — no validation, no Field. Plain annotations. |
| `verified: bool` field in CodePatchState alongside `patch_verifications` | redundant — `patch_verifications[-1].ok` is the latest verdict. Don't store derived state; recompute on read. |
| `patch_iterations: int` counter | same — `len(patch_reports)` *is* the counter. The list length is the bound. |
| `step_results = state.get("executor_result"); step_results.append(result); return {"executor_result": step_results}` | with the `add` reducer, this DOUBLE-EXTENDS — the reducer concatenates `step_results` (which already includes `result` from your append) with the prior state. Return `[result]` only. |
| `step_index = state.get("step_index")` (no default) | first call returns `None`; `None < len(...)` crashes. `state.get("step_index", 0)`. |
| `step.remediation_action == ...` referenced before `step` was assigned | NameError. Make sure the variable exists before the conditional. |
| `step_index + 1` when peeking next step | the executor already incremented in its return delta. The pointer already points at the next step. |
| ESCALATE check on the *next* step | should be on what JUST RAN (`results[-1]`). If a plan whose only step is ESCALATE just ran, we want to finalize — not peek at a nonexistent next step. |
| `step_results: list[StepResult] = state.get("executor_result")` with no `or []` | missing field → `None` → `None.append(...)` crashes. `state.get(k) or []`. |
| `state.get("remediation_plan").remediation_steps` | crashes when plan is None (exhausted). Guard with `if plan is None: ...`. |
| Naming inconsistency: `step_index` vs `next_step_index` | the wrapper bumped one, the executor read the other. Whatever the chosen name, USE IT EVERYWHERE in one pass; don't leave a parallel naming alive. |
| `convert_to_node` with `{"key": i for i in ...}` inside a dict literal | that's a generator expression where Python expects a key:value pair — syntax error. Use a comprehension or build the dict separately. |
| `subgraph_output.get("graph", "unknown")` — checking a field that doesn't exist | confusion between *graph the object* and *state the dict*. The sub-graph returns a state dict; the field to read is the one you set on terminal nodes (here, `outcome`). |
| Missing `await` on `subgraph.ainvoke()` | returns a coroutine; never runs. |
| **The `__init__.py` cycle** — re-exporting `code_patch_node` from `__init__.py` when `graph.py` imports back into the parent | importing ANY submodule runs `__init__.py` first, fully. If `__init__.py` pulls in a module that needs the parent's types, you get a partial-module ImportError. Leave `__init__.py` empty, import from leaves. |
| Compiling the sub-graph with its own checkpointer | sub-graphs inherit the parent's. Two checkpointers fight on resume. |
| `len(state.get("patch_reports", None))` | `len(None)` crash. The `state.get(k) or []` pattern, again. |
| Generator expression inside an f-string that returns bool rather than a string | `f"{any(...)}"` formats `True`/`False`; you wanted the joined strings. |
| Forgetting to reset `next_step_index = 0` in the planner on replan | new plan inherits the old plan's pointer mid-list. IndexError on shorter plans; silently skipped steps on longer plans. |
| `from sentinel.subgraph.codepatch import X` for state-type imports inside agents/state.py | even if `X` is in state.py — Python still runs `__init__.py`, which pulls graph.py, which imports IncidentState, which is mid-load → cycle. |

---

## 5. INTERVIEW Q&A

**Q: Why a sub-graph instead of keeping the code-patch nodes at the parent level?**
> Three reasons. (1) Encapsulation — the code-patch path has its own
> retry loop and per-attempt state that has no business polluting
> IncidentState; the parent should see one cohesive result, not per-
> attempt accumulators. (2) The parent's per-step executor model
> requires the code-patch step to behave like any other step — one
> invocation, one StepResult — even though it's actually a multi-
> iteration loop inside. The sub-graph hides that complexity behind
> one node. (3) When HITL lands inside the code-patch loop (16d), an
> interrupt re-runs its enclosing node from the top. A sub-graph
> scoped to that loop is the right re-run boundary; a parent node
> containing the whole plan execution would re-run prior steps too.

**Q: How does the parent state distinguish "code patch in progress" from "code patch done"?**
> It can't, and shouldn't try. The sub-graph runs atomically from the
> parent's perspective — when `code_patch_node` returns, the loop is
> over (verified / exhausted / fix_failed / etc.). The parent reads
> `code_patch_result.outcome` to know what happened. "In progress" is
> internal to the sub-graph and invisible at the parent level. This is
> exactly the boundary you want.

**Q: Why per-step execution (Option 3) and not embedding the sub-graph call inside an iterating executor?**
> Re-run-from-top semantics. When a node hits `interrupt()`, LangGraph
> persists state and on resume re-runs the entire node body. If the
> executor iterates the whole plan in one node and embeds a sub-graph
> call mid-loop, any HITL inside the sub-graph causes the executor to
> re-run prior steps — running already-completed real actions twice.
> Step-pointer execution means each invocation is one step; the
> sub-graph is its own node with its own re-run scope.

**Q: One router serves three callers — isn't that coupling?**
> The router serves three *triggers*, but its decision depends on the
> STEP, not the trigger. That's the opposite of coupling — it's the
> signal that the abstraction is in the right place. If the router
> needed to know whether the upstream was the executor or the
> sub-graph, that'd be coupling; it doesn't, because the wrapper
> normalises the sub-graph's output (advances `next_step_index`,
> appends a StepResult) so the downstream state looks identical to a
> regular executor return.

**Q: Distinct state schema vs shared — when is each right?**
> Shared schema is right when the sub-graph is a co-located refinement
> of the same workflow — same nouns, same lifecycle, just a grouped
> set of nodes. Distinct schema is right when the sub-graph is a
> bounded context with its own vocabulary, its own accumulators, and
> a real interface boundary you want enforced. Code-patch is the
> second: PatchReport, PatchVerification, attempt counters,
> verified/fake_test/fix_failed outcomes — none of that should leak
> into a state object shared with planner, executor, verifier. The
> wrapper does input/output mapping; that's the cost of the boundary,
> and it's worth it.

**Q: You said the package `__init__.py` is empty. Isn't that bad practice?**
> Usually a public-API `__init__.py` IS good practice — it lets
> consumers write `from pkg import X` instead of knowing the internal
> module layout. It's only bad practice when re-exporting creates a
> cycle. Here, `graph.py` imports `IncidentState` from the parent, and
> `agents/state.py` imports `CodePatchResult` from this package —
> mutual dependency. A "public API __init__.py" would pull `graph.py`
> in whenever anyone imports anything from this package, including
> when the parent imports `CodePatchResult` mid-loading-its-own-state-
> module. So the convenient API would force `agents/state.py` into a
> circular import. Empty `__init__.py` breaks the cycle; consumers
> pay one extra path segment in their import line.

**Q: How does the parent know how many attempts the sub-graph took?**
> `code_patch_result.attempts`, set by the wrapper as
> `len(sub_result.get("patch_reports") or [])`. The parent never sees
> the list — just the count. If a future feature needs more (timing,
> tokens, per-attempt diffs), extend `CodePatchResult` with more
> summary fields; don't expose the lists. That's the boundary.

**Q: How is the sub-graph's retry loop bounded?**
> Inside the sub-graph's `_after_verifier_routing`:
> `len(state.get("patch_reports") or []) < _MAX_PATCH_ATTEMPTS=5`. The
> list length IS the counter. The parent has no role in the bound;
> it's a sub-graph concern.

**Q: Why not pass a checkpointer when compiling the sub-graph?**
> Sub-graphs inherit the parent's checkpointer automatically when
> invoked as nodes. Compiling with a separate checkpointer creates
> two persistence layers — on resume they fight. The parent owns
> checkpointing; the sub-graph just compiles.

---

## 6. COMMANDS

```powershell
# graph compile-check + tests
.venv\Scripts\python.exe tests\_check_wiring.py
.venv\Scripts\python.exe -m pytest tests\ -q

# standalone sub-graph code_fixer (real CC SDK call)
$env:SENTINEL_CC_DEBUG = "1"
$env:SENTINEL_GITHUB_PROD_LINK = "D:/projects/codefix-testrepo"
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Temp\sentinel-sandbox-inc_codefix_test" `
            -ErrorAction SilentlyContinue
.venv\Scripts\python.exe tests\_check_codefixer.py
```

---

## 7. CARRIED FORWARD

- **Outcome label.** A sub-graph that returns `outcome="verified"` still
  routes through `after_step_routing` to `verifier` (prod verify) then
  `finalize`. `finalize_node` reads `state["verification"]` (the prod
  verifier's verdict), so the post-mortem outcome is the prod outcome,
  not the patch outcome. 16c addresses this — a verified-but-not-yet-
  promoted patch is its own state distinct from RESOLVED.
- **Retry feedback into CC.** Inside the sub-graph, on retry the
  `code_fixer_node` resumes the CC session and runs again, but the
  prompt doesn't yet fold in the last verification's `description`
  (`FIX FAILED ...` / `FAKE TEST ...`). So the retry is currently
  semi-blind. 16c folds the verdict back into the prompt.
- **No semantic routing in 14a.** The "Phase 14" roadmap entry includes
  semantic routing (LLM-style triage of incident → sub-graph). 14a is
  the *structural* foundation — sub-graph + boundaries + per-step
  execution. Semantic routing as a triager extension comes when there
  are multiple sub-graphs to route between (the RCA+critic sub-graph
  in 14b, plus the code-patch sub-graph, plus a future GitOps
  sub-graph).
- **RCA+critic sub-graph (14b).** Same shape as 14a: extract the
  root-cause analyst + critic reflection loop into a sub-graph with
  its own state (per-iteration critiques accumulator), its own bound
  (`_MAX_REVISIONS`), its own wrapper at the parent level. The parent
  state shrinks again: no `revision_count`, no per-iteration critiques,
  one `RcaResult` summary.
- **Planner+verifier sub-graph — DELIBERATELY NOT extracted.** Pushed
  back on this in design discussion: central orchestration belongs at
  the parent level, not in a sub-graph. The planner is the parent's
  brain for the self-healing loop; wrapping it in a sub-graph hides
  the control flow that the architecture needs to be visible. Rule of
  Three applies to abstraction — extract when you have at least three
  separate concerns reaching for the same shape, not preemptively.

---

## 8. WHAT'S NEXT

**Immediately:** an end-to-end incident run through the new wiring —
incident → triager → investigators → RCA → critic → human_approval_rca
→ planner → (a plan including APPLY_CODE_PATCH) → human_approval_plan →
after_step_routing → code_patch sub-graph → after_step_routing →
verifier → finalize → post_mortem. Confirms the wiring of the new
shape against a real LLM, not just a compile check.

**Then 16c.** With 14a in place, 16c is small: insert promote +
promote-HITL between the sub-graph's verified terminal and the prod
verifier; add the `PROMOTED` / verified-pending-promote outcome; fold
the last verification's `description` into the retry prompt inside
the sub-graph. All of that lives at the right level of abstraction
because 14a put the right boundaries in.

**Then 14b** (RCA+critic sub-graph) and **16d** (Slack HITL surface).
