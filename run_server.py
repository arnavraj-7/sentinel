"""Sentinel API launcher — runs uvicorn programmatically so we can
control the asyncio event-loop policy on Windows.

Why this exists (and why the previous attempt didn't actually fix it):

  uvicorn.run() on Windows calls Config.setup_event_loop() which sets
  WindowsSelectorEventLoopPolicy. That policy doesn't support
  asyncio.create_subprocess_exec — every subprocess raises
  NotImplementedError() with an empty message. Both `git` (helpers.py)
  AND the Claude Code SDK (spawns the `claude` CLI) need subprocesses.

  Setting Proactor in sentinel/main.py was too late: the event loop is
  already running by the time main.py is imported.

  Setting it in run_server.py + monkey-patching uvicorn's asyncio_setup
  worked for the parent process — but `uvicorn.run(reload=True)` spawns
  a CHILD process that re-imports uvicorn fresh and re-runs the
  Selector setup. The child never saw our patches → still broken.

  This launcher's fix is structural: instead of `uvicorn.run()`, we
  build the `Server` directly and call `server.serve()` from inside
  our own `asyncio.run()`. That path never invokes
  Config.setup_event_loop, so our policy (set before asyncio.run)
  survives. Trade-off: no --reload on Windows. Edit code, Ctrl-C,
  re-run this script.

  On Linux/Mac the default policy supports subprocesses, so we just
  use uvicorn.run(reload=True) the normal way.

Run with:
  .venv\\Scripts\\python.exe run_server.py
"""
import asyncio
import os
import sys


def main() -> None:
    # Sensible defaults for local dev — override with env vars if needed.
    os.environ.setdefault("SENTINEL_GITHUB_PROD_LINK", "D:/projects/codefix-testrepo")
    os.environ.setdefault("SENTINEL_DATASOURCE", "lab")

    if sys.platform == "win32":
        _run_windows()
    else:
        _run_unix()


def _run_windows() -> None:
    """Programmatic uvicorn run that bypasses setup_event_loop entirely.

    Server.run() = setup_event_loop + asyncio.run(serve())
    Server.serve() alone = no loop setup. We do asyncio.run ourselves,
    and the policy we set right before is the policy that sticks.
    """
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

    import uvicorn

    config = uvicorn.Config(
        "sentinel.main:app",
        host="127.0.0.1",
        port=8000,
        log_level="info",
        # NOTE: NO reload= here. uvicorn's reload supervisor forks a child
        # process that re-runs Config.setup_event_loop on Windows (sets
        # Selector), which breaks our subprocess support. Manual restart
        # is fine for a demo.
    )
    server = uvicorn.Server(config)

    async def main_async() -> None:
        await server.serve()

    asyncio.run(main_async())


def _run_unix() -> None:
    """Standard uvicorn behaviour on Linux/Mac — --reload is safe here."""
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
