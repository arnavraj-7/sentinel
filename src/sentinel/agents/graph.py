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
    after_human_plan_routing,
    after_human_promote_routing,
    after_human_rca_routing,
    after_step_routing,
    executor_node,
    human_approval_plan_node,
    human_approval_promote_node,
    human_approval_rca_node,
)
from sentinel.agents.investigators import (
    log_detective_node,
    metric_analyst_node,
    topology_mapper_node,
)
from sentinel.agents.planner import after_planner_routing, planner_node
from sentinel.agents.state import IncidentState
from sentinel.agents.supervisor import supervisor_node
from sentinel.agents.triager import triager_node
from sentinel.agents.verifier import after_verify_routing, verifier_node
# Sub-graph: import the wrapper from the leaf module, NOT from the package
# __init__.py. The __init__.py is intentionally empty to avoid a circular
# import (see subgraph/codepatch/__init__.py for the full explanation).
from sentinel.subgraph.codepatch.graph import code_patch_node
from sentinel.subgraph.codepatch.promoter import promote_node

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
    builder.add_node("human_approval_plan", human_approval_plan_node)
    builder.add_node("planner", planner_node)
    builder.add_node("verifier", verifier_node)
    builder.add_node("executor", executor_node)
    # Phase 14a — code-patch sub-graph registered as ONE parent node. The
    # wrapper extracts inputs, invokes the compiled sub-graph, translates the
    # output back into a parent delta (code_patch_result + StepResult +
    # next_step_index bump). The parent never sees the sub-graph's internals.
    builder.add_node("code_patch", code_patch_node)
    # Phase 16c — promote gate + promote step. Gates on operator approval
    # AFTER the sub-graph's differential gate verifies a patch; pushes
    # the sandbox commit to prod + triggers a service redeploy.
    builder.add_node("human_approval_promote", human_approval_promote_node)
    builder.add_node("promote", promote_node)
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

    # Phase 12 self-healing loop + Phase 14a per-step dispatch
    #   planner → after_planner_routing → (human_approval_plan | executor | finalize)
    #   human_approval_plan → after_human_plan_routing
    #         approved → after_step_routing  (so step 0 dispatches correctly)
    #         rejected → finalize
    #   executor   → after_step_routing  (loop continues per-step)
    #   code_patch → after_step_routing  (sub-graph returns; step pointer was
    #                already advanced inside the wrapper, so the router peeks
    #                the NEXT step — same logic as after the executor.)
    # One router serves three triggers because the routing decision depends on
    # the STEP just completed, not on which node ran it.
    builder.add_conditional_edges("planner", after_planner_routing)
    builder.add_conditional_edges("human_approval_plan", after_human_plan_routing)
    builder.add_conditional_edges("executor", after_step_routing)
    builder.add_conditional_edges("code_patch", after_step_routing)
    # Phase 16c — promote gate wiring
    builder.add_conditional_edges("human_approval_promote", after_human_promote_routing)
    # promote_node hands back to the shared step-router; it will see
    # promote_completed=True and continue with whatever's next in the plan
    # (verify_health → verify_metrics → prod verifier).
    builder.add_conditional_edges("promote", after_step_routing)

    builder.add_conditional_edges("verifier", after_verify_routing)
    builder.add_edge("finalize", "post_mortem")
    builder.add_edge("post_mortem", END)

    return builder.compile(checkpointer=checkpointer)
