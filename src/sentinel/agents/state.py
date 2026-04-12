from datetime import UTC, datetime
from enum import StrEnum
from operator import add
from typing import Annotated
from uuid import uuid4

from pydantic import BaseModel, Field
from typing_extensions import TypedDict


class Severity(StrEnum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class IncidentInput(BaseModel):
    """Validated payload POSTed to /incidents — the external API boundary."""

    alert_id: str
    service: str
    message: str
    severity: Severity = Severity.MEDIUM
    labels: dict[str, str] = Field(default_factory=dict)


class AgentNote(BaseModel):
    """Structured note appended by any agent node. Reducer merges them."""

    agent: str
    content: str
    at: datetime = Field(default_factory=lambda: datetime.now(UTC))


def _new_incident_id() -> str:
    return f"inc_{uuid4().hex[:12]}"


class IncidentState(TypedDict):
    """Shared state threaded through the graph.

    Using TypedDict (LangGraph's recommended state type) with Pydantic
    models as values gives us both reducer support and strict validation
    at API boundaries.
    """

    incident_id: str
    input: IncidentInput
    notes: Annotated[list[AgentNote], add]
    done: bool
