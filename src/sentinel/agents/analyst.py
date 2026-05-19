from langchain_core.messages import HumanMessage, SystemMessage

from sentinel.agents.llm import structured_invoke
from sentinel.agents.state import (
    AgentNote,
    CritiqueResult,
    IncidentState,
    RootCauseFindings,
)
from sentinel.logging import log

_MAX_REVISIONS = 2

# ── System prompts ────────────────────────────────────────────────────────────

_ANALYST_SYSTEM = """You are the Root Cause Analyst, a principal SRE who synthesizes
multi-source evidence into a single definitive root cause.

Rules:
- root_cause must be ONE precise sentence naming the exact failure mechanism.
  Bad: "The service crashed." Good: "A nil pointer dereference in the request
  handler caused a panic loop after the 03:00 deploy removed a required config key."
- contributing_factors must be distinct from root_cause — secondary conditions
  that made the failure worse or faster, not restatements of it.
- recommended_fix must be a concrete immediate action, not generic advice.
- If revision feedback is provided, address every point specifically."""

_CRITIC_SYSTEM = """You are the Critic, a meticulous principal SRE who reviews
root cause analyses before they are acted upon.

Approve if ALL of these hold:
1. root_cause names the exact failure mechanism (not just symptoms)
2. root_cause is directly supported by at least one piece of evidence quoted by investigators
3. contributing_factors are distinct from root_cause, not just rephrasing it
4. recommended_fix is specific and immediately actionable

Reject and give precise feedback if any condition fails.
A vague root cause that could apply to any incident is always a rejection."""


# ── Node: root_cause_analyst ──────────────────────────────────────────────────

async def root_cause_analyst_node(state: IncidentState) -> dict[str, object]:
    service = state["input"].service
    revision = state.get("revision_count", 0)
    log.info("root_cause_analyst.run", incident_id=state["incident_id"], revision=revision)

    findings_text = "\n\n".join(
        f"[{f.agent.upper()} — {f.focus}]\n"
        f"Summary: {f.summary}\n"
        f"Evidence:\n" + "\n".join(f"  • {e}" for e in f.evidence)
        for f in state.get("investigator_findings", [])
    )

    triager = state.get("triager_findings")
    triager_line = f"Triager: {triager.failure_category} — {triager.summary}" if triager else ""

    critique = state.get("critique")
    revision_section = (
        f"\nREVISION FEEDBACK (address every point):\n{critique.feedback}"
        if critique and not critique.approved
        else ""
    )

    user_content = f"""Service: {service}
Incident: {state['input'].message}
{triager_line}

INVESTIGATOR FINDINGS:
{findings_text}
{revision_section}

Synthesize all evidence into a definitive root cause."""

    raw: RootCauseFindings = await structured_invoke(
        RootCauseFindings,
        [SystemMessage(content=_ANALYST_SYSTEM), HumanMessage(content=user_content)],
    )

    note = AgentNote(
        agent="root_cause_analyst",
        content=f"[revision={revision}] {raw.root_cause}",
    )
    log.info("root_cause_analyst.done", incident_id=state["incident_id"], confidence=raw.confidence)
    return {
        "root_cause_findings": raw,
        "revision_count": revision + 1,
        "notes": [note],
    }


# ── Node: critic ──────────────────────────────────────────────────────────────

async def critic_node(state: IncidentState) -> dict[str, object]:
    log.info("critic.run", incident_id=state["incident_id"])

    rca = state["root_cause_findings"]
    findings_text = "\n".join(
        f"  [{f.agent}] {f.focus}: {f.summary}" for f in state.get("investigator_findings", [])
    )

    user_content = f"""SERVICE: {state['input'].service}

INVESTIGATOR FINDINGS (evidence base):
{findings_text}

ROOT CAUSE ANALYSIS TO REVIEW:
  Root cause       : {rca.root_cause}
  Contributing     : {", ".join(rca.contributing_factors)}
  Confidence       : {rca.confidence:.0%}
  Recommended fix  : {rca.recommended_fix}

Review this analysis against the evidence. Approve or reject with specific feedback."""

    raw: CritiqueResult = await structured_invoke(
        CritiqueResult,
        [SystemMessage(content=_CRITIC_SYSTEM), HumanMessage(content=user_content)],
    )

    note = AgentNote(
        agent="critic",
        content=f"[{'APPROVED' if raw.approved else 'REJECTED'}] {raw.feedback or 'Analysis approved.'}",
    )
    log.info("critic.done", incident_id=state["incident_id"], approved=raw.approved)
    return {"critique": raw, "notes": [note]}


# ── Routing function — your turn to write this ────────────────────────────────

def after_critic_routing(state: IncidentState) -> str:
    revision_count = state.get("revision_count",0)
    if(revision_count >= _MAX_REVISIONS):
        log.info("after_critic_routing.max_revisions_reached", incident_id=state["incident_id"], revision_count=revision_count)
        return "human_approval"  # stop if we've already done 2 revisions
    critic = state.get("critique")
    if critic is None:
        log.warning("after_critic_routing.missing_critique", incident_id=state["incident_id"])
        return "human_approval"  # safety check: if no critique, end the graph
    if critic.approved:
        log.info("after_critic_routing.approved", incident_id=state["incident_id"])
        return "human_approval"  # if approved, we're done
    else:
        log.info("after_critic_routing.rejected", incident_id=state["incident_id"], feedback=critic.feedback)
        return "root_cause_analyst"  # if rejected, loop back for another revision


    
        
