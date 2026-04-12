from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from sentinel.agents.graph import build_graph
from sentinel.agents.state import IncidentInput, IncidentState, Severity


async def test_triager_node_produces_note_and_marks_done() -> None:
    async with AsyncSqliteSaver.from_conn_string(":memory:") as checkpointer:
        graph = build_graph(checkpointer)
        payload = IncidentInput(
            alert_id="a-1",
            service="api-gateway",
            message="5xx spike",
            severity=Severity.HIGH,
        )
        initial: IncidentState = {
            "incident_id": "inc_test_0001",
            "input": payload,
            "notes": [],
            "done": False,
        }
        config = {"configurable": {"thread_id": "inc_test_0001"}}

        result = await graph.ainvoke(initial, config=config)

        assert result["done"] is True
        assert len(result["notes"]) == 1
        note = result["notes"][0]
        assert note.agent == "triager"
        assert "api-gateway" in note.content
        assert "high" in note.content


async def test_graph_checkpoint_persists_across_second_invocation() -> None:
    """Second invocation with same thread_id should see prior state."""
    async with AsyncSqliteSaver.from_conn_string(":memory:") as checkpointer:
        graph = build_graph(checkpointer)
        payload = IncidentInput(alert_id="a-2", service="db", message="slow queries")
        initial: IncidentState = {
            "incident_id": "inc_test_0002",
            "input": payload,
            "notes": [],
            "done": False,
        }
        config = {"configurable": {"thread_id": "inc_test_0002"}}

        await graph.ainvoke(initial, config=config)
        snapshot = await graph.aget_state(config)

        assert snapshot is not None
        assert snapshot.values["done"] is True
        assert len(snapshot.values["notes"]) == 1
