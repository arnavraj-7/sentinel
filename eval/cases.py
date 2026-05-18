"""Labeled eval fixtures — known incidents with their correct answers.

Ground truth only exists against the lab (we inject the failure, so we know
the right category and root-cause signature). One case per injectable lab
FailureMode = full coverage of the classification space.

inject_mode is typed as the lab `FailureMode` enum so a bad fixture fails at
import, not mid-run. Keywords are lowercase substrings; the scorer lowercases
the model's root_cause before checking.
"""

from pydantic import BaseModel

from sentinel.agents.state import FailureCategory
from sentinel.lab.models import FailureMode


class EvalCase(BaseModel):
    name: str
    service: str
    inject_mode: FailureMode
    expected_category: FailureCategory
    expected_root_cause_keywords: list[str]  # all must appear in root_cause (lowercased)


EVAL_CASES: list[EvalCase] = [
    EvalCase(
        name="api-gateway crash loop (panic/nil-pointer)",
        service="api-gateway",
        inject_mode=FailureMode.CRASH_LOOP,
        expected_category=FailureCategory.CRASH_LOOP,
        expected_root_cause_keywords=["crash"],
    ),
    EvalCase(
        name="payment-service memory leak (heap/OOM)",
        service="payment-service",
        inject_mode=FailureMode.MEMORY_LEAK,
        expected_category=FailureCategory.MEMORY_LEAK,
        expected_root_cause_keywords=["memory"],
    ),
    EvalCase(
        name="auth-service latency spike (slow upstream/timeouts)",
        service="auth-service",
        inject_mode=FailureMode.LATENCY_SPIKE,
        expected_category=FailureCategory.LATENCY_SPIKE,
        expected_root_cause_keywords=["latency"],
    ),
    EvalCase(
        name="payment-service 5xx surge (handler errors/circuit breaker)",
        service="payment-service",
        inject_mode=FailureMode.SURGE_5xx,
        expected_category=FailureCategory.SURGE_5xx,
        expected_root_cause_keywords=["error"],
    ),
    EvalCase(
        name="db-proxy connection pool exhaustion",
        service="db-proxy",
        inject_mode=FailureMode.DB_POOL_EXHAUSTION,
        expected_category=FailureCategory.DB_POOL_EXHAUSTION,
        expected_root_cause_keywords=["connection"],
    ),
    EvalCase(
        name="cert-manager TLS certificate expiry",
        service="cert-manager",
        inject_mode=FailureMode.CERT_EXPIRY,
        expected_category=FailureCategory.CERT_EXPIRY,
        expected_root_cause_keywords=["certificate"],
    ),
]
