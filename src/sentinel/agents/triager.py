from sentinel.agents.llm import structured_invoke
from sentinel.agents.state import AgentNote, FailureCategory, IncidentState, TriagerFindings
from sentinel.datasource import get_datasource
from sentinel.logging import log


async def _fetch_context(service: str) -> tuple[dict, list]:  # type: ignore[type-arg]
    """Pull current metrics and recent logs from the simulated lab."""
    ds = get_datasource()
    metrics = await ds.get_metrics(service=service) 
    logs = await ds.get_logs(service=service, count=20)
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

    findings: TriagerFindings = await structured_invoke(TriagerFindings, prompt)

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
    }
