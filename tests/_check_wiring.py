"""Phase 13a compile-check (not a pytest test — leading underscore skips collection).

Verifies the graph builds with the new dual-track HITL wiring:
  - both human_approval_* nodes registered
  - their routers point at real registered node names
  - planner conditional-edges resolve cleanly
A compile failure here = a stale string literal in graph.py or planner.py.
"""

import asyncio

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from sentinel.agents.graph import build_graph


async def main() -> None:
    async with AsyncSqliteSaver.from_conn_string(":memory:") as cp:
        graph = build_graph(cp)
        nodes = sorted(graph.get_graph().nodes)
        print(f"compiled OK — {len(nodes)} nodes:")
        for n in nodes:
            print("  -", n)
        expected = {"human_approval_rca", "human_approval_plan"}
        missing = expected - set(nodes)
        assert not missing, f"MISSING nodes: {missing}"
        print("Phase 13a HITL nodes present.")


asyncio.run(main())
