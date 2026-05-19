from langgraph.types import interrupt

from sentinel.agents.state import (
    AgentNote,
    IncidentState,
    RemediationAction,
    RemediationStep,
    StepResult,
)
from sentinel.datasource import get_datasource
from sentinel.logging import log
from datetime import UTC,datetime

def human_approval_node(state: IncidentState) -> dict[str, object]:
    log.info("human_approval_node.run", incident_id=state["incident_id"])
    rca = state["root_cause_findings"]
    decision = interrupt({
        "root_cause": rca.root_cause,
        "recommended_fix": rca.recommended_fix,
        "confidence": rca.confidence,
    })
    return {"human_decision": decision}


async def execute_step(step: RemediationStep, ds: object, service: str) -> StepResult:
    """Deterministic dispatch on the planned action. No LLM here — the planner
    already chose the action from the RemediationAction enum (plan-then-execute,
    not ReAct tool-calling). A failed action becomes ok=False, never a crash —
    so the critical-step routing has something to react to.

    Honest reality: only HEAL hits a real endpoint; restart/rollback/scale have
    no simulator endpoint yet → honest-simulated. Real gcloud/CC execution is a
    later phase.
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
    for step in steps:
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


def after_human_routing(state: IncidentState) -> str:
    approval = state.get("human_decision")
    if approval == "approved":
        log.info("after_human_routing.approved", incident_id=state["incident_id"])
        # Phase 12: approved → PLANNER (plan → execute → verify), not straight
        # to executor.
        return "planner"
    log.info("after_human_routing.rejected", incident_id=state["incident_id"])
    return "finalize"
