import httpx
from langgraph.types import interrupt

from sentinel.agents.state import AgentNote, IncidentState
from sentinel.config import settings
from sentinel.logging import log


def human_approval_node(state: IncidentState) -> dict[str, object]:
    log.info("human_approval_node.run", incident_id=state["incident_id"])
    rca = state["root_cause_findings"]
    decision = interrupt({
        "root_cause": rca.root_cause,
        "recommended_fix": rca.recommended_fix,
        "confidence": rca.confidence,
    })
    return {"human_decision": decision}


async def executor_node(state: IncidentState) -> dict[str, object]:
    service = state["input"].service
    log.info("executor.run", incident_id=state["incident_id"], service=service)

    async with httpx.AsyncClient(base_url=settings.lab_base_url, timeout=10.0) as client:
        result = (await client.post(f"/lab/services/{service}/heal")).json()

    note = AgentNote(
        agent="executor",
        content=f"Healed {service} — failure mode reset to '{result.get('failure_mode', 'healthy')}'.",
    )
    log.info("executor.done", incident_id=state["incident_id"], result=result)
    return {"notes": [note]}


def after_human_routing(state: IncidentState) -> str:
    approval = state.get("human_decision")
    if approval == "approved":
        log.info("after_human_routing.approved", incident_id=state["incident_id"])
        return "executor"
    else:
        log.info("after_human_routing.rejected", incident_id=state["incident_id"])
        return "finalize"
