import asyncio
from typing import TypeVar

from google.api_core import exceptions as gexc
from langchain_core.exceptions import OutputParserException
from langchain_core.messages import BaseMessage, HumanMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from pydantic import BaseModel, ValidationError

from sentinel.config import settings
from sentinel.logging import log

_T = TypeVar("_T", bound=BaseModel)
_TIMEOUT_S = 60
_MAX_ATTEMPTS = 3
_BASE_BACKOFF_S = 1.0
_RETRYABLE = (
    asyncio.TimeoutError,
    gexc.ResourceExhausted,     # 429 rate limit
    gexc.ServiceUnavailable,    # 503
    gexc.InternalServerError,   # 500
    gexc.DeadlineExceeded,      # google-side timeout
)

_PRIMARY = ChatGoogleGenerativeAI(
    model="gemini-2.5-flash", project=settings.google_project, temperature=0,
)
_FALLBACK = ChatGoogleGenerativeAI(
    model="gemini-2.0-flash", project=settings.google_project, temperature=0,
)

def _append_repair(
    messages: list[BaseMessage] | str,
    error: Exception,
) -> list[BaseMessage]:
    base: list[BaseMessage] = (
        [HumanMessage(content=messages)] if isinstance(messages, str) else list(messages)
    )
    base.append(HumanMessage(content=(
        f"Your previous response failed schema validation:\n{error}\n"
        f"Return a corrected response that EXACTLY matches the required schema."
    )))
    return base


async def _invoke_with_retry(
    llm: ChatGoogleGenerativeAI,
    schema: type[_T],
    messages: list[BaseMessage] | str,
) -> _T:
    structured = llm.with_structured_output(schema)
    for attempt in range(_MAX_ATTEMPTS):
        try:
            return await asyncio.wait_for(
                structured.ainvoke(messages),
                timeout=_TIMEOUT_S,
            )
        except _RETRYABLE:
            if attempt == _MAX_ATTEMPTS - 1:
                raise
            await asyncio.sleep(_BASE_BACKOFF_S * (2 ** attempt))
        except (ValidationError, OutputParserException) as e:
            if attempt == _MAX_ATTEMPTS - 1:
                raise
            messages = _append_repair(messages, e)
    raise RuntimeError("unreachable")


async def structured_invoke(
    schema: type[_T],
    messages: list[BaseMessage] | str,
) -> _T:
    """Retry+repair on primary, then fall back to backup model."""
    try:
        return await _invoke_with_retry(_PRIMARY, schema, messages)
    except Exception as e:
        log.warning("llm.primary_exhausted_falling_back", error=str(e))
        return await _invoke_with_retry(_FALLBACK, schema, messages)