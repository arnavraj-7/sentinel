from abc import ABC, abstractmethod
from typing import Any


class DataSource(ABC):
    """Contract for fetching incident signals. Investigators depend on THIS,
    not on the lab"""
    
    @abstractmethod
    async def get_metrics(self, service: str) -> dict[str, Any]:
        """Returns {cpu_pct, memory_mb, latency_p95_ms, error_rate_pct, uptime_seconds}."""
        ...

    @abstractmethod
    async def get_logs(self, service: str, count: int = 20) -> list[dict[str, Any]]:
        """Returns newest-first list of {ts, level, message}."""
        ...
    @abstractmethod
    async def get_error_traces(self,service:str,count:int=5)->list[dict[str,Any]]:
        """Returns newest-error traces {ts, level, message}."""
        ...
    @abstractmethod
    async def search_logs_regex(self,service:str,regex:str,count:int=20)->list[dict[str,Any]]:
        """Returns newest-first list of log entries matching the regex."""
        ...
    @abstractmethod
    async def heal(self, service: str) -> dict[str, Any]:
        """Resets the service to healthy. Returns {failure_mode}."""
        ...