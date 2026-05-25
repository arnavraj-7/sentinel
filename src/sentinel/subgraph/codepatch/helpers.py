"""Sandbox + git helpers used by the code-patch sub-graph nodes.

Provides:
  create_sandbox_env  — prepare a per-incident sandbox directory under TEMP
  fetch_sync_code     — clone the prod repo into it (or git pull on reuse)
  git                 — run a git command, raising RuntimeError with stderr
  is_test_file        — pytest-style path classifier for the diff gate

create_sandbox_env is defensive against half-finished prior runs: if the
directory exists but is NOT a git repo (a previous attempt was interrupted
before clone completed), it wipes and recreates. The original failure mode
this fixes was: empty sandbox dir + clone failure → empty Exception
message → opaque loop of 5 failed attempts in 20ms.
"""
import asyncio
import os
import shutil
import subprocess
import sys
import tempfile

from sentinel.config import settings
from sentinel.logging import log


_repo_link = settings.github_prod_link


def _sandbox_path(incident_id: str) -> str:
    return os.path.join(tempfile.gettempdir(), f"sentinel-sandbox-{incident_id}")


async def create_sandbox_env(incident_id: str) -> str:
    """Return the per-incident sandbox directory, creating it if needed.

    Reuses an existing well-formed clone (dir + .git) so retries can
    resume CC's prior session. If the dir exists but is missing .git
    (incomplete prior run), wipe and recreate — otherwise `git clone` into
    a non-empty dir will fail.
    """
    cwd = _sandbox_path(incident_id)
    if os.path.isdir(cwd):
        if os.path.isdir(os.path.join(cwd, ".git")):
            # Healthy reuse — leave it for fetch_sync_code's git pull.
            return cwd
        # Corrupted state — wipe so the upcoming `git clone .` has an
        # empty directory to work with.
        log.warning(
            "sandbox.wipe_corrupted",
            incident_id=incident_id,
            cwd=cwd,
            reason="exists without .git",
        )
        # On Windows, files in .git may be marked read-only by git's pack
        # writer; shutil.rmtree's onerror callback handles that.
        shutil.rmtree(cwd, onerror=_force_remove)
    os.makedirs(cwd, exist_ok=True)
    return cwd


def _force_remove(func, path, _exc):
    """rmtree onerror: clear the read-only bit, then retry."""
    try:
        os.chmod(path, 0o700)
        func(path)
    except Exception:
        pass


async def fetch_sync_code(cwd: str) -> None:
    """Clone the prod repo into `cwd` on first use; git pull on reuse.

    Verifies _repo_link is configured. If clone fails (target not empty,
    no such repo, etc.), the RuntimeError from git() carries stderr — no
    more silent failures.
    """
    if not _repo_link:
        raise RuntimeError(
            "SENTINEL_GITHUB_PROD_LINK is not configured — set it to the "
            "path or URL of the prod repo before running the code-patch "
            "sub-graph."
        )

    if os.path.isdir(os.path.join(cwd, ".git")):
        await git(cwd, "pull", "--ff-only")
    else:
        await git(cwd, "clone", _repo_link, ".")


async def git(cwd: str, *args: str) -> str:
    """Run a git command in `cwd` and return its stripped stdout.

    Implemented via `subprocess.run` inside `loop.run_in_executor` rather
    than `asyncio.create_subprocess_exec` because the latter is unsupported
    on WindowsSelectorEventLoopPolicy (raises NotImplementedError with no
    message — the bug that was killing the code-patch sub-graph in a loop
    of 5 failures in 20ms).

    Running sync subprocess in a thread executor works on ANY event loop
    (Selector / Proactor / uvloop / asyncio default). The 5-line cost is
    worth the resilience — we no longer depend on whichever asyncio
    policy uvicorn happened to land on.

    Raises RuntimeError on a non-zero exit with the stderr text so callers
    fail loud rather than silently acting on empty output.
    """
    loop = asyncio.get_running_loop()
    result: subprocess.CompletedProcess[str] = await loop.run_in_executor(
        None,
        lambda: subprocess.run(
            ["git", *args],
            cwd=cwd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        ),
    )
    if result.returncode != 0:
        stderr_text = (result.stderr or "").strip() or "<no stderr>"
        raise RuntimeError(
            f"git {' '.join(args)} failed (exit {result.returncode}) in {cwd}: "
            f"{stderr_text}"
        )
    return (result.stdout or "").strip()


def is_test_file(path: str) -> bool:
    """True if pytest would collect `path` (repo-relative) as a test file."""
    p = path.replace("\\", "/")
    name = p.rsplit("/", 1)[-1]
    if not name.endswith(".py"):
        return False
    return (
        name.startswith("test_")
        or name.endswith("_test.py")
        or p.startswith("tests/")
        or "/tests/" in p
    )


# `sys` is imported by patchverifier.py via this module; re-export
# implicitly by leaving it in the namespace.
_ = sys
