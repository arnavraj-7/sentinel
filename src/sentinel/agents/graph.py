from typing import Any

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from sentinel.agents.state import IncidentState
from sentinel.agents.triager import triager_node

IncidentGraph = CompiledStateGraph[IncidentState, Any, IncidentState, IncidentState]


def build_graph(checkpointer: AsyncSqliteSaver) -> IncidentGraph:
    builder: StateGraph[IncidentState, Any, IncidentState, IncidentState] = StateGraph(
        IncidentState,
    )
    builder.add_node("triager", triager_node)
    builder.add_edge(START, "triager")
    builder.add_edge("triager", END)
    return builder.compile(checkpointer=checkpointer)
