from langchain_core.messages import HumanMessage, SystemMessage

from sentinel.agents.llm import structured_invoke
from sentinel.agents.state import AgentNote, IncidentState, RemediationPlan

_MAX_REMEDIATION_ATTEMPTS = 3

PLANNER_SYSTEM_PROMPT = """You are a principal Site Reliability Engineer who converts a \
diagnosed root cause into a concrete, ordered remediation runbook.

Your job: produce the minimal ordered sequence of steps that resolves THIS incident.

Rules:
- Every step's action MUST be one of the allowed RemediationAction values — never invent one.
- Steps execute sequentially; an earlier step must not depend on a later one.
- Prefer the least-invasive action that resolves the root cause; escalate only when no \
safe automated action applies.
- If you escalate, the plan MUST be a SINGLE step — just ESCALATE. NEVER append ESCALATE \
after other steps: "attempt, then give up if it fails" is the system's retry loop, NOT a \
plan step. Escalation is a standalone decision: "no safe automated fix exists."
- critical=True only for load-bearing steps (their failure makes the rest pointless).
- End with a verification step (verify_health/verify_metrics) unless escalating.

Do NOT output shell/code, restate the root cause as a step, or add unrelated steps."""


async def planner_node(state: IncidentState) -> dict[str, object]:
    attempts = state.get("remediation_attempts", 0)

    # Bounded self-heal loop guard (same shape as revision_count/_MAX_REVISIONS).
    if attempts >= _MAX_REMEDIATION_ATTEMPTS:
        note = AgentNote(
            agent="runbook_planner",
            content=f"Remediation exhausted after {attempts} attempts — escalating.",
        )
        return {"remediation_plan": None, "notes": [note]}

    rc = state["root_cause_findings"]
    inv = "\n".join(
        f"- [{f.agent}] {f.summary}" for f in state.get("investigator_findings", [])
    )

    # On a replan, feed back WHY the last attempt failed (the reflection-loop
    # mechanic: planner reads prior failure before regenerating).
    prior = state.get("executor_result")
    if not prior:
        history = "FRESH PLAN — no prior attempt."
    else:
        failed = "\n".join(
            f"- {r.step.remediation_action.value}: {r.detail}"
            for r in prior
            if not r.ok
        )
        history = f"PRIOR ATTEMPT FAILED — revise. Failed steps:\n{failed}"

    user_content = f"""ROOT CAUSE: {rc.root_cause}
RECOMMENDED FIX: {rc.recommended_fix}
CONTRIBUTING: {", ".join(rc.contributing_factors)}

INVESTIGATOR EVIDENCE:
{inv}

{history}

Produce the remediation runbook."""

    plan = await structured_invoke(
        RemediationPlan,
        [
            SystemMessage(content=PLANNER_SYSTEM_PROMPT),
            HumanMessage(content=user_content),
        ],
    )

    note = AgentNote(
        agent="runbook_planner",
        content=f"Plan ({len(plan.remediation_steps)} steps): "
        + ", ".join(s.remediation_action.value for s in plan.remediation_steps),
    )
    return {
        "remediation_plan": plan,
        "remediation_attempts": attempts + 1,
        "notes": [note],
    }



def after_planner_routing(state: IncidentState) -> str:
    remediation_plan = state.get("remediation_plan")
    if remediation_plan is None :
        return "finalize"
    return "executor"