import os
import sys
import asyncio
import tempfile
from datetime import datetime
from sentinel.config import settings 


_repo_link = settings.github_prod_link

async def create_sandbox_env(incident_id:str)->str:
    cwd = os.path.join(tempfile.gettempdir(), f"sentinel-sandbox-{incident_id}")
    #runs cmd to spin up docker contain and returns the directory of it for agent to run
    if not os.path.isdir(cwd):
          os.makedirs(cwd)
          # fresh — clone happens in fetch_sync_code
      # else: reuse — the sandbox + the session file are both already here
    return cwd

    
async def fetch_sync_code(cwd):
    #runs github cmd to clone repo or pull prod code if repo already exists
    #the url of github will be in the env as sentinel will be running on a prod env right so obv it will be an env variable as it is sensitive and depends on which service is sentinel working on
    if os.path.isdir(os.path.join(cwd, ".git")):
          await git(cwd, "pull")                    # already cloned → sync
    else:
          await git(cwd, "clone", _repo_link, ".")  # fresh


async def git(cwd: str, *args: str) -> str:
    """Run a git command in `cwd` and return its stripped stdout.

    Raises RuntimeError on a non-zero exit so callers fail loud rather than
    silently acting on empty output (e.g. treating a failed `rev-parse` as
    an empty commit SHA).

    Usage:
        sha   = await _git(cwd, "rev-parse", "HEAD")
        files = (await _git(cwd, "show", "--name-only", "--format=", "HEAD")).split()
    """
    proc = await asyncio.create_subprocess_exec(
        "git", *args,
        cwd=cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(
            f"git {' '.join(args)} failed (exit {proc.returncode}): "
            f"{stderr.decode(errors='replace').strip()}"
        )
    return stdout.decode(errors="replace").strip()



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
