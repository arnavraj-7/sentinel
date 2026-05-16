from typing import Any

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from sentinel.agents.investigators import (
    log_detective_node,
    metric_analyst_node,
    topology_mapper_node,
)
from sentinel.agents.state import IncidentState
from sentinel.agents.supervisor import supervisor_node
from sentinel.agents.triager import triager_node

IncidentGraph = CompiledStateGraph[IncidentState, Any, IncidentState, IncidentState]


def build_graph(checkpointer: AsyncSqliteSaver) -> IncidentGraph:
    builder: StateGraph[IncidentState, Any, IncidentState, IncidentState] = StateGraph(
        IncidentState,
    )

    # Nodes
    builder.add_node("triager", triager_node)
    builder.add_node("log_detective", log_detective_node)
    builder.add_node("metric_analyst", metric_analyst_node)
    builder.add_node("topology_mapper", topology_mapper_node)

    # Edges
    builder.add_edge(START, "triager")
    # supervisor_node returns list[Send] → routing function, not a node
    builder.add_conditional_edges("triager", supervisor_node)
    builder.add_edge("log_detective", END)
    builder.add_edge("metric_analyst", END)
    builder.add_edge("topology_mapper", END)

    return builder.compile(checkpointer=checkpointer)
