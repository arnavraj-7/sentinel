import random
from datetime import UTC, datetime, timedelta

from sentinel.lab.models import FailureMode, LogLine, MetricsSnapshot

# Base metric values per failure mode.
# Each call adds ±10% jitter so numbers look live, not static.
_BASE: dict[FailureMode, dict[str, float]] = {
    FailureMode.HEALTHY:            dict(cpu=15,  mem=280,  lat=45,   err=0.05, up=86400),
    FailureMode.MEMORY_LEAK:        dict(cpu=45,  mem=1100, lat=120,  err=1.2,  up=7200),
    FailureMode.CRASH_LOOP:         dict(cpu=5,   mem=80,   lat=0,    err=100,  up=12),
    FailureMode.LATENCY_SPIKE:      dict(cpu=35,  mem=310,  lat=5500, err=8,    up=86400),
    FailureMode.SURGE_5xx:          dict(cpu=88,  mem=620,  lat=900,  err=52,   up=86400),
    FailureMode.DB_POOL_EXHAUSTION: dict(cpu=25,  mem=290,  lat=8000, err=35,   up=86400),
    FailureMode.CERT_EXPIRY:        dict(cpu=14,  mem=275,  lat=42,   err=0.04, up=86400),
}

_LOGS: dict[FailureMode, list[tuple[str, str]]] = {
    FailureMode.HEALTHY: [
        ("INFO",  "request handled in 43ms"),
        ("INFO",  "health check passed"),
        ("INFO",  "cache hit ratio 0.94"),
        ("INFO",  "db connection pool: 4/32 in use"),
    ],
    FailureMode.MEMORY_LEAK: [
        ("WARN",  "heap usage 87% — GC pressure increasing"),
        ("WARN",  "old-gen collection taking >500ms"),
        ("ERROR", "allocation failure — OOM imminent"),
        ("WARN",  "RSS growing 12MB/min — possible leak"),
    ],
    FailureMode.CRASH_LOOP: [
        ("ERROR", "panic: nil pointer dereference at runtime"),
        ("ERROR", "process exited with code 1 — restarting"),
        ("WARN",  "back-off 2s restarting failed container"),
        ("ERROR", "liveness probe failed: connection refused"),
    ],
    FailureMode.LATENCY_SPIKE: [
        ("WARN",  "upstream response 5.4s — threshold 500ms"),
        ("WARN",  "request queue depth 847"),
        ("ERROR", "request timeout after 10s"),
        ("WARN",  "p99 latency 8.1s — SLO breach"),
    ],
    FailureMode.SURGE_5xx: [
        ("ERROR", "internal server error: unexpected nil in handler"),
        ("ERROR", "panic recovered: index out of range [4] len 3"),
        ("WARN",  "error rate 52% — circuit breaker threshold 40%"),
        ("ERROR", "downstream dependency returning 503"),
    ],
    FailureMode.DB_POOL_EXHAUSTION: [
        ("WARN",  "connection pool exhausted (32/32 in use)"),
        ("ERROR", "timeout waiting for db connection after 30s"),
        ("WARN",  "query queue depth 1204 — shedding load"),
        ("ERROR", "deadlock detected — rolling back transaction"),
    ],
    FailureMode.CERT_EXPIRY: [
        ("WARN",  "TLS certificate expires in 18h 23m"),
        ("WARN",  "ACME renewal attempt failed: challenge timeout"),
        ("ERROR", "cert validity window < 24h — renewal required"),
        ("WARN",  "clients may see certificate warnings soon"),
    ],
}


# ── Phase 13b — poisoned-log test affordance ────────────────────────────────
# In-memory store: per-service list of (level, message) lines that get prepended
# to generated logs. ONLY used to test that prompt-injection defenses hold;
# never populated in normal operation. Cleared via clear_poison() or by service
# heal (separately).
_POISONED_LINES: dict[str, list[tuple[str, str]]] = {}


def set_poison(service: str, level: str, message: str) -> None:
    """Push a poisoned log line for `service`. Stays until clear_poison()."""
    _POISONED_LINES.setdefault(service, []).append((level, message))


def clear_poison(service: str) -> None:
    """Drop all poisoned lines for `service` (call after each test)."""
    _POISONED_LINES.pop(service, None)


def _jitter(value: float, pct: float = 0.10) -> float:
    return round(value * (1 + random.uniform(-pct, pct)), 2)


def generate_metrics(service: str, mode: FailureMode) -> MetricsSnapshot:
    b = _BASE[mode]
    return MetricsSnapshot(
        service=service,
        failure_mode=mode,
        cpu_pct=_jitter(b["cpu"]),
        memory_mb=_jitter(b["mem"]),
        latency_p95_ms=_jitter(b["lat"]),
        error_rate_pct=_jitter(b["err"]),
        uptime_seconds=int(_jitter(b["up"], pct=0.01)),
    )


def generate_logs(service: str, mode: FailureMode, count: int = 8) -> list[LogLine]:
    templates = _LOGS[mode]
    now = datetime.now(UTC)
    synthetic = [
        LogLine(
            ts=now - timedelta(seconds=(i + 1) * 10),
            level=lvl,
            service=service,
            message=msg,
        )
        for i, (lvl, msg) in enumerate(
            random.choices(templates, k=count)
        )
    ]
    # Prepend any poisoned lines as the most-recent entries. Newest-first ordering
    # is what investigators consume, so attacker text shows up at the TOP of the
    # log feed — the most-prominent position. If defenses don't hold here, they
    # don't hold anywhere.
    poisoned = [
        LogLine(ts=now, level=lvl, service=service, message=msg)
        for (lvl, msg) in _POISONED_LINES.get(service, [])
    ]
    return poisoned + synthetic
