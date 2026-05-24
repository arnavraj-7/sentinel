"""Compile the code-patch sub-graph + expose the parent-facing wrapper.

Sub-graph internal topology:

    START → code_fixer → sandbox_verifier
                              │
                              ├─ verified                 → _done_verified  → END
                              ├─ failed + attempts < 5    → code_fixer      (retry loop)
                              └─ exhausted                → _done_exhausted → END

The wrapper `code_patch_node` is what the parent graph registers as a node.
It does the input/output mapping that makes distinct schemas work, plus
Phase 14a's Option-3 bookkeeping (next_step_index + executor_result).
"""
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from sentinel.agents.state import IncidentState, RemediationAction, StepResult
from sentinel.logging import log
from sentinel.subgraph.codepatch.codefixer import code_fixer_node
from sentinel.subgraph.codepatch.patchverifier import sandbox_verifier_node
from sentinel.subgraph.codepatch.state import (
    CodePatchResult,
    CodePatchState,
)


_MAX_PATCH_ATTEMPTS = 5


# ── internal routing + terminal nodes ────────────────────────────────────────

def _after_verifier_routing(state: CodePatchState) -> str:
    """Decide the next step inside the sub-graph.

    verified              → _done_verified
    failed + attempts<5   → code_fixer (retry; CC session resumes on next attempt)
    exhausted (attempts≥5)→ _done_exhausted

    Bound = len(patch_reports). The list length IS the attempt counter
    (no separate counter field — that's redundant state).
    """
    verifications = state.get("patch_verifications") or []
    if verifications and verifications[-1].ok:
        return "_done_verified"
    attempts = len(state.get("patch_reports") or [])
    if attempts < _MAX_PATCH_ATTEMPTS:
        return "code_fixer"
    return "_done_exhausted"


def _done_verified_node(state: CodePatchState) -> dict[str, object]:
    """Terminal — set outcome=verified and let END finish the sub-graph."""
    return {"outcome": "verified"}


def _done_exhausted_node(state: CodePatchState) -> dict[str, object]:
    """Terminal — classify the failure mode from the last verdict's description.

    description always leads with the mode (FIX FAILED / FAKE TEST / ...) by
    convention, so this is a deterministic classification, not LLM prose.
    """
    verifs = state.get("patch_verifications") or []
    last = verifs[-1] if verifs else None
    if last is None:
        outcome = "error"
    elif last.description.startswith("FAKE TEST"):
        outcome = "fake_test"
    elif last.description.startswith("FIX FAILED") or last.description.startswith("CODE FIX FAILED"):
        outcome = "fix_failed"
    elif last.description.startswith("VERIFICATION ERROR"):
        outcome = "error"
    else:
        outcome = "exhausted"
    return {"outcome": outcome}


# ── compile the sub-graph (module-level, built once at import) ───────────────

def build_code_patch_subgraph() -> CompiledStateGraph:
    """Build and compile the code-patch sub-graph.

    IMPORTANT: do NOT pass a checkpointer here — the sub-graph inherits the
    parent's checkpointer automatically when invoked as a node. A second
    checkpointer would create duplicate persistence layers fighting each other.
    """
    builder = StateGraph(CodePatchState)
    builder.add_node("code_fixer", code_fixer_node)
    builder.add_node("sandbox_verifier", sandbox_verifier_node)
    builder.add_node("_done_verified", _done_verified_node)
    builder.add_node("_done_exhausted", _done_exhausted_node)

    builder.add_edge(START, "code_fixer")
    builder.add_edge("code_fixer", "sandbox_verifier")
    builder.add_conditional_edges("sandbox_verifier", _after_verifier_routing)
    builder.add_edge("_done_verified", END)
    builder.add_edge("_done_exhausted", END)
    return builder.compile()


code_patch_subgraph = build_code_patch_subgraph()


# ── parent-facing wrapper ────────────────────────────────────────────────────

async def code_patch_node(parent_state: IncidentState) -> dict[str, object]:
    """Parent graph wrapper around the code-patch sub-graph.

    Three responsibilities:
      1. Extract sub-graph inputs from parent IncidentState (input mapping).
      2. Invoke the sub-graph and await its terminal state.
      3. Translate sub-graph output → parent state delta (output mapping).
         For Option-3 step-pointer execution, the delta carries:
           - code_patch_result   : the cohesive summary the parent reads
           - next_step_index + 1 : advance the parent's step pointer
           - executor_result += [StepResult] : so the existing critical-fail
             routing logic still fires when the patch fails

    IMPORTANT: every line before `await code_patch_subgraph.ainvoke(...)` MUST
    be idempotent and side-effect-free. When 16c adds an HITL inside the
    sub-graph, the wrapper re-runs from the top on resume (LangGraph's re-run
    semantics). Building a dict from parent state is pure → safe to re-run.
    """
    log_detective = next(
        (i for i in (parent_state.get("investigator_findings") or [])
         if i.agent == "log_detective"),
        None,
    )
    rca = parent_state.get("root_cause_findings")
    plan = parent_state.get("remediation_plan")
    if rca is None or plan is None:
        raise RuntimeError("code_patch_node entered without RCA or plan")

    patch_step = next(
        (s for s in plan.remediation_steps
         if s.remediation_action == RemediationAction.APPLY_CODE_PATCH),
        None,
    )
    if patch_step is None:
        raise RuntimeError("code_patch_node entered without an APPLY_CODE_PATCH step")

    initial: CodePatchState = {
        "incident_id": parent_state["incident_id"],
        "log_evidence": list(log_detective.evidence) if log_detective else [],
        "log_summary": log_detective.summary if log_detective else "",
        "root_cause": rca.root_cause,
        "recommended_fix": rca.recommended_fix,
        "patch_step_description": patch_step.description,
        "patch_reports": [],
        "patch_verifications": [],
    }
    log.info("code_patch_node.invoke", incident_id=parent_state["incident_id"])

    sub_result = await code_patch_subgraph.ainvoke(initial)

    reports = sub_result.get("patch_reports") or []
    verifs = sub_result.get("patch_verifications") or []
    outcome = sub_result.get("outcome", "error")

    result = CodePatchResult(
        outcome=outcome,
        last_report=reports[-1] if reports else None,
        last_verification=verifs[-1] if verifs else None,
        attempts=len(reports),
    )

    # Option-3 bookkeeping: append a StepResult so the existing critical-fail
    # routing fires on a failed patch; increment the step pointer so the
    # parent's `after_step_routing` moves past this step.
    step_result = StepResult(
        step=patch_step,
        ok=(outcome == "verified"),
        detail=(result.last_report.summary if result.last_report
                else f"code-patch outcome: {outcome}"),
    )
    idx = parent_state.get("next_step_index", 0)

    return {
        "code_patch_result": result,
        "executor_result": [step_result],
        "next_step_index": idx + 1,
    }
