import httpx
from langchain_google_genai import ChatGoogleGenerativeAI

from sentinel.agents.state import AgentNote, FailureCategory, IncidentState, TriagerFindings
from sentinel.config import settings
from sentinel.logging import log

_llm = ChatGoogleGenerativeAI(
    model="gemini-2.5-flash",
    project=settings.google_project,
    temperature=0,
)

# Wraps the LLM so it always returns a TriagerFindings object, never raw text.
_structured_llm = _llm.with_structured_output(TriagerFindings)


async def _fetch_context(service: str) -> tuple[dict, list]:  # type: ignore[type-arg]
    """Pull current metrics and recent logs from the simulated lab."""
    async with httpx.AsyncClient(base_url=settings.lab_base_url, timeout=10.0) as client:
        metrics = (await client.get(f"/lab/services/{service}/metrics")).json()
        logs = (await client.get(f"/lab/services/{service}/logs")).json()
    return metrics, logs


async def triager_node(state: IncidentState) -> dict[str, object]:
    payload = state["input"]
    log.info("triager.run", incident_id=state["incident_id"], service=payload.service)

    metrics, logs = await _fetch_context(payload.service)

    log_lines = "\n".join(
        f"[{entry['ts']}] {entry['level']} {entry['message']}" for entry in logs
    )

    prompt = f"""You are an SRE triager. An alert has fired.
Analyse the data below and classify the incident.

ALERT
-----
Service  : {payload.service}
Message  : {payload.message}
Severity : {payload.severity.value}

CURRENT METRICS
---------------
CPU          : {metrics['cpu_pct']}%
Memory       : {metrics['memory_mb']} MB
Latency p95  : {metrics['latency_p95_ms']} ms
Error rate   : {metrics['error_rate_pct']}%
Uptime       : {metrics['uptime_seconds']}s

RECENT LOGS (newest first)
--------------------------
{log_lines}

VALID FAILURE CATEGORIES
-------------------------
{", ".join(c.value for c in FailureCategory)}

Classify this incident. Base your answer strictly on the data above."""

    findings: TriagerFindings = await _structured_llm.ainvoke(prompt)

    log.info(
        "triager.done",
        incident_id=state["incident_id"],
        category=findings.failure_category,
    )

    note = AgentNote(
        agent="triager",
        content=(
            f"[{findings.failure_category}] {findings.summary} | "
            f"Actions: {', '.join(findings.recommended_actions[:2])}"
        ),
    )

    return {
        "notes": [note],
        "triager_findings": findings,
        "done": True,
    }
