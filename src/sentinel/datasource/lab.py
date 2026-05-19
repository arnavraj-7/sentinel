import re
from typing import Any

import httpx

from sentinel.config import settings
from sentinel.datasource.base import DataSource


class LabDataSource(DataSource):
    """Talks to the in-process simulated lab at localhost:8000."""
    async def get_health(self, service: str) -> dict[str, Any]:
        # Normalize on STATUS CODE so the verifier's check is identical
        # regardless of datasource (the whole point of the abstraction).
        async with httpx.AsyncClient(base_url=settings.lab_base_url, timeout=10.0) as client:
            resp = await client.get(f"/lab/services/{service}/health")
        return {"healthy": resp.status_code < 500, "detail": f"HTTP {resp.status_code}"}
    async def get_metrics(self, service: str) -> dict[str, Any]:
        async with httpx.AsyncClient(base_url=settings.lab_base_url, timeout=10.0) as client:
            resp = await client.get(f"/lab/services/{service}/metrics")
            return resp.json()

    async def get_logs(self, service: str, count: int = 20) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(base_url=settings.lab_base_url, timeout=10.0) as client:
            resp = await client.get(f"/lab/services/{service}/logs", params={"count": count})
            return resp.json()
    async def get_error_traces(self, service: str, count: int = 5) -> list[dict[str, Any]]:
        resp = await self.get_logs(service,count*5)
        errors = [e for e in resp if e["level"] == "ERROR"]
        return errors[:count]

    async def search_logs_regex(
        self, service: str, regex: str, count: int = 20
    ) -> list[dict[str, Any]]:
        resp = await self.get_logs(service, count * 5)  # fetch more to filter down
        matches = [e for e in resp if re.search(regex, e["message"])]
        return matches[:count]

    async def heal(self, service: str) -> dict[str, Any]:
        async with httpx.AsyncClient(base_url=settings.lab_base_url, timeout=10.0) as client:
            resp = await client.post(f"/lab/services/{service}/heal")
            return resp.json()