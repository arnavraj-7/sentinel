from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class FailureMode(StrEnum):
    HEALTHY = "healthy"
    MEMORY_LEAK = "memory_leak"
    CRASH_LOOP = "crash_loop"
    LATENCY_SPIKE = "latency_spike"
    SURGE_5xx = "surge_5xx"
    DB_POOL_EXHAUSTION = "db_pool_exhaustion"
    CERT_EXPIRY = "cert_expiry"
    
class ServiceState(BaseModel):
    name: str
    failure_mode: FailureMode = FailureMode.HEALTHY
    injected_at: datetime |  None = Field(default=None)
    
    
class MetricsSnapshot(BaseModel):
    service: str
    failure_mode: FailureMode
    cpu_pct: float 
    memory_mb: float 
    latency_p95_ms: float 
    error_rate_pct: float
    uptime_seconds: int
    
class LogLine(BaseModel):
    ts: datetime
    level: str
    service: str
    message: str
