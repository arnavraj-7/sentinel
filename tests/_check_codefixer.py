"""Phase 16a/14a standalone check — drives the code-patch sub-graph node
directly (NOT via the full incident graph). After Phase 14a the entry point
is the sub-graph node `code_fixer_node`, which takes the FLAT CodePatchState
the wrapper would normally build from parent state.

NOT a pytest test (leading underscore skips collection). This makes REAL
Claude Code SDK calls — it costs money, needs SDK auth, and clones a repo.

Prerequisites:
  1. claude-agent-sdk installed in the venv.
  2. Claude Code SDK authenticated (your Claude Max plan / local `claude` login).
  3. SENTINEL_GITHUB_PROD_LINK set to the dummy repo, e.g. (PowerShell):
        $env:SENTINEL_GITHUB_PROD_LINK = "D:/projects/codefix-testrepo"

Run (from the sentinel repo root):
  .venv\\Scripts\\python.exe tests\\_check_codefixer.py

Expected: code_fixer_node clones the repo, CC locates the KeyError in
calculate_total (order["discount"] -> order.get("discount", 0.0)), runs the
tests green, commits, and the returned delta contains one PatchReport with a
real commit_sha and files_touched == ["app.py"].
"""

import asyncio

from sentinel.config import settings
from sentinel.subgraph.codepatch.codefixer import code_fixer_node
from sentinel.subgraph.codepatch.state import CodePatchState

if not settings.github_prod_link:
    raise SystemExit(
        "SENTINEL_GITHUB_PROD_LINK is not set. Point it at the dummy repo first:\n"
        '  PowerShell:  $env:SENTINEL_GITHUB_PROD_LINK = "D:/projects/codefix-testrepo"'
    )


def _fake_state() -> CodePatchState:
    """A hand-built CodePatchState carrying exactly the FLAT inputs the
    wrapper would normally extract from parent IncidentState. Symptom-level
    alert phrasing is gone here because the sub-graph already gets the
    diagnosed root cause — these are derived findings, not the raw alert."""
    return {
        "incident_id": "inc_codefix_test",
        "log_evidence": [
            'Traceback (most recent call last): File "app.py", in calculate_total',
            '    discount = order["discount"]',
            "KeyError: 'discount'",
        ],
        "log_summary": (
            "calculate_total in app.py raises KeyError: 'discount' for "
            "orders that omit the optional discount field."
        ),
        "root_cause": (
            "calculate_total in app.py accesses order['discount'] without a "
            "guard, raising KeyError for orders that have no discount."
        ),
        "recommended_fix": (
            "Use order.get('discount', 0.0) so a missing discount defaults "
            "to zero, matching the documented optional behaviour."
        ),
        "patch_step_description": (
            "Fix the unguarded order['discount'] access in calculate_total "
            "so a missing discount defaults to 0.0."
        ),
        "patch_reports": [],
        "patch_verifications": [],
    }


async def main() -> None:
    print(f"Target repo: {settings.github_prod_link}")
    print("Running code_fixer_node — real Claude Code SDK call, this may take a few minutes...\n")

    delta = await code_fixer_node(_fake_state())
    reports = delta.get("patch_reports") or []
    if not reports:
        raise SystemExit("FATAL: code_fixer_node returned no patch_reports — should always return one.")
    report = reports[-1]

    print("=" * 60)
    print("PatchReport")
    print("=" * 60)
    print(f"commit_sha    : {report.commit_sha or '(none — patch failed)'}")
    print(f"files_touched : {report.files_touched}")
    print(f"cc_session_id : {report.cc_session_id}")
    print(f"summary       : {report.summary}")
    if report.tokens_used is not None:
        print(f"tokens_used   : {report.tokens_used}")
    print()

    if report.commit_sha:
        print("RESULT: code_fixer_node produced a real commit. Inspect it with:")
        print(f"  git -C <sandbox-dir> show {report.commit_sha}")
    else:
        print("RESULT: no commit produced — see the summary above for the failure reason.")


if __name__ == "__main__":
    asyncio.run(main())
