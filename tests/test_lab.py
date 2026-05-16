import pytest
from httpx import AsyncClient

from sentinel.lab.models import FailureMode
from sentinel.lab.registry import ALL_SERVICES, registry


@pytest.fixture(autouse=True)
def reset_lab() -> None:
    """Heal all services before each test so state never bleeds between tests."""
    for name in ALL_SERVICES:
        registry.heal(name)


async def test_list_services_returns_all_healthy(client: AsyncClient) -> None:
    response = await client.get("/lab/services")
    assert response.status_code == 200
    services = response.json()
    assert len(services) == 6
    assert all(s["failure_mode"] == FailureMode.HEALTHY for s in services)


async def test_inject_changes_metrics(client: AsyncClient) -> None:
    await client.post(
        "/lab/services/api-gateway/inject",
        json={"mode": "crash_loop"},
    )
    response = await client.get("/lab/services/api-gateway/metrics")
    assert response.status_code == 200
    metrics = response.json()
    assert metrics["failure_mode"] == "crash_loop"
    assert metrics["error_rate_pct"] > 50      # crash loop → near 100% errors
    assert metrics["uptime_seconds"] < 60       # crash loop → just restarted


# YOUR TURN — write these two tests:

async def test_inject_invalid_service_returns_404(client: AsyncClient) -> None:
    # POST to /lab/services/definitely-not-real/inject with any mode
    response = await client.post("/lab/services/fake-service/inject", json={"mode": "memory_leak"})
    # assert status_code == 404
    assert response.status_code == 404
    # assert "definitely-not-real" is in response.json()["detail"]
    assert "fake-service" in response.json()["detail"]



async def test_heal_resets_service_to_healthy(client: AsyncClient) -> None:
    # Step 1: inject memory_leak into db-proxy
    await client.post("/lab/services/db-proxy/inject", json={"mode": "memory_leak"})
    # Step 2: POST to /lab/services/db-proxy/heal
    await client.post("/lab/services/db-proxy/heal")
    # Step 3: GET /lab/services/db-proxy/metrics
    response = await client.get("/lab/services/db-proxy/metrics")
    # assert failure_mode == "healthy"
    assert response.json()["failure_mode"] == "healthy"

