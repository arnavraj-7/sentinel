import asyncio
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

# ── Windows asyncio policy fix (must run BEFORE uvicorn imports asyncio) ────
# uvicorn on Windows defaults to WindowsSelectorEventLoopPolicy, which does
# NOT support asyncio.create_subprocess_exec — every subprocess call raises
# NotImplementedError() with an empty message. The code-patch sub-graph
# needs subprocesses for both `git` (helpers.py) AND the Claude Code SDK
# (which spawns the `claude` CLI under the hood). Force the Proactor policy
# so subprocess.exec works.
#
# Diagnostic: the symptom was 5 patch attempts firing in ~20ms, each
# producing "Code fix could not be produced (NotImplementedError: (no
# message))." The empty message is asyncio's default when raising
# NotImplementedError from the event loop's missing subprocess support.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from dotenv import load_dotenv  # noqa: E402

# Load .env into os.environ BEFORE importing anything that reads env vars
# (notably the langsmith SDK, which checks LANGSMITH_* on import).
# pydantic-settings only reads fields declared on our Settings class —
# it does NOT leak other keys like LANGSMITH_API_KEY into os.environ,
# so we need python-dotenv to do that for us.
load_dotenv()

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from sentinel.agents.graph import build_graph  # noqa: E402
from sentinel.api.health import router as health_router  # noqa: E402
from sentinel.api.incidents import router as incidents_router  # noqa: E402
from sentinel.api.scenarios import router as scenarios_router  # noqa: E402
from sentinel.checkpoint.sqlite import open_checkpointer  # noqa: E402
from sentinel.config import settings  # noqa: E402
from sentinel.lab.routes import router as lab_router  # noqa: E402
from sentinel.logging import configure_logging, log  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    log.info("sentinel.startup", env=settings.env, checkpoint_db=str(settings.checkpoint_db))
    async with open_checkpointer(settings.checkpoint_db) as checkpointer:
        app.state.graph = build_graph(checkpointer)
        log.info("sentinel.ready")
        yield
    log.info("sentinel.shutdown")


app = FastAPI(title="Sentinel", version="0.1.0", lifespan=lifespan)

# CORS for the frontend (Next.js dev on :3000 / :3001). Permissive in dev;
# tighten in prod (allow_origins=["https://sentinel.<your-domain>"]).
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(incidents_router)
app.include_router(lab_router)
app.include_router(scenarios_router)
