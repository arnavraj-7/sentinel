from sentinel.agents.state import IncidentOutcome, IncidentState, RemediationAction
from sentinel.logging import log


def finalize_node(state: IncidentState) -> dict[str, object]:
    """Terminal classifier: every path that ends an incident converges here.
    Order matters — check the cases that imply 'no/None plan' BEFORE touching
    any plan attribute, or the exhausted/rejected paths crash on None.
    """
    log.info("finalize", incident_id=state["incident_id"])

    # 1. Human rejected at the HITL gate — no remediation was attempted.
    if state.get("human_decision") == "rejected":
        outcome = IncidentOutcome.REJECTED

    # 2. Planner exhausted its attempts — remediation_plan is None.
    #    (Must precede any plan-attribute access.)
    elif state.get("remediation_plan") is None:
        outcome = IncidentOutcome.EXHAUSTED

    # 3. Escalated — an ESCALATE action ACTUALLY executed (check what ran,
    #    not what was planned: a critical-fail break may skip a trailing
    #    escalate step, so the plan can contain one that never ran).
    elif any(
        r.step.remediation_action == RemediationAction.ESCALATE
        for r in state.get("executor_result") or []
    ):
        outcome = IncidentOutcome.ESCALATED

    # 4. Resolved — verifier confirmed recovery (guard: verification may be None).
    elif (v := state.get("verification")) is not None and v.verified:
        outcome = IncidentOutcome.RESOLVED

    # 5. A plan ran but didn't resolve/escalate and wasn't verified — degenerate.
    else:
        outcome = IncidentOutcome.EMPTY_PLAN_DEFECT

    log.info("finalize.outcome", incident_id=state["incident_id"], outcome=outcome.value)
    return {"done": True, "outcome": outcome}
