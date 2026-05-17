from pathlib import Path

from langchain_core.messages import HumanMessage, SystemMessage

from sentinel.agents.llm import structured_invoke
from sentinel.agents.state import AgentNote, IncidentState, PostMortemReport
from sentinel.logging import log

_SCRIBE_SYSTEM = """You are the Post-Mortem Scribe, a senior SRE who writes clear, actionable incident reports.

Rules:
- title: short service + failure type, e.g. "Crash Loop in api-gateway"
- executive_summary: 2-3 sentences a non-technical manager can understand — no jargon
- timeline: chronological list of key events, each prefixed with its timestamp from the notes
- root_cause: copy the root_cause_analyst's finding exactly — do not paraphrase
- contributing_factors: from the root cause analysis, not from triager
- impact: which services were affected and what users experienced
- resolution: exactly what action was taken to fix it (or "No action taken — fix was rejected")
- prevention_steps: concrete, specific actions the team should take — not generic advice
- lessons_learned: what this incident reveals about the system or process — specific to THIS incident"""


def _to_markdown(report: PostMortemReport, incident_id: str, service: str, severity: str) -> str:
    resolved = report.resolution.lower() != "no action taken — fix was rejected"
    status = "resolved" if resolved else "rejected — no fix applied"

    timeline_md = "\n".join(f"- {item}" for item in report.timeline)
    factors_md = "\n".join(f"- {f}" for f in report.contributing_factors)
    prevention_md = "\n".join(f"{i+1}. {s}" for i, s in enumerate(report.prevention_steps))
    lessons_md = "\n".join(f"{i+1}. {l}" for i, l in enumerate(report.lessons_learned))

    return f"""# {report.title}

**Incident ID:** {incident_id}
**Service:** {service}
**Severity:** {severity}
**Status:** {status}

---

## Executive Summary

{report.executive_summary}

---

## Timeline

{timeline_md}

---

## Root Cause

{report.root_cause}

## Contributing Factors

{factors_md}

---

## Impact

{report.impact}

---

## Resolution

{report.resolution}

---

## Prevention Steps

{prevention_md}

---

## Lessons Learned

{lessons_md}
"""


async def post_mortem_node(state: IncidentState) -> dict[str, object]:
    incident_id = state["incident_id"]
    service = state["input"].service
    log.info("scribe.run", incident_id=incident_id)

    notes_text = "\n".join(
        f"[{n.at.strftime('%H:%M:%S')}] {n.agent}: {n.content}"
        for n in state.get("notes", [])
    )

    triager = state.get("triager_findings")
    rca = state.get("root_cause_findings")
    critique = state.get("critique")
    decision = state.get("human_decision", "unknown")

    investigator_text = "\n".join(
        f"- [{f.agent}] {f.focus} (conf={f.confidence:.0%}): {f.summary}"
        for f in state.get("investigator_findings", [])
    )

    user_content = f"""INCIDENT: {incident_id}
Service: {service}  |  Severity: {state['input'].severity.value}
Alert: {state['input'].message}

TRIAGER CLASSIFICATION:
{triager.failure_category if triager else 'unknown'} — {triager.summary if triager else ''}

INVESTIGATOR FINDINGS:
{investigator_text}

ROOT CAUSE ANALYSIS:
Root cause     : {rca.root_cause if rca else 'unknown'}
Contributing   : {', '.join(rca.contributing_factors) if rca else ''}
Recommended fix: {rca.recommended_fix if rca else ''}

CRITIC VERDICT: {'APPROVED' if critique and critique.approved else 'REJECTED'}
{f'Feedback: {critique.feedback}' if critique else ''}

HUMAN DECISION: {decision}

FULL NOTES TIMELINE:
{notes_text}

Write the post-mortem report for this incident."""

    raw: PostMortemReport = await structured_invoke(PostMortemReport,
        [SystemMessage(content=_SCRIBE_SYSTEM), HumanMessage(content=user_content)]
    )

    markdown = _to_markdown(raw, incident_id, service, state["input"].severity.value)

    # Save to disk
    out_dir = Path("data/post-mortems")
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f"{incident_id}.md").write_text(markdown, encoding="utf-8")

    note = AgentNote(
        agent="scribe",
        content=f"Post-mortem written — {len(raw.prevention_steps)} prevention steps, {len(raw.lessons_learned)} lessons learned.",
    )
    log.info("scribe.done", incident_id=incident_id, path=str(out_dir / f"{incident_id}.md"))
    return {"post_mortem": markdown, "notes": [note]}
