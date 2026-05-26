from langgraph.types import interrupt

from sentinel.agents.state import (
    AgentNote,
    DANGEROUS_ACTIONS,
    IncidentState,
    RemediationAction,
    RemediationStep,
    StepResult,
)
from sentinel.datasource import get_datasource
from sentinel.logging import log
from datetime import UTC, datetime


# ── Human-in-the-loop (Phase 13a) ───────────────────────────────────────────
# Two distinct gates in the graph, one shared mechanism:
#   1. human_approval_rca_node  — approve the root cause before planning runs
#   2. human_approval_plan_node — approve the plan when it contains any
#      Dangerous action (Safe-only plans bypass this gate via the planner
#      router; see after_planner_routing).
# Both nodes MUST stay pure (no side effects before interrupt()) — LangGraph
# re-runs the entire node body on resume, so any side effect would execute
# twice. The shared `_human_approval` helper just wraps interrupt() to mark
# this contract.

def _human_approval(payload: dict) -> str:
    """Pause the graph; surface `payload` to the human; return the resume value.

    Mechanism (no API knowledge in LangGraph):
      1. interrupt(payload) raises GraphInterrupt → the checkpointer (SQLite)
         persists state. payload is parked in snapshot.tasks[].interrupts[].value.
      2. graph.ainvoke() returns NORMALLY to the API caller — does not raise.
         The API reads the snapshot, surfaces the payload over HTTP.
      3. On resume via Command(resume=<str>), the whole node re-runs from the
         top; this time interrupt() returns the resume value directly.
    """
    return interrupt(payload)


def human_approval_rca_node(state: IncidentState) -> dict[str, object]:
    """HITL gate #1 — approve root-cause + recommended fix BEFORE the planner
    is allowed to emit a remediation plan. Pure by construction."""
    log.info("human_approval_rca.run", incident_id=state["incident_id"])
    rca = state["root_cause_findings"]
    decision = _human_approval({
        "stage": "root_cause",
        "root_cause": rca.root_cause,
        "recommended_fix": rca.recommended_fix,
        "confidence": rca.confidence,
    })
    return {"human_decision": decision}


def human_approval_plan_node(state: IncidentState) -> dict[str, object]:
    """HITL gate #2 — approve the remediation plan. Entered only when the
    plan contains at least one Dangerous action (router enforces this; a
    Safe-only plan goes straight to the executor). Pure by construction.

    Payload is JSON-serialized via model_dump(mode="json") so the API can
    render it directly from snapshot.tasks[].interrupts[].value.
    """
    log.info("human_approval_plan.run", incident_id=state["incident_id"])
    plan = state.get("remediation_plan")
    if plan is None:
        # Routing should never let us enter without a plan — defensive only.
        raise RuntimeError("human_approval_plan_node entered with no plan")

    dangerous = [
        s for s in plan.remediation_steps
        if s.remediation_action in DANGEROUS_ACTIONS
    ]
    decision = _human_approval({
        "stage": "plan",
        "dangerous_steps": [s.model_dump(mode="json") for s in dangerous],
        "all_steps": [s.model_dump(mode="json") for s in plan.remediation_steps],
    })
    return {"human_decision_plan": decision}


def human_approval_promote_node(state: IncidentState) -> dict[str, object]:
    """HITL gate #3 (Phase 16c) — approve pushing a sandbox-verified
    commit to the prod repo. Entered ONLY after code_patch returns
    outcome='verified'. Payload includes the verified PatchReport so the
    operator can review the diff before authorising the push. Pure by
    construction."""
    log.info("human_approval_promote.run", incident_id=state["incident_id"])
    cpr = state.get("code_patch_result")
    if cpr is None or cpr.last_report is None:
        raise RuntimeError("human_approval_promote_node entered without a verified patch")

    decision = _human_approval({
        "stage": "promote",
        "commit_sha": cpr.last_report.commit_sha,
        "files_touched": cpr.last_report.files_touched,
        "summary": cpr.last_report.summary,
        "verifier_verdict": (
            cpr.last_verification.description if cpr.last_verification else None
        ),
        "attempts": cpr.attempts,
    })
    return {"human_decision_promote": decision}



async def execute_step(step: RemediationStep, ds: object, service: str) -> StepResult:
    """Deterministic dispatch on the planned action. No LLM here — the planner
    already chose the action from the RemediationAction enum (plan-then-execute,
    not ReAct tool-calling). A failed action becomes ok=False, never a crash —
    so the critical-step routing has something to react to.

    Honest reality: only HEAL hits a real endpoint; restart/rollback/scale have
    no simulator endpoint yet → honest-simulated. APPLY_CODE_PATCH is NOT handled
    here — it is a multi-step Claude Code sub-agent that executor_node drives
    directly, so this function stays a pure single-return-type dispatcher.
    """
    action = step.remediation_action
    try:
        match action:
            case RemediationAction.HEAL:
                await ds.heal(service)  # type: ignore[attr-defined]
                return StepResult(step=step, ok=True, detail="healed via /heal")
            case RemediationAction.ESCALATE:
                return StepResult(step=step, ok=True, detail="escalated to human")
            case (
                RemediationAction.RESTART
                | RemediationAction.ROLLBACK
                | RemediationAction.SCALE_UP
                | RemediationAction.INCREASE_DB_POOL
            ):
                return StepResult(
                    step=step,
                    ok=True,
                    detail=f"simulated {action.value} (no real endpoint yet)",
                )
            case RemediationAction.VERIFY_HEALTH | RemediationAction.VERIFY_METRICS:
                return StepResult(
                    step=step,
                    ok=True,
                    detail=f"{action.value} deferred to verify node",
                )
            case _:
                return StepResult(
                    step=step, ok=False, detail=f"unknown action {action}"
                )
    except Exception as e:
        return StepResult(
            step=step, ok=False, detail=f"{action.value} failed: {e}"
        )

