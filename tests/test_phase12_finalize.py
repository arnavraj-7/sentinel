"""Phase 12 — deterministic proof of every terminal outcome + verify routing.

The lab e2e proved the EXHAUSTED path live (planner picked rollback, a
simulated no-op, so the loop honestly exhausted + escalated). These tests
prove the OTHER branches — including RESOLVED — without a multi-minute run.
"""

from sentinel.agents.finalize import finalize_node
from sentinel.agents.state import (
    IncidentOutcome,
    RemediationAction,
    RemediationPlan,
    RemediationStep,
    StepResult,
    VerificationResult,
)
from sentinel.agents.verifier import after_verify_routing

_PLAN = RemediationPlan(
    thinking_process="t",
    remediation_steps=[
        RemediationStep(remediation_action=RemediationAction.HEAL, critical=True, description="heal")
    ],
)


def _state(**over) -> dict:
    base = {"incident_id": "inc_test"}
    base.update(over)
    return base


def test_resolved_branch() -> None:
    """verifier confirmed recovery → RESOLVED (the happy path)."""
    out = finalize_node(
        _state(
            remediation_plan=_PLAN,
            executor_result=[
                StepResult(step=_PLAN.remediation_steps[0], ok=True, detail="healed")
            ],
            verification=VerificationResult(verified=True, verdict="recovered"),
        )
    )
    assert out["outcome"] == IncidentOutcome.RESOLVED
    assert out["done"] is True


def test_exhausted_branch() -> None:
    """planner returned no plan (attempts exhausted) → EXHAUSTED."""
    out = finalize_node(_state(remediation_plan=None))
    assert out["outcome"] == IncidentOutcome.EXHAUSTED


def test_escalated_branch() -> None:
    """an ESCALATE action actually executed → ESCALATED."""
    esc = RemediationStep(
        remediation_action=RemediationAction.ESCALATE, critical=False, description="esc"
    )
    out = finalize_node(
        _state(
            remediation_plan=RemediationPlan(thinking_process="t", remediation_steps=[esc]),
            executor_result=[StepResult(step=esc, ok=True, detail="escalated")],
        )
    )
    assert out["outcome"] == IncidentOutcome.ESCALATED


def test_rejected_branch() -> None:
    """human rejected at the HITL gate → REJECTED (no plan/None must not win)."""
    out = finalize_node(_state(human_decision="rejected"))
    assert out["outcome"] == IncidentOutcome.REJECTED


def test_after_verify_routing() -> None:
    assert after_verify_routing(_state(verification=VerificationResult(verified=True, verdict="ok"))) == "finalize"
    assert after_verify_routing(_state(verification=VerificationResult(verified=False, verdict="no"))) == "planner"
    assert after_verify_routing(_state()) == "finalize"  # missing → safe terminal
