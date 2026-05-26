from datetime import UTC, datetime
from enum import StrEnum
from operator import add
from typing import Annotated, NotRequired
from uuid import uuid4

from pydantic import BaseModel, Field
from typing_extensions import TypedDict

# Import from the sub-graph's STATE module (leaf — no parent imports),
# NOT from `sentinel.subgraph.codepatch` (the package __init__.py pulls in
# graph.py, which imports IncidentState from THIS file → cycle).
from sentinel.subgraph.codepatch.state import CodePatchResult


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
    thinking_process: str = Field(description="Step-by-step reasoning over the evidence. Think BEFORE the conclusion fields.")
    failure_category: FailureCategory
    summary: str
    affected_services: list[str]
    recommended_actions: list[str]


class InvestigatorFindings(BaseModel):
    thinking_process: str = Field(description="Step-by-step reasoning over the evidence. Think BEFORE the conclusion fields.")
    agent: str
    focus: str
    summary: str
    evidence: list[str]
    confidence: float = Field(ge=0.0, le=1.0)
    
class RootCauseFindings(BaseModel):
    thinking_process: str = Field(description="Step-by-step reasoning over the evidence. Think BEFORE the conclusion fields.")
    root_cause: str
    contributing_factors: list[str]
    confidence: float = Field(ge=0.0, le=1.0)
    recommended_fix: str

class CritiqueResult(BaseModel):
    thinking_process: str = Field(description="Step-by-step reasoning over the evidence. Think BEFORE the conclusion fields.")
    approved: bool
    feedback: str
    confidence: float = Field(ge=0.0, le=1.0)
    
class RemediationAction(StrEnum):
    HEAL = "heal"
    RESTART = "restart"
    ROLLBACK = "rollback"
    SCALE_UP = "scale_up"
    INCREASE_DB_POOL = "increase_db_pool"
    VERIFY_HEALTH = "verify_health"
    VERIFY_METRICS = "verify_metrics"
    ESCALATE = "escalate"
    APPLY_CODE_PATCH = "apply_code_patch"
    # Phase 16c — synthetic action injected after a code_patch returns
    # `verified`. Pushes the sandbox commit to the prod repo and triggers
    # a service redeploy. NOT planner-emitted — added via the graph's
    # after-code-patch routing.
    PROMOTE = "promote"


# Phase 13a — Safe/Dangerous dual-track classification.
# Single source of truth: a Dangerous action MUTATES production state and is
# gated by a human-approval interrupt before the executor runs. A Safe action
# is read-only (verify_*) or terminal-signalling (escalate) and may execute
# unattended. Membership is the entire contract — there is no `DangerousAction`
# parallel enum to keep in sync, only this set.
DANGEROUS_ACTIONS: frozenset[RemediationAction] = frozenset({
    RemediationAction.HEAL,             # /heal restarts the service → mutation
    RemediationAction.RESTART,          # in-place restart            → mutation
    RemediationAction.ROLLBACK,         # redeploy prior revision     → mutation
    RemediationAction.SCALE_UP,         # changes instance count      → mutation
    RemediationAction.INCREASE_DB_POOL, # changes runtime config      → mutation
    RemediationAction.APPLY_CODE_PATCH, # changes code                → mutation
    RemediationAction.PROMOTE,          # pushes to prod              → mutation
})
# Safe (NOT in the set): VERIFY_HEALTH, VERIFY_METRICS (read-only probes),
# ESCALATE (signals a human — no production mutation).

class RemediationStep(BaseModel):
    remediation_action : RemediationAction
    critical:bool=Field(description=("True if this step is load-bearing: if it fails, the remaining steps and "
      "verification are pointless and the plan must be revised. False for "
      "best-effort/optional steps the plan can still succeed without."))
    description:str =Field(description="Description related to the Action,how to it helps and how to apply it")
    
class RemediationPlan(BaseModel):
    thinking_process: str = Field(description="Step-by-step reasoning over the evidence. Think BEFORE the conclusion fields.")
    remediation_steps: list[RemediationStep] = Field(min_length=1)
class StepResult(BaseModel):
    step:RemediationStep
    ok:bool
    detail:str

class VerificationResult(BaseModel):
    verified:bool
    verdict:str

# NOTE — PatchReport / PatchVerification used to live here. They now live
# INSIDE the code-patch sub-graph (sentinel.subgraph.codepatch.state) because
# they're sub-graph-internal accumulators, not parent state. The parent only
# sees the cohesive CodePatchResult (one summary, not the per-attempt lists).

class PostMortemReport(BaseModel):
    thinking_process: str = Field(description="Step-by-step reasoning over the evidence. Think BEFORE the conclusion fields.")
    title: str                       # "Crash Loop in api-gateway"
    executive_summary: str           # 2-3 sentences for non-technical management
    timeline: list[str]              # key events in chronological order
    root_cause: str                  # must match root_cause_findings exactly
    contributing_factors: list[str]  # from root_cause_findings
    impact: str                      # which services affected, blast radius
    resolution: str                  # what was done to fix it
    prevention_steps: list[str]      # concrete steps to prevent recurrence
    lessons_learned: list[str]       # specific to this incident, not generic SRE advice

class IncidentOutcome(StrEnum):
    RESOLVED = "resolved"              # verifier confirmed recovery (no promote)
    PROMOTED = "promoted"              # verified patch was promoted to prod + recovered
    ESCALATED = "escalated"            # an ESCALATE action actually executed
    EXHAUSTED = "exhausted"            # remediation_plan is None (loop guard)
    REJECTED = "rejected"              # human rejected the fix at the HITL gate
    EMPTY_PLAN_DEFECT = "empty_plan_defect"
    


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
    remediation_plan : NotRequired[RemediationPlan | None]
    executor_result : Annotated[list[StepResult],add]
    verification : NotRequired[VerificationResult | None]
    remediation_attempts: NotRequired[int]
    remediation_applied_at: NotRequired[datetime | None]
    # Phase 14a — step pointer for Option-3 per-step execution. Executor /
    # code_patch wrapper bump it; planner RESETS to 0 on every fresh plan.
    # No reducer — last-write-wins is what we want (executor + planner never
    # write to it in the same superstep).
    next_step_index: NotRequired[int]
    # Sub-graph hands back one cohesive result; the per-attempt PatchReports /
    # PatchVerifications stay private inside the sub-graph.
    code_patch_result: NotRequired[CodePatchResult | None]
    outcome: NotRequired[IncidentOutcome | None]
    human_decision: NotRequired[str]
    human_decision_plan: NotRequired[str]
    # Phase 16c — promote gate. `human_decision_promote` records the
    # operator's decision at the post-verify HITL ('approved' / 'rejected').
    # `promote_completed` flips True once the prod repo has been updated
    # and the lab service redeployed; finalize uses it to choose
    # PROMOTED vs plain RESOLVED.
    human_decision_promote: NotRequired[str]
    promote_completed: NotRequired[bool]
    post_mortem: NotRequired[str]
    done: bool
