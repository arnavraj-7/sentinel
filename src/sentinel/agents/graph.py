from typing import Any

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from sentinel.agents.state import AgentNote, IncidentState
from sentinel.logging import log

IncidentGraph = CompiledStateGraph[IncidentState, Any, IncidentState, IncidentState]


def triager_node(state: IncidentState) -> dict[str, object]:
    """Phase 0 placeholder. Will become a real classifier in Phase 2."""
    incident_id = state["incident_id"]
    payload = state["input"]

    log.info(
        "triager.run",
        incident_id=incident_id,
        service=payload.service,
        severity=payload.severity.value,
    )

    note = AgentNote(
        agent="triager",
        content=(
            f"Received alert for service={payload.service} "
            f"severity={payload.severity.value}: {payload.message}"
        ),
    )
    return {"notes": [note], "done": True}


def build_graph(checkpointer: AsyncSqliteSaver) -> IncidentGraph:
    builder: StateGraph[IncidentState, Any, IncidentState, IncidentState] = StateGraph(
        IncidentState,
    )
    builder.add_node("triager", triager_node)
    builder.add_edge(START, "triager")
    builder.add_edge("triager", END)
    return builder.compile(checkpointer=checkpointer)
