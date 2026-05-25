"""Sentinel API launcher — forces a Proactor event loop on Windows.

Why this exists:
  uvicorn's default Windows asyncio setup calls
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
  which does NOT support asyncio.create_subprocess_exec. The code-patch
  sub-graph needs subprocesses for both `git` (helpers.py) AND the
  Claude Code SDK (which spawns the `claude` CLI). Every subprocess call
  raises NotImplementedError() with an empty message — and the symptom
  is 5 patch attempts that fail in ~20ms instead of taking minutes.

  Setting the policy in sentinel/main.py doesn't help because uvicorn's
  own asyncio_setup runs LATER and overrides whatever we set there.

Fix:
  This launcher monkey-patches uvicorn.loops.asyncio.asyncio_setup to a
  no-op BEFORE calling uvicorn.run(). Then sets the Proactor policy
  ourselves. Net effect: uvicorn doesn't fight us, asyncio subprocesses
  work, CC and git both run.

Run with:
  .venv\\Scripts\\python.exe run_server.py
"""
import asyncio
import os
import sys


def _force_proactor_on_windows() -> None:
    if sys.platform != "win32":
        return
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    # Defang uvicorn's own switch back to Selector. The setup function is
    # looked up at call time (Server.run → asyncio_setup) so a runtime
    # rebind takes effect.
    import uvicorn.loops.asyncio as _ua
    _ua.asyncio_setup = lambda: None


def main() -> None:
    _force_proactor_on_windows()

    # Sensible defaults for local dev — override with env vars if needed.
    os.environ.setdefault("SENTINEL_GITHUB_PROD_LINK", "D:/projects/codefix-testrepo")
    os.environ.setdefault("SENTINEL_DATASOURCE", "lab")

    import uvicorn
    uvicorn.run(
        "sentinel.main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        log_level="info",
    )


if __name__ == "__main__":
    main()