async def executor_node(state: IncidentState) -> dict[str, object]:
    """Process exactly ONE step at state['next_step_index'], advance, return.

    Per-step model (Option 3) — never iterates the whole plan in one invocation.
    Never sees APPLY_CODE_PATCH; routing dispatches that to the code_patch
    sub-graph BEFORE this node runs.
    """
    ds = get_datasource()
    service = state["input"].service
    idx = state.get("next_step_index", 0)
    log.info("executor.run", incident_id=state["incident_id"], step_index=idx)

    plan = state.get("remediation_plan")
    if plan is None:
        # Planner exhausted its attempts — nothing to execute, escalate.
        return {"notes": [AgentNote(
            agent="executor",
            content="No remediation plan (attempts exhausted) — escalated.",
        )]}

    steps = plan.remediation_steps
    if not steps:
        return {"notes": [AgentNote(
            agent="executor", content="Empty plan — no steps to execute.",
        )]}

    step = steps[idx]
    result = await execute_step(step, ds, service)
    log.info(
        "executor.done",
        incident_id=state["incident_id"],
        step=step.remediation_action,
        ok=result.ok,
    )

    # The `add` reducer extends state's executor_result by [result] — do NOT
    # read state's list and append (that would double-extend via the reducer).
    delta: dict[str, object] = {
        "executor_result": [result],
        "next_step_index": idx + 1,
    }

    # On the last step, also emit an end-of-plan summary note + timestamp.
    # The summary spans only THIS plan's slice (the tail of the accumulated
    # list whose length matches this plan's step count).
    if idx == len(steps) - 1:
        plan_results = ((state.get("executor_result") or []) + [result])[-len(steps):]
        summary = ", ".join(
            f"{r.step.remediation_action.value}={'ok' if r.ok else 'FAIL'}"
            for r in plan_results
        )
        delta["notes"] = [AgentNote(
            agent="executor",
            content=f"Executed {len(plan_results)} step(s): {summary}",
        )]
        delta["remediation_applied_at"] = datetime.now(UTC)

    return delta

def after_step_routing(state: IncidentState) -> str:
    """Shared step-router (Phase 14a, extended in Phase 16c).

    Decisions, in order:
      - no plan / empty results  → finalize
      - last step was critical+failed → planner (replan)
      - last step was ESCALATE → finalize
      - code_patch JUST returned verified AND promote not yet handled
        → human_approval_promote (Phase 16c)
      - next_step_index past the end → verifier (prod-verify)
      - next step is APPLY_CODE_PATCH → code_patch
      - next step is anything else → executor
    """
    plan = state.get("remediation_plan")
    if plan is None:
        return "finalize"

    results = state.get("executor_result") or []
    if results:
        last = results[-1]
        if not last.ok and last.step.critical:
            log.info("after_step.critical_failure_replan",
                     incident_id=state["incident_id"])
            return "planner"
        if last.step.remediation_action == RemediationAction.ESCALATE:
            return "finalize"

    # Phase 16c — synthetic promote gate. After code_patch returns
    # `verified`, gate the operator before pushing the commit to prod.
    # `human_decision_promote` is set when they decide; `promote_completed`
    # is set after the promote_node actually runs. Until both are set,
    # this branch holds — independent of what the next plan step is.
    cpr = state.get("code_patch_result")
    if cpr is not None and cpr.outcome == "verified":
        decision = state.get("human_decision_promote")
        if decision is None:
            return "human_approval_promote"
        if decision == "rejected":
            return "finalize"
        # decision == "approved" — has promote actually run yet?
        if not state.get("promote_completed"):
            return "promote"
        # Promote done; fall through to the regular per-step dispatch.

    next_step_index = state.get("next_step_index", 0)
    steps = plan.remediation_steps

    if next_step_index >= len(steps):
        return "verifier"

    next_step = steps[next_step_index]
    if next_step.remediation_action == RemediationAction.APPLY_CODE_PATCH:
        return "code_patch"
    return "executor"


def after_human_rca_routing(state: IncidentState) -> str:
    """RCA approval gate: approved → planner; anything else → finalize.
    One gate, one decision, one return per branch — no fall-through tricks."""
    if state.get("human_decision") == "approved":
        log.info("after_human_rca.approved", incident_id=state["incident_id"])
        return "planner"
    log.info("after_human_rca.rejected", incident_id=state["incident_id"])
    return "finalize"


def after_human_plan_routing(state: IncidentState) -> str:
    """Plan approval gate: approved → shared step-router (so the FIRST step is
    dispatched correctly — code_patch vs executor); rejected → finalize."""
    if state.get("human_decision_plan") == "approved":
        log.info("after_human_plan.approved", incident_id=state["incident_id"])
        return after_step_routing(state)   # shared dispatch — handles step 0 = APPLY_CODE_PATCH
    log.info("after_human_plan.rejected", incident_id=state["incident_id"])
    return "finalize"


def after_human_promote_routing(state: IncidentState) -> str:
    """Phase 16c — promote gate: approved → promote_node; rejected → finalize.
    The shared `after_step_routing` already knows how to interpret these
    state values, but this dedicated router runs RIGHT after the HITL
    node — no need to walk the full step-routing logic just to dispatch
    to promote/finalize."""
    if state.get("human_decision_promote") == "approved":
        log.info("after_human_promote.approved", incident_id=state["incident_id"])
        return "promote"
    log.info("after_human_promote.rejected", incident_id=state["incident_id"])
    return "finalize"