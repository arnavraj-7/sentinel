from typing import Any

from fastapi import APIRouter, HTTPException, Request
from langgraph.types import Command
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from sentinel.agents.state import (
    AgentNote,
    CritiqueResult,
    IncidentInput,
    IncidentOutcome,
    IncidentState,
    InvestigatorFindings,
    RootCauseFindings,
    StepResult,
    TriagerFindings,
    VerificationResult,
    _new_incident_id,
)
from sentinel.api._streaming import stream_graph_events
from sentinel.subgraph.codepatch.state import CodePatchResult

router = APIRouter(prefix="/incidents", tags=["incidents"])


class IncidentResponse(BaseModel):
    """Snapshot of incident state after an ainvoke. SSE clients don't use
    this — they consume the streamed events directly."""
    incident_id: str
    status: str                      # "pending_approval" | "completed"
    done: bool
    notes: list[AgentNote]
    triager_findings: TriagerFindings | None = None
    investigator_findings: list[InvestigatorFindings] = []
    root_cause_findings: RootCauseFindings | None = None
    critique: CritiqueResult | None = None
    interrupt_payload: dict | None = None
    post_mortem: str | None = None
    outcome: IncidentOutcome | None = None
    # Phase 17 — surface the sub-graph result + per-step results so the
    # frontend can render the diff + the per-step verdicts. Both were in
    # state already; they just weren't exposed over HTTP.
    code_patch_result: CodePatchResult | None = None
    executor_result: list[StepResult] = []
    verification: VerificationResult | None = None


class ApproveInput(BaseModel):
    approved: bool


def _build_response(incident_id: str, state: dict) -> IncidentResponse:
    done = state.get("done", False)
    response = IncidentResponse(
        incident_id=incident_id,
        status="completed" if done else "pending_approval",
        done=done,
        notes=state.get("notes", []),
        triager_findings=state.get("triager_findings"),
        investigator_findings=state.get("investigator_findings", []),
        root_cause_findings=state.get("root_cause_findings"),
        critique=state.get("critique"),
        post_mortem=state.get("post_mortem"),
        outcome=state.get("outcome"),
        code_patch_result=state.get("code_patch_result"),
        executor_result=state.get("executor_result", []),
        verification=state.get("verification"),
    )
    interrupt = state.get("pending_interrupt", None)
    if interrupt is not None:
        response.interrupt_payload = interrupt
    return response


# ── Non-streaming endpoints (legacy / smoke-test compatible) ────────────────
# Kept so tests/_check_e2e_incident.py + any sync client still works.

@router.post("", response_model=IncidentResponse)
async def trigger_incident(payload: IncidentInput, request: Request) -> IncidentResponse:
    graph = request.app.state.graph
    incident_id = _new_incident_id()
    config: dict[str, Any] = {"configurable": {"thread_id": incident_id}}
    initial: IncidentState = {
        "incident_id": incident_id,
        "input": payload,
        "notes": [],
        "done": False,
    }
    final_state = await graph.ainvoke(initial, config=config)
    snapshot = await graph.aget_state(config)
    pending_interrupt = next(
        (intr.value for task in snapshot.tasks for intr in task.interrupts),
        None,
    )
    final_state["pending_interrupt"] = pending_interrupt
    return _build_response(incident_id, final_state)


@router.post("/{incident_id}/approve", response_model=IncidentResponse)
async def approve_incident(
    incident_id: str, payload: ApproveInput, request: Request
) -> IncidentResponse:
    graph = request.app.state.graph
    config: dict[str, Any] = {"configurable": {"thread_id": incident_id}}

    snapshot = await graph.aget_state(config)
    if not snapshot or not snapshot.tasks:
        raise HTTPException(status_code=404, detail=f"No pending incident '{incident_id}'")

    decision = "approved" if payload.approved else "rejected"
    final_state = await graph.ainvoke(Command(resume=decision), config=config)
    snapshot = await graph.aget_state(config)
    pending_interrupt = next(
        (intr.value for task in snapshot.tasks for intr in task.interrupts),
        None,
    )
    final_state["pending_interrupt"] = pending_interrupt
    return _build_response(incident_id, final_state)


# ── SSE streaming endpoints (Phase 17 frontend) ──────────────────────────────
#
# Two endpoints, one shape: each runs a single graph.astream() chunk until
# either an interrupt() or END, then closes the SSE connection. The next
# leg of the incident (resume after HITL) is a fresh POST to /approve/stream.
#
# Why two endpoints, not one persistent stream:
#   - HITL gates are explicit user input. Closing the stream between legs
#     means the frontend's flow is "stream → approve form → new stream",
#     which is easier to reason about than holding a multi-hour socket
#     and multiplexing approve commands over it.
#   - Each leg's SSE response sets clear backpressure boundaries; if the
#     frontend disconnects mid-stream the graph keeps running and the
#     state is preserved by the checkpointer.

@router.post("/stream")
async def stream_incident(payload: IncidentInput, request: Request):
    """Fire a new incident and stream every node update + writer event."""
    graph = request.app.state.graph
    incident_id = _new_incident_id()
    config: dict[str, Any] = {"configurable": {"thread_id": incident_id}}
    initial: IncidentState = {
        "incident_id": incident_id,
        "input": payload,
        "notes": [],
        "done": False,
    }

    async def gen():
        # First event tells the client the incident_id so subsequent
        # /approve/stream calls can target it.
        yield {"event": "init", "data": f'{{"incident_id": "{incident_id}"}}'}
        async for evt in stream_graph_events(graph, initial, config):
            yield evt

    return EventSourceResponse(gen())


@router.post("/{incident_id}/approve/stream")
async def approve_and_stream(
    incident_id: str, payload: ApproveInput, request: Request
):
    """Resume from a HITL gate and stream until the next pause/terminal."""
    graph = request.app.state.graph
    config: dict[str, Any] = {"configurable": {"thread_id": incident_id}}

    snapshot = await graph.aget_state(config)
    if not snapshot or not snapshot.tasks:
        raise HTTPException(status_code=404, detail=f"No pending incident '{incident_id}'")

    decision = "approved" if payload.approved else "rejected"
    command = Command(resume=decision)

    async def gen():
        yield {"event": "init", "data": f'{{"incident_id": "{incident_id}", "resumed_with": "{decision}"}}'}
        async for evt in stream_graph_events(graph, command, config):
            yield evt

    return EventSourceResponse(gen())
