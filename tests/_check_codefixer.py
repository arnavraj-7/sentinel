"""Phase 16a standalone check — drives `code_fixer` against the dummy repo.

NOT a pytest test (leading underscore skips collection). This makes REAL
Claude Code SDK calls — it costs money, needs SDK auth, and clones a repo.

Prerequisites:
  1. claude-agent-sdk installed in the venv.
  2. Claude Code SDK authenticated (your Claude Max plan / local `claude` login).
  3. SENTINEL_GITHUB_PROD_LINK set to the dummy repo, e.g. (PowerShell):
        $env:SENTINEL_GITHUB_PROD_LINK = "D:/projects/codefix-testrepo"

Run (from the sentinel repo root):
  .venv\\Scripts\\python.exe tests\\_check_codefixer.py

Expected: code_fixer clones the repo, CC locates the KeyError in
calculate_total (order["discount"] -> order.get("discount", 0.0)), runs the
tests green, commits, and returns a PatchReport with a real commit_sha and
files_touched == ["app.py"].
"""

import asyncio

from sentinel.agents.code_fixer import code_fixer
from sentinel.agents.state import (
    IncidentInput,
    InvestigatorFindings,
    RemediationAction,
    RemediationPlan,
    RemediationStep,
    RootCauseFindings,
    Severity,
)
from sentinel.config import settings

if not settings.github_prod_link:
    raise SystemExit(
        "SENTINEL_GITHUB_PROD_LINK is not set. Point it at the dummy repo first:\n"
        '  PowerShell:  $env:SENTINEL_GITHUB_PROD_LINK = "D:/projects/codefix-testrepo"'
    )


def _fake_state() -> dict:
    """A hand-built IncidentState carrying exactly what code_fixer reads:
    incident_id, investigator_findings, root_cause_findings, remediation_plan,
    patch_reports. The alert `message` stays symptom-level (the leak-safe
    testing rule) — the actual diagnosis lives in the derived findings.
    """
    return {
        "incident_id": "inc_codefix_test",
        "input": IncidentInput(
            alert_id="alert-codefix-test",
            service="order-pricing",
            message="users reporting failures when placing orders",
            severity=Severity.HIGH,
        ),
        "notes": [],
        "investigator_findings": [
            InvestigatorFindings(
                thinking_process=(
                    "The traceback shows a KeyError raised inside calculate_total in app.py."
                ),
                agent="log_detective",
                focus="KeyError in calculate_total",
                summary=(
                    "calculate_total in app.py raises KeyError: 'discount' for "
                    "orders that omit the optional discount field."
                ),
                evidence=[
                    'Traceback (most recent call last): File "app.py", in calculate_total',
                    '    discount = order["discount"]',
                    "KeyError: 'discount'",
                ],
                confidence=1.0,
            ),
        ],
        "root_cause_findings": RootCauseFindings(
            thinking_process=(
                "calculate_total reads order['discount'] directly. The docstring "
                "states discount is optional, but the code requires it — orders "
                "without that key crash with KeyError."
            ),
            root_cause=(
                "calculate_total in app.py accesses order['discount'] without a "
                "guard, raising KeyError for orders that have no discount."
            ),
            contributing_factors=[
                "The optional discount field has no default in calculate_total.",
            ],
            confidence=1.0,
            recommended_fix=(
                "Use order.get('discount', 0.0) so a missing discount defaults "
                "to zero, matching the documented optional behaviour."
            ),
        ),
        "remediation_plan": RemediationPlan(
            thinking_process="The failure is a code defect — dispatch to the code fixer.",
            remediation_steps=[
                RemediationStep(
                    remediation_action=RemediationAction.APPLY_CODE_PATCH,
                    critical=True,
                    description=(
                        "Fix the unguarded order['discount'] access in "
                        "calculate_total so a missing discount defaults to 0.0."
                    ),
                ),
            ],
        ),
        "executor_result": [],
        "patch_reports": [],
        "done": False,
    }


async def main() -> None:
    print(f"Target repo: {settings.github_prod_link}")
    print("Running code_fixer — real Claude Code SDK call, this may take a few minutes...\n")

    report = await code_fixer(_fake_state())

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
        print("RESULT: code_fixer produced a real commit. Inspect it with:")
        print(f"  git -C <sandbox-dir> show {report.commit_sha}")
    else:
        print("RESULT: no commit produced — see the summary above for the failure reason.")


if __name__ == "__main__":
    asyncio.run(main())
