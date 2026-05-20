from typing import Any

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from sentinel.agents.analyst import (
    after_critic_routing,
    critic_node,
    root_cause_analyst_node,
)
from sentinel.agents.finalize import finalize_node
from sentinel.agents.scribe import post_mortem_node
from sentinel.agents.executor import (
    after_executor_routing,
    human_approval_rca_node,
    after_human_rca_routing,
    executor_node,
    human_approval_plan_node,
    after_human_plan_routing,
)
from sentinel.agents.investigators import (
    log_detective_node,
    metric_analyst_node,
    topology_mapper_node,
)
from sentinel.agents.state import IncidentState
from sentinel.agents.supervisor import supervisor_node
from sentinel.agents.triager import triager_node
from sentinel.agents.planner import after_planner_routing, planner_node
from sentinel.agents.verifier import after_verify_routing, verifier_node
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
    builder.add_node("human_approval_rca", human_approval_rca_node)
    builder.add_node("human_approval_plan",human_approval_plan_node)
    builder.add_node("planner",planner_node)
    builder.add_node("verifier",verifier_node)
    builder.add_node("executor", executor_node)
    builder.add_node("finalize", finalize_node)
    builder.add_node("post_mortem", post_mortem_node)

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

    # HITL — approved → planner; rejected → finalize
    builder.add_conditional_edges("human_approval_rca", after_human_rca_routing)
    # Phase 12 self-healing loop: planner → HITL → executor → verifier, with replan
    builder.add_conditional_edges("planner", after_planner_routing)
    builder.add_conditional_edges("human_approval_plan",after_human_plan_routing)
    builder.add_conditional_edges("executor", after_executor_routing)
    builder.add_conditional_edges("verifier", after_verify_routing)
    builder.add_edge("finalize", "post_mortem")
    builder.add_edge("post_mortem", END)

    return builder.compile(checkpointer=checkpointer)
