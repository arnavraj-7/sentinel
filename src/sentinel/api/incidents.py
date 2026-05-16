from typing import Any

from fastapi import APIRouter, Request
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
    done: bool
    notes: list[AgentNote]
    triager_findings: TriagerFindings | None = None
    investigator_findings: list[InvestigatorFindings] = []
    root_cause_findings: RootCauseFindings | None = None
    critique: CritiqueResult | None = None


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
    return IncidentResponse(
        incident_id=incident_id,
        done=final_state["done"],
        notes=final_state["notes"],
        triager_findings=final_state.get("triager_findings"),
        investigator_findings=final_state.get("investigator_findings", []),
        root_cause_findings=final_state.get("root_cause_findings"),
        critique=final_state.get("critique"),
    )
