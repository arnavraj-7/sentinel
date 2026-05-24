"""Sandbox-verifier node — differential test check, deterministic, no LLM.

Proves the patch genuinely fixes a real bug:
  pass-on-fix    : suite is green at the fix commit
  fail-on-parent : same tests, against PARENT's code, must FAIL
                   (a fake/trivial test would pass here and be rejected)
verified ⇔ pass-on-fix AND fail-on-parent.

`git stash` is the wrong tool here — CC has already committed, so the
working tree is clean and stash is a no-op. Instead we check out the parent
commit and overlay just the fix's test files.
"""
import asyncio
import sys

from sentinel.config import settings
from sentinel.logging import log
from sentinel.subgraph.codepatch.helpers import (
    create_sandbox_env,
    git,
    is_test_file,
)
from sentinel.subgraph.codepatch.state import CodePatchState, PatchVerification


async def run_tests(cwd: str, paths: list[str] | None = None) -> tuple[bool, str]:
    """Run the test suite in `cwd`; return (all_passed, combined_output).

    Unlike `git`, this NEVER raises on a failing test — a failing test is
    normal data for a verifier, not a fault. It returns a verdict.

    pytest runs EVERY test and reports EVERY failure in one invocation — no
    `-x` — so the caller gets the full failure picture to feed back to CC.

    paths: limit the run to specific test files (used for the fail-on-parent
           differential check). None runs the whole discovered suite.
    """
    cmd = [sys.executable, "-m", settings.test_command, "-q", *(paths or [])]
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,  # merge stderr into stdout — one stream
    )
    stdout, _ = await proc.communicate()
    output = stdout.decode(errors="replace").strip()
    return proc.returncode == 0, output


async def sandbox_verifier_node(state: CodePatchState) -> dict[str, object]:
    """Differential verification of the most recent code patch."""
    incident_id = state["incident_id"]
    log.info("sandbox_verifier.run", incident_id=incident_id)

    patch_reports = state.get("patch_reports") or []
    if not patch_reports:
        return {"patch_verifications": [PatchVerification(
            ok=False, description="VERIFICATION ERROR: no patch report to verify."
        )]}

    report = patch_reports[-1]
    if not report.commit_sha:
        return {"patch_verifications": [PatchVerification(
            ok=False,
            description=f"CODE FIX FAILED: no commit was produced. {report.summary}",
        )]}

    cwd = await create_sandbox_env(incident_id)
    sha = report.commit_sha

    try:
        # CC's changed files, split into test files vs everything else.
        changed = (await git(cwd, "show", "--name-only", "--format=", sha)).split()
        changed_tests = [f for f in changed if is_test_file(f)]

        # pass-on-fix — whole suite at the fix commit.
        await git(cwd, "checkout", "--force", sha)
        fix_ok, fix_out = await run_tests(cwd)

        # fail-on-parent — parent's code + fix's tests.
        await git(cwd, "checkout", "--force", f"{sha}^")
        if changed_tests:
            await git(cwd, "checkout", sha, "--", *changed_tests)
        parent_ok, parent_out = await run_tests(cwd)

        # restore the clean, promotable fixed state.
        await git(cwd, "checkout", "--force", sha)
    except Exception as e:
        return {"patch_verifications": [PatchVerification(
            ok=False,
            description=f"VERIFICATION ERROR: differential check could not run: {e}",
        )]}

    verified = fix_ok and not parent_ok
    if verified:
        description = (
            "VERIFIED: the suite is green on the fix and red on the unfixed "
            "code — a test genuinely catches the bug."
        )
    elif not fix_ok:
        description = (
            f"FIX FAILED: the test suite is not green with the patch.\n{fix_out}"
        )
    else:  # fix_ok and parent_ok
        description = (
            "FAKE TEST: the suite passes even against the UNFIXED code — no "
            f"test actually catches the bug.\n{parent_out}"
        )

    log.info("sandbox_verifier.done", incident_id=incident_id, verified=verified)
    return {"patch_verifications": [PatchVerification(ok=verified, description=description)]}
