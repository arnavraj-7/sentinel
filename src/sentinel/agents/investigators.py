from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from sentinel.agents.llm import structured_invoke
from sentinel.agents.state import AgentNote, IncidentState, InvestigatorFindings
from sentinel.datasource import get_datasource
from sentinel.datasource.registry import describe_topology
from sentinel.logging import log


class _InvestigatorOutput(BaseModel):
    """Schema the LLM fills in. `agent` is added programmatically — not by the LLM."""

    focus: str
    summary: str
    evidence: list[str]
    confidence: float = Field(ge=0.0, le=1.0)



# ── System prompts — each agent's persona ────────────────────────────────────

_LOG_DETECTIVE_SYSTEM = """You are the Log Detective, an expert SRE specialist in log analysis.
Your job: find error patterns, stack traces, crash sequences, and timing clues in raw logs.
Focus on: repeated errors, panics, OOM signals, crash/restart cycles, timing of first failure.
Be precise — quote exact log lines as evidence. Express confidence based on log clarity."""

_METRIC_ANALYST_SYSTEM = """You are the Metric Analyst, a performance engineering specialist.
Your job: identify anomalies in service metrics — CPU, memory, latency, error rates.
Focus on: values that exceed normal thresholds, trends suggesting degradation, metric combinations
that indicate specific failure modes (e.g. low uptime + 100% errors = crash loop).
Express confidence based on how clearly the metrics point to a specific cause."""

_TOPOLOGY_MAPPER_SYSTEM = """You are the Topology Mapper, an infrastructure dependency specialist.
Your job: assess the blast radius — which other services are likely affected by this failure.
Focus on: likely upstream/downstream dependencies, shared resources, cascading failure risk.
Express confidence based on how clear the dependency relationships are."""


# ── Shared investigator runner ────────────────────────────────────────────────

async def _investigate(
    agent_name: str,
    system_prompt: str,
    user_content: str,
    state: IncidentState,
) -> dict[str, object]:
    log.info(f"{agent_name}.run", incident_id=state["incident_id"])

    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_content),
    ]
    raw: _InvestigatorOutput = await structured_invoke(_InvestigatorOutput, messages)

    findings = InvestigatorFindings(agent=agent_name, **raw.model_dump())
    note = AgentNote(
        agent=agent_name,
        content=f"[{findings.focus} | conf={findings.confidence:.0%}] {findings.summary}",
    )

    log.info(f"{agent_name}.done", incident_id=state["incident_id"], confidence=findings.confidence)
    return {"investigator_findings": [findings], "notes": [note]}


# ── The three investigator nodes ──────────────────────────────────────────────

async def log_detective_node(state: IncidentState) -> dict[str, object]:
    ds = get_datasource()
    service = state["input"].service
    logs = await ds.get_logs(service=service, count=20)

    log_lines = "\n".join(
        f"[{e['ts']}] {e['level']} {e['message']}" for e in logs
    )
    triager = state.get("triager_findings")
    context = f"Triager classified this as: {triager.failure_category}" if triager else ""

    user_content = f"""Service: {service}
{context}

LOGS (newest first):
{log_lines}

Investigate the logs and return your findings."""

    return await _investigate("log_detective", _LOG_DETECTIVE_SYSTEM, user_content, state)


async def metric_analyst_node(state: IncidentState) -> dict[str, object]:
    ds = get_datasource()
    service = state["input"].service
    metrics =await ds.get_metrics(service=service)

    triager = state.get("triager_findings")
    context = f"Triager classified this as: {triager.failure_category}" if triager else ""

    user_content = f"""Service: {service}
{context}

CURRENT METRICS:
CPU          : {metrics['cpu_pct']}%
Memory       : {metrics['memory_mb']} MB
Latency p95  : {metrics['latency_p95_ms']} ms
Error rate   : {metrics['error_rate_pct']}%
Uptime       : {metrics['uptime_seconds']}s

Normal baselines: CPU <30%, Memory <500MB, Latency <100ms, Error <1%, Uptime >3600s

Analyse the metrics and return your findings."""

    return await _investigate("metric_analyst", _METRIC_ANALYST_SYSTEM, user_content, state)


async def topology_mapper_node(state: IncidentState) -> dict[str, object]:
    


    service = state["input"].service
    triager = state.get("triager_findings")
    context = f"Triager classified this as: {triager.failure_category}" if triager else ""
    topology = describe_topology(service)
    

    user_content = f"""Failing service: {service}
{context}

Topology of the system:{topology}

Alert message: {state['input'].message}

Assess the blast radius and dependency impact. Return your findings."""

    return await _investigate("topology_mapper", _TOPOLOGY_MAPPER_SYSTEM, user_content, state)
