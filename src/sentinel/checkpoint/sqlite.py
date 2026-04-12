from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver


@asynccontextmanager
async def open_checkpointer(db_path: Path) -> AsyncIterator[AsyncSqliteSaver]:
    """Open an AsyncSqliteSaver, creating the parent directory if needed.

    Usage:
        async with open_checkpointer(Path("./data/checkpoints.sqlite")) as cp:
            graph = build_graph(cp)
            await graph.ainvoke(...)
    """
    db_path.parent.mkdir(parents=True, exist_ok=True)
    async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
        yield saver
