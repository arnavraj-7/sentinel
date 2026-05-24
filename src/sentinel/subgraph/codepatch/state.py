"""Sub-graph state schema for the code-patch path.

Internal state lives in CodePatchState; the wrapper translates parent
IncidentState → CodePatchState on entry and sub-graph final state →
CodePatchResult on exit. PatchReport / PatchVerification are PRIVATE to
this sub-graph — the parent never sees them directly, only their summary
nested inside CodePatchResult.
"""
from operator import add
from typing import Annotated, Literal, NotRequired

from pydantic import BaseModel
from typing_extensions import TypedDict


class PatchReport(BaseModel):
    """One attempt's report — what Claude Code produced.

    Deterministic facts come from git (commit_sha, files_touched); the
    summary is CC's natural final text.
    """
    cc_session_id: str = ""
    summary: str
    files_touched: list[str]
    commit_sha: str
    tokens_used: int | None = None
    wall_time_seconds: float | None = None
    tools_used: list[str] | None = None


class PatchVerification(BaseModel):
    """One attempt's differential-check verdict — deterministic, no LLM.

    description leads with the failure mode (FIX FAILED / FAKE TEST /
    CODE FIX FAILED / VERIFICATION ERROR) so the retry can act on it.
    """
    ok: bool
    description: str


class CodePatchState(TypedDict):
    """Sub-graph internal state.

    Three blocks: inputs (set once by the wrapper), accumulators (mutated
    across retry iterations via the `add` reducer), and the terminal
    `outcome` field (set by the routing function before END).

    Note: no separate `iterations` counter — `len(patch_reports)` is the
    attempt counter. No `verified: bool` field — `patch_verifications[-1].ok`
    is the latest verdict. Don't store derived state.
    """
    # ── inputs (set by the wrapper from parent state) ──
    incident_id: str
    log_evidence: list[str]
    log_summary: str
    root_cause: str
    recommended_fix: str
    patch_step_description: str

    # ── accumulators (mutated across retry iterations) ──
    patch_reports: Annotated[list[PatchReport], add]
    patch_verifications: Annotated[list[PatchVerification], add]

    # ── terminal (set by the routing function before END) ──
    outcome: NotRequired[
        Literal["verified", "exhausted", "fix_failed", "fake_test", "error"]
    ]


class CodePatchResult(BaseModel):
    """What the wrapper hands back to parent state — one cohesive summary.

    Hides the sub-graph's internal accumulators (patch_reports,
    patch_verifications). The parent's IncidentState gains a single field
    `code_patch_result: CodePatchResult | None`, not the lists themselves.
    """
    outcome: Literal["verified", "exhausted", "fix_failed", "fake_test", "error"]
    last_report: PatchReport | None = None
    last_verification: PatchVerification | None = None
    attempts: int
