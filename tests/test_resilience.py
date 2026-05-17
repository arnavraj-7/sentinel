"""Phase 9 resilience proof — simulate failures, assert structured_invoke recovers.

No real Gemini calls: _PRIMARY/_FALLBACK are monkeypatched with fakes whose
.ainvoke is driven by a scripted side_effect.
"""

from unittest.mock import AsyncMock, MagicMock

from google.api_core import exceptions as gexc
from langchain_core.exceptions import OutputParserException
from pydantic import BaseModel

from sentinel.agents import llm


class _Demo(BaseModel):
    ok: bool


def _fake_structured(side_effect: object) -> MagicMock:
    """Stand-in for llm.with_structured_output(schema): an object whose
    .ainvoke is an async mock driven by side_effect."""
    fake = MagicMock()
    fake.ainvoke = AsyncMock(side_effect=side_effect)
    return fake


async def test_schema_repair_recovers(monkeypatch) -> None:
    """Model returns bad output once, valid output on retry → caller still gets it."""
    good = _Demo(ok=True)
    primary = MagicMock()
    primary.with_structured_output.return_value = _fake_structured(
        [OutputParserException("bad json"), good]
    )
    monkeypatch.setattr(llm, "_PRIMARY", primary)
    monkeypatch.setattr(llm, "_BASE_BACKOFF_S", 0.0)

    assert await llm.structured_invoke(_Demo, "prompt") == good


async def test_transient_retry_recovers(monkeypatch) -> None:
    """A 429 once, success on retry → caller still gets it."""
    good = _Demo(ok=True)
    primary = MagicMock()
    primary.with_structured_output.return_value = _fake_structured(
        [gexc.ResourceExhausted("429"), good]
    )
    monkeypatch.setattr(llm, "_PRIMARY", primary)
    monkeypatch.setattr(llm, "_BASE_BACKOFF_S", 0.0)

    assert await llm.structured_invoke(_Demo, "prompt") == good


async def test_falls_back_when_primary_dead(monkeypatch) -> None:
    """Primary fails every attempt → fallback model is used and succeeds."""
    good = _Demo(ok=True)
    primary = MagicMock()
    primary.with_structured_output.return_value = _fake_structured(
        gexc.ResourceExhausted("429")  # bare exception → raises EVERY call
    )
    fallback = MagicMock()
    fallback.with_structured_output.return_value = _fake_structured([good])
    monkeypatch.setattr(llm, "_PRIMARY", primary)
    monkeypatch.setattr(llm, "_FALLBACK", fallback)
    monkeypatch.setattr(llm, "_BASE_BACKOFF_S", 0.0)

    assert await llm.structured_invoke(_Demo, "prompt") == good
    fallback.with_structured_output.assert_called_once()
