"""Standalone smoke test — verify the Claude Code SDK works in isolation
on Windows with the Proactor event loop. Sidesteps uvicorn + LangGraph
entirely; useful for narrowing whether a 'NotImplementedError (no message)'
in the demo is a CC issue or a graph-context issue.

Run:
  .venv\\Scripts\\python.exe tests\\_check_cc_smoke.py

Expected on success: CC streams a few messages, prints the final result
text. Total time ~30-90 seconds for a trivial prompt.

Expected on failure (Selector loop / subprocess broken):
  NotImplementedError immediately. If you see that, the asyncio policy
  is wrong — use run_server.py instead of `uvicorn` directly.
"""
import asyncio
import sys


def _force_proactor() -> None:
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())


async def main() -> None:
    from claude_agent_sdk import (
        ClaudeAgentOptions,
        ResultMessage,
        AssistantMessage,
        query,
    )

    print(f"event loop policy: {type(asyncio.get_event_loop_policy()).__name__}")
    print(f"running loop:      {type(asyncio.get_running_loop()).__name__}")
    print()

    options = ClaudeAgentOptions(
        system_prompt="You are a terse assistant. Reply with one sentence.",
        max_budget_usd=0.10,
    )

    print("Sending prompt to Claude Code SDK...")
    last_text = None
    async for message in query(
        prompt="In one sentence, what is the cube root of 64?",
        options=options,
    ):
        kind = type(message).__name__
        if isinstance(message, AssistantMessage):
            for block in (message.content or []):
                btype = type(block).__name__
                text = getattr(block, "text", None)
                if text:
                    last_text = text
                    print(f"  [{kind}/{btype}] {text[:200]}")
                else:
                    tool = getattr(block, "name", None)
                    if tool:
                        print(f"  [{kind}/{btype}] tool={tool}")
        elif isinstance(message, ResultMessage):
            print(f"  [{kind}] is_error={message.is_error} subtype={message.subtype}")
            if message.result:
                print(f"             result={message.result[:200]}")
                last_text = message.result

    print()
    if last_text:
        print(f"OK — CC SDK works. Final text: {last_text[:200]}")
    else:
        print("UNEXPECTED — no text received from CC SDK.")


if __name__ == "__main__":
    _force_proactor()
    asyncio.run(main())
