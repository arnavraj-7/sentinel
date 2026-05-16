from typing import Any

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from sentinel.agents.analyst import (
    after_critic_routing,
    critic_node,
    finalize_node,
    root_cause_analyst_node,
)
from sentinel.agents.executor import (
    after_human_routing,
    executor_node,
    human_approval_node,
)
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
    builder.add_node("root_cause_analyst", root_cause_analyst_node)
    builder.add_node("critic", critic_node)
    builder.add_node("human_approval", human_approval_node)
    builder.add_node("executor", executor_node)
    builder.add_node("finalize", finalize_node)

    # Edges
    builder.add_edge(START, "triager")
    builder.add_conditional_edges("triager", supervisor_node)

    # Parallel investigators converge on root_cause_analyst
    builder.add_edge("log_detective", "root_cause_analyst")
    builder.add_edge("metric_analyst", "root_cause_analyst")
    builder.add_edge("topology_mapper", "root_cause_analyst")

    # Reflection loop — critic routes back to analyst or forward to human_approval
    builder.add_edge("root_cause_analyst", "critic")
    builder.add_conditional_edges("critic", after_critic_routing)

    # HITL — human routes to executor (approved) or finalize (rejected)
    builder.add_conditional_edges("human_approval", after_human_routing)
    builder.add_edge("executor", "finalize")
    builder.add_edge("finalize", END)

    return builder.compile(checkpointer=checkpointer)
