import pytest
from httpx import AsyncClient


async def test_health_returns_ok(client: AsyncClient) -> None:
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.integration
async def test_incident_endpoint_runs_graph(client: AsyncClient) -> None:
    """Requires: lab server running on localhost:8000 and valid GCP credentials."""
    payload = {
        "alert_id": "a-http-1",
        "service": "api-gateway",
        "message": "latency p95 > 2s",
        "severity": "high",
    }
    response = await client.post("/incidents", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["done"] is True
    assert body["incident_id"].startswith("inc_")
    assert len(body["notes"]) == 1
    assert body["notes"][0]["agent"] == "triager"
