"""Phase 16c — promote a verified sandbox commit to the prod repo and
trigger a service redeploy.

This runs AFTER the sub-graph's differential test gate has verified a
patch AND the operator has approved promotion at the post-verify HITL.

What it does:
  1. `git fetch <sandbox> <sha>:refs/sentinel/promote` on the prod repo
     so we have the commit object locally.
  2. Check out the default branch, hard-reset to that commit. (We can't
     do a plain `git push` from sandbox → prod because the prod repo
     has the default branch checked out, and git refuses by default.)
  3. Clean any untracked files.
  4. Trigger the lab's `/heal` so the simulated service "redeploys" with
     the new code — without this the metrics stay broken and the
     downstream prod-verifier keeps failing.

Why this is its own module, not part of helpers.py:
  helpers.py is sandbox-side utilities (sandbox setup, sandbox-side
  git). Promotion is prod-side and has different invariants — it lives
  next to the sub-graph but conceptually crosses out of it.
"""
from sentinel.agents.state import (
    AgentNote,
    IncidentState,
    RemediationAction,
    RemediationStep,
    StepResult,
)
from sentinel.config import settings
from sentinel.datasource import get_datasource
from sentinel.logging import log
from sentinel.subgraph.codepatch.helpers import (
    _origin_default_branch,
    _sandbox_path,
    git,
)


async def promote_node(state: IncidentState) -> dict[str, object]:
    """Push the verified commit to prod, then redeploy via /heal."""
    incident_id = state["incident_id"]
    cpr = state.get("code_patch_result")

    # Defensive — routing should never enter here without a verified patch.
    if (
        cpr is None
        or cpr.last_report is None
        or not cpr.last_report.commit_sha
        or cpr.outcome != "verified"
    ):
        log.error("promote.precondition_failed", incident_id=incident_id)
        return {
            "promote_completed": False,
            "notes": [AgentNote(
                agent="promote",
                content="Cannot promote — no verified patch in state.",
            )],
        }

    sha = cpr.last_report.commit_sha
    sandbox = _sandbox_path(incident_id)
    prod = settings.github_prod_link
    service = state["input"].service

    log.info("promote.run", incident_id=incident_id, sha=sha[:8],
             sandbox=sandbox, prod=prod)

    step = RemediationStep(
        remediation_action=RemediationAction.PROMOTE,
        critical=True,
        description=f"Push verified commit {sha[:8]} to prod and redeploy",
    )

    try:
        # Fetch the sandbox's commit into the prod repo under a private ref.
        await git(prod, "fetch", sandbox, f"{sha}:refs/sentinel/promote")
        default = await _origin_default_branch(prod)
        await git(prod, "checkout", "-f", default)
        await git(prod, "reset", "--hard", "refs/sentinel/promote")
        await git(prod, "clean", "-fdx")

        # Simulate the deploy that the new code triggers — the lab
        # transitions the service back to HEALTHY so prod-verify can
        # actually pass.
        ds = get_datasource()
        await ds.heal(service)

        log.info("promote.done", incident_id=incident_id, sha=sha[:8])

        return {
            "promote_completed": True,
            "executor_result": [StepResult(
                step=step,
                ok=True,
                detail=f"Promoted {sha[:8]} to {prod} and redeployed {service}",
            )],
            "notes": [AgentNote(
                agent="promote",
                content=f"Promoted commit {sha[:8]} to prod and triggered "
                        f"redeploy of {service}.",
            )],
        }
    except Exception as exc:
        log.error("promote.failed", incident_id=incident_id, error=str(exc))
        return {
            "promote_completed": False,
            "executor_result": [StepResult(
                step=step,
                ok=False,
                detail=f"Promote failed: {exc}",
            )],
            "notes": [AgentNote(
                agent="promote",
                content=f"Promote failed: {exc}",
            )],
        }
