from sentinel.datasource.base import DataSource
import httpx
from sentinel.config import settings
from typing import Any

class LabDataSource(DataSource):
    """Talks to the in-process simulated lab at localhost:8000."""

    async def get_metrics(self, service: str) -> dict[str, Any]:
        async with httpx.AsyncClient(base_url=settings.lab_base_url, timeout=10.0) as client:
            resp = await client.get(f"/lab/services/{service}/metrics")
            return resp.json()

    async def get_logs(self, service: str, count: int = 20) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(base_url=settings.lab_base_url, timeout=10.0) as client:
            resp = await client.get(f"/lab/services/{service}/logs", params={"count": count})
            return resp.json()

    async def heal(self, service: str) -> dict[str, Any]:
        async with httpx.AsyncClient(base_url=settings.lab_base_url, timeout=10.0) as client:
            resp = await client.post(f"/lab/services/{service}/heal")
            return resp.json()