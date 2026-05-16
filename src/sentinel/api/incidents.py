from typing import Any

from fastapi import APIRouter, HTTPException, Request
from langgraph.types import Command
from pydantic import BaseModel

from sentinel.agents.state import (
    AgentNote,
    CritiqueResult,
    IncidentInput,
    IncidentState,
    InvestigatorFindings,
    RootCauseFindings,
    TriagerFindings,
    _new_incident_id,
)

router = APIRouter(prefix="/incidents", tags=["incidents"])


class IncidentResponse(BaseModel):
    incident_id: str
    status: str                      # "pending_approval" | "completed"
    done: bool
    notes: list[AgentNote]
    triager_findings: TriagerFindings | None = None
    investigator_findings: list[InvestigatorFindings] = []
    root_cause_findings: RootCauseFindings | None = None
    critique: CritiqueResult | None = None
    interrupt_payload: dict | None = None  # what the human sees to make the decision


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
    )
    # Surface what the human needs to review if paused at interrupt()
    if not done and response.root_cause_findings:
        rca = response.root_cause_findings
        response.interrupt_payload = {
            "root_cause": rca.root_cause,
            "recommended_fix": rca.recommended_fix,
            "confidence": rca.confidence,
        }
    return response


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
    return _build_response(incident_id, final_state)


@router.post("/{incident_id}/approve", response_model=IncidentResponse)
async def approve_incident(
    incident_id: str, payload: ApproveInput, request: Request
) -> IncidentResponse:
    graph = request.app.state.graph
    config: dict[str, Any] = {"configurable": {"thread_id": incident_id}}

    # Verify the incident exists and is paused
    snapshot = await graph.aget_state(config)
    if not snapshot or not snapshot.tasks:
        raise HTTPException(status_code=404, detail=f"No pending incident '{incident_id}'")

    decision = "approved" if payload.approved else "rejected"
    final_state = await graph.ainvoke(Command(resume=decision), config=config)
    return _build_response(incident_id, final_state)
