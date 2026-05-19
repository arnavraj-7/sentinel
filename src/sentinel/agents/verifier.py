from datetime import datetime

from sentinel.agents.state import AgentNote, IncidentState, VerificationResult
from sentinel.config import settings
from sentinel.datasource import get_datasource


def _metrics_ok(m: dict) -> tuple[bool, str]:
    fails = []
    if m["error_rate_pct"] > settings.max_healthy_error_rate_pct:
        fails.append(f"error_rate {m['error_rate_pct']}% > {settings.max_healthy_error_rate_pct}%")
    if m["latency_p95_ms"] > settings.max_healthy_latency_ms:
        fails.append(f"latency {m['latency_p95_ms']}ms > {settings.max_healthy_latency_ms}ms")
    if m["uptime_seconds"] < settings.min_healthy_uptime_s:
        fails.append(
            f"uptime {m['uptime_seconds']}s < {settings.min_healthy_uptime_s}s (still restarting?)"
        )
    if m["cpu_pct"] > settings.max_healthy_cpu_pct:
        fails.append(f"cpu {m['cpu_pct']}% > {settings.max_healthy_cpu_pct}%")
    if m["memory_mb"] > settings.max_healthy_memory_mb:
        fails.append(f"memory {m['memory_mb']}MB > {settings.max_healthy_memory_mb}MB")
    return (not fails, "; ".join(fails) if fails else "metrics within healthy range")


async def verifier_node(state: IncidentState) -> dict[str, object]:
    """Pure deterministic recovery gate: health → metrics → post-fix error logs.
    Layered short-circuit (cheapest first). No LLM — the planner does any
    judgment on replan, reading this verdict."""
    ds = get_datasource()
    service = state["input"].service
    applied_at = state.get("remediation_applied_at")

    def _result(verified: bool, verdict: str) -> dict[str, object]:
        return {
            "verification": VerificationResult(verified=verified, verdict=verdict),
            "notes": [AgentNote(agent="verifier", content=f"[{'OK' if verified else 'FAIL'}] {verdict}")],
        }

    # 1. health (cheapest, binary) — short-circuit
    health = await ds.get_health(service)
    if not health["healthy"]:
        return _result(False, f"health check failed: {health['detail']}")

    # 2. metrics vs thresholds — short-circuit
    metrics = await ds.get_metrics(service=service)
    ok, reason = _metrics_ok(metrics)
    if not ok:
        return _result(False, f"metrics not recovered: {reason}")

    # 3. error logs AFTER the fix was applied (stale pre-fix errors filtered
    #    out by the timestamp window — deterministic, no LLM needed)
    errors = await ds.get_error_traces(service=service)
    if applied_at is not None:
        fresh = [e for e in errors if datetime.fromisoformat(e["ts"]) > applied_at]
    else:
        fresh = errors
    if fresh:
        return _result(
            False,
            f"{len(fresh)} ERROR log(s) after remediation, e.g.: {fresh[0]['message']}",
        )

    return _result(True, "recovered: health OK, metrics within range, no post-fix errors")

def after_verify_routing(state: IncidentState) -> str:
    v = state.get("verification")
    if v is None:
        # No verification (shouldn't happen post-verifier) — end safely
        # rather than risk an infinite replan loop.
        return "finalize"
    return "finalize" if v.verified else "planner"