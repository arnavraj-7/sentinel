"""Shared helpers for the SSE streaming endpoints.

The graph emits state deltas (`stream_mode="updates"`) AND custom progress
events (`stream_mode="custom"`, fed by `get_stream_writer()` inside nodes).
The SSE wrapper serialises both into a uniform event stream the frontend
consumes, then emits one of two terminal events:

  paused  — graph hit an interrupt(); payload carries the HITL prompt
  done    — graph reached END; payload carries outcome + post_mortem

Serialisation: state deltas contain pydantic BaseModels, Enums, and
datetimes that `json.dumps` can't handle by default. `_jsonable` walks
the chunk recursively and converts each known type — keeping the wire
format frontend-friendly without changing the in-graph types.
"""
from __future__ import annotations

import json
from collections.abc import AsyncIterator
from datetime import datetime, date
from enum import Enum
from typing import Any

from langgraph.graph.state import CompiledStateGraph
from pydantic import BaseModel


def _jsonable(value: Any) -> Any:
    """Recursively convert pydantic models / enums / datetimes to JSON-safe.

    Keeps the original tree shape; only leaf transformations. Anything we
    don't recognise gets stringified — defensive default so a new field
    type added to state never explodes the stream.
    """
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(v) for v in value]
    return str(value)


def _sse_event(event: str, data: Any) -> dict[str, str]:
    """Format an SSE event for `sse_starlette.EventSourceResponse`.

    EventSourceResponse takes dicts with `event` and `data` keys; the
    `data` field must already be a string (it's not re-encoded for us).
    """
    return {"event": event, "data": json.dumps(_jsonable(data), ensure_ascii=False)}


async def stream_graph_events(
    graph: CompiledStateGraph,
    inputs: Any,
    config: dict[str, Any],
) -> AsyncIterator[dict[str, str]]:
    """Stream a graph invocation as SSE events.

    Yields:
      - `update` events: one per node completion (state delta)
      - `custom` events: writer payloads emitted via get_stream_writer()
      - exactly one terminal event:
          `paused` if the graph stopped at an interrupt()
          `done`   if the graph reached END
          `error`  if astream raised

    The astream `stream_mode=["updates","custom"]` form yields tuples
    `(mode, chunk)` — careful: with a SINGLE mode it would yield raw
    chunks instead, so don't collapse to one mode without re-shaping.
    """
    try:
        # subgraphs=True is essential — without it, custom writer events
        # and update events from inside the code-patch sub-graph
        # (code_fixer, sandbox_verifier) are invisible to the parent's
        # stream consumer, so the UI shows nothing during the 2-minute CC
        # run. With subgraphs=True the yield shape becomes
        # (namespace, mode, chunk) — namespace is () for root graph and
        # (node_name:id,) for sub-graph events. We forward the chunk as
        # the same SSE event type either way.
        async for namespace, mode, chunk in graph.astream(
            inputs,
            config=config,
            stream_mode=["updates", "custom"],
            subgraphs=True,
        ):
            _ = namespace  # not surfaced to the client today
            yield _sse_event(mode, chunk)
    except Exception as exc:  # noqa: BLE001 - surface any failure to the client
        yield _sse_event("error", {"message": str(exc), "type": type(exc).__name__})
        return

    # astream exited naturally — either we hit an interrupt() or reached END.
    snapshot = await graph.aget_state(config)
    pending = next(
        (intr.value for task in snapshot.tasks for intr in task.interrupts),
        None,
    )
    if pending is not None:
        yield _sse_event("paused", pending)
        return

    yield _sse_event("done", {
        "outcome": snapshot.values.get("outcome"),
        "post_mortem": snapshot.values.get("post_mortem"),
        "code_patch_result": snapshot.values.get("code_patch_result"),
        "executor_result": snapshot.values.get("executor_result"),
        "verification": snapshot.values.get("verification"),
    })
