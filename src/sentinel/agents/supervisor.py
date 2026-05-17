from langgraph.types import Send

from sentinel.agents.state import FailureCategory, IncidentState

# Which investigators are needed per failure category.
# cert_expiry → logs are useless (cert issues don't appear in app logs)
# db_pool_exhaustion → topology matters (many services share the DB)
_CATEGORY_AGENTS: dict[FailureCategory, list[str]] = {
    FailureCategory.MEMORY_LEAK:        ["log_detective", "metric_analyst"],
    FailureCategory.CRASH_LOOP:         ["log_detective", "metric_analyst", "topology_mapper"],
    FailureCategory.LATENCY_SPIKE:      ["log_detective", "metric_analyst", "topology_mapper"],
    FailureCategory.SURGE_5xx:          ["log_detective", "metric_analyst"],
    FailureCategory.DB_POOL_EXHAUSTION: ["metric_analyst", "topology_mapper"],
    FailureCategory.CERT_EXPIRY:        ["metric_analyst", "topology_mapper"],
    FailureCategory.HIGH_ERROR_RATE:  ["log_detective", "metric_analyst", "topology_mapper"],
    FailureCategory.DATA_CORRUPTION:  ["log_detective", "metric_analyst"],
    FailureCategory.UNKNOWN:            ["log_detective", "metric_analyst", "topology_mapper"],
}


def supervisor_node(state: IncidentState) -> list[Send]:
    """Decide which investigators to run based on the triager's failure category.
    """
    triager_findings = state.get("triager_findings")
    if triager_findings is None:
        failure_category = FailureCategory.UNKNOWN
    else:
        failure_category = triager_findings.failure_category
        
    agents_to_run = _CATEGORY_AGENTS[failure_category]
    return [Send(agent_name, state) for agent_name in agents_to_run]
