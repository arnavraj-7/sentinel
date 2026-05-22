from langgraph.types import interrupt

from sentinel.agents.state import (
    AgentNote,
    DANGEROUS_ACTIONS,
    IncidentState,
    RemediationAction,
    RemediationStep,
    StepResult,
    PatchReport
)
from sentinel.agents.code_fixer import code_fixer
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
    ds = get_datasource()
    service = state["input"].service
    log.info("executor.run", incident_id=state["incident_id"], service=service)

    plan = state.get("remediation_plan")
    if plan is None:
        # Planner exhausted its attempts — nothing to execute, escalate.
        return {
            "notes": [
                AgentNote(
                    agent="executor",
                    content="No remediation plan (attempts exhausted) — escalated.",
                )
            ]
        }

    steps = plan.remediation_steps
    if not steps:
        return {
            "notes": [
                AgentNote(agent="executor", content="Empty plan — no steps to execute.")
            ]
        }
    step_results: list[StepResult] = []
    patch_reports: list[PatchReport] = []
    for step in steps:
        if step.remediation_action == RemediationAction.APPLY_CODE_PATCH:
            # Code-fix is a multi-step Claude Code sub-agent, not a one-shot
            # call — executor_node drives it directly so execute_step stays a
            # pure single-return-type dispatcher.
            report = await code_fixer(state)
            patch_reports.append(report)
            result = StepResult(
                step=step,
                ok=bool(report.commit_sha),   # a real commit SHA == success
                detail=report.summary,
            )
        else:
            result = await execute_step(step, ds, service)
        step_results.append(result)
        # Critical-step early-stop: a load-bearing failure makes the rest
        # pointless — bail so the planner can replan from the precise failure.
        if not result.ok and step.critical:
            break

    summary = ", ".join(
        f"{r.step.remediation_action.value}={'ok' if r.ok else 'FAIL'}"
        for r in step_results
    )
    note = AgentNote(
        agent="executor",
        content=f"Executed {len(step_results)} step(s): {summary}",
    )
    log.info(
        "executor.done",
        incident_id=state["incident_id"],
        steps=len(step_results),
    )
    return {
        "notes": [note],
        "executor_result": step_results,
        "remediation_applied_at": datetime.now(UTC),
        "patch_reports": patch_reports,   # list — the Annotated[..., add] reducer extends
    }

def after_executor_routing(state: IncidentState) -> str:
    """A critical step failed → back to the planner to replan from the failure.
    Otherwise → verifier (did the plan actually restore health?)."""
    results = state.get("executor_result") or []
    if not results:
        # Nothing ran (exhausted/empty) — end the incident.
        return "finalize"
    last = results[-1]
    if not last.ok and last.step.critical:
        log.info("after_executor.critical_failure_replan", incident_id=state["incident_id"])
        return "planner"
    # Check what ACTUALLY ran (not the plan): a critical-fail break can skip a
    # trailing escalate step. any() — a bare genexp in `if` is always truthy.
    if any(r.step.remediation_action == RemediationAction.ESCALATE for r in results):
        return "finalize"
    return "verifier"


def after_human_rca_routing(state: IncidentState) -> str:
    """RCA approval gate: approved → planner; anything else → finalize.
    One gate, one decision, one return per branch — no fall-through tricks."""
    if state.get("human_decision") == "approved":
        log.info("after_human_rca.approved", incident_id=state["incident_id"])
        return "planner"
    log.info("after_human_rca.rejected", incident_id=state["incident_id"])
    return "finalize"


def after_human_plan_routing(state: IncidentState) -> str:
    """Plan approval gate: approved → executor; anything else → finalize."""
    if state.get("human_decision_plan") == "approved":
        log.info("after_human_plan.approved", incident_id=state["incident_id"])
        return "executor"
    log.info("after_human_plan.rejected", incident_id=state["incident_id"])
    return "finalize"
