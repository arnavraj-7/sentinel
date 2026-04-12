from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from sentinel.agents.graph import build_graph
from sentinel.api.health import router as health_router
from sentinel.api.incidents import router as incidents_router
from sentinel.checkpoint.sqlite import open_checkpointer
from sentinel.config import settings
from sentinel.logging import configure_logging, log


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
app.include_router(health_router)
app.include_router(incidents_router)
