from datetime import UTC, datetime
from enum import StrEnum
from operator import add
from typing import Annotated, NotRequired
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


class FailureCategory(StrEnum):
    HIGH_ERROR_RATE = "high_error_rate"
    DATA_CORRUPTION = "data_corruption"
    MEMORY_LEAK = "memory_leak"
    CRASH_LOOP = "crash_loop"
    LATENCY_SPIKE = "latency_spike"
    SURGE_5xx = "surge_5xx"
    DB_POOL_EXHAUSTION = "db_pool_exhaustion"
    CERT_EXPIRY = "cert_expiry"
    UNKNOWN = "unknown"


class TriagerFindings(BaseModel):
    failure_category: FailureCategory
    summary: str
    affected_services: list[str]
    recommended_actions: list[str]


class InvestigatorFindings(BaseModel):
    agent: str
    focus: str
    summary: str
    evidence: list[str]
    confidence: float = Field(ge=0.0, le=1.0)
    
class RootCauseFindings(BaseModel):
    root_cause: str
    contributing_factors: list[str]
    confidence: float = Field(ge=0.0, le=1.0)
    recommended_fix: str

class CritiqueResult(BaseModel):
    approved: bool
    feedback: str
    confidence: float = Field(ge=0.0, le=1.0)
    

class PostMortemReport(BaseModel):
    title: str                       # "Crash Loop in api-gateway"
    executive_summary: str           # 2-3 sentences for non-technical management
    timeline: list[str]              # key events in chronological order
    root_cause: str                  # must match root_cause_findings exactly
    contributing_factors: list[str]  # from root_cause_findings
    impact: str                      # which services affected, blast radius
    resolution: str                  # what was done to fix it
    prevention_steps: list[str]      # concrete steps to prevent recurrence
    lessons_learned: list[str]       # specific to this incident, not generic SRE advice




class IncidentState(TypedDict):
    """Shared state threaded through the graph."""

    incident_id: str
    input: IncidentInput
    notes: Annotated[list[AgentNote], add]
    triager_findings: NotRequired[TriagerFindings | None]
    investigator_findings: Annotated[list[InvestigatorFindings], add]
    root_cause_findings:NotRequired[RootCauseFindings | None]
    critique: NotRequired[CritiqueResult | None]
    revision_count: NotRequired[int]
    human_decision: NotRequired[str]
    post_mortem: NotRequired[str]   
    done: bool
