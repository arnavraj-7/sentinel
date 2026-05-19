import asyncio
from typing import Any

import httpx
from google.cloud import logging as gcloud_logging

from sentinel.config import settings
from sentinel.datasource.base import DataSource
from sentinel.datasource.registry import get_service_url


class GCPDataSource(DataSource):
    """Implemnents Data from GCP directly using google-cloud libraries"""
    def __init__(self) -> None:
        self._log_client = gcloud_logging.Client(project=settings.google_project)

    async def get_health(self, service: str) -> dict[str, Any]:
        # Real services return an EMPTY-body 200/500 — read the STATUS CODE,
        # never .json() (an empty 200 body would crash json parsing).
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{get_service_url(service)}/health")
        return {"healthy": resp.status_code < 500, "detail": f"HTTP {resp.status_code}"}

    def _run_query_logs(self, service: str,filter_str: str,count: int) -> list[dict[str, Any]]:
      entries = self._log_client.list_entries(
          filter_=('resource.type="cloud_run_revision" '
          f'resource.labels.service_name="{service}" ' +filter_str),
          order_by=gcloud_logging.DESCENDING,
          max_results=count,
      )
      out: list[dict[str, Any]] = []
      for entry in entries:
          payload = entry.payload
          if isinstance(payload, dict):
              out.append({
                  "ts": payload.get("ts", entry.timestamp.isoformat()),
                  "level": payload.get("level", entry.severity or "INFO"),
                  "message": payload.get("message", ""),
              })
          else:
              out.append({
                  "ts": entry.timestamp.isoformat(),
                  "level": entry.severity or "INFO",
                  "message": str(payload),
              })
      return out
    
    async def get_error_traces(self, service: str, count: int = 5) -> list[dict[str, Any]]:
        filter_str = 'jsonPayload.level="ERROR"'
        return await asyncio.to_thread(self._run_query_logs, service, filter_str, count)

    async def search_logs_regex(
        self, service: str, regex: str, count: int = 20
    ) -> list[dict[str, Any]]:
        filter_str = f'jsonPayload.message=~"{regex}"'
        return await asyncio.to_thread(self._run_query_logs, service, filter_str, count)
    async def get_metrics(self,service:str)-> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{get_service_url(service)}/metrics")
            return response.json()
    
    async def get_logs(self, service: str, count: int = 20) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self._run_query_logs, service, '', count)
    async def heal(self, service: str) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{get_service_url(service)}/heal")
            return response.json()
            