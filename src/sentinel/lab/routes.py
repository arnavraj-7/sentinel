from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from sentinel.lab.generators import (
    clear_poison,
    generate_logs,
    generate_metrics,
    set_poison,
)
from sentinel.lab.models import FailureMode, LogLine, MetricsSnapshot, ServiceState
from sentinel.lab.registry import ALL_SERVICES, registry

router = APIRouter(prefix="/lab", tags=["lab"])


class InjectRequest(BaseModel):
    mode: FailureMode


class PoisonLogRequest(BaseModel):
    """Phase 13b test affordance — push attacker-crafted text into a service's
    log feed to verify that downstream LLMs treat it as data, not instructions."""
    level: str = "ERROR"   # default ERROR so log_detective picks it up via get_error_traces
    message: str


# --- GET routes (read-only) ---------------------------------------------------

@router.get("/services/{service_name}/health")
async def health(service_name: str) -> dict:
    """Health probe: 200 + {"healthy": true} when up, 503 when crash-looping
    (status code is the signal — SRE/liveness-probe convention)."""
    state = registry.get(service_name)
    if state is None:
        raise HTTPException(status_code=404, detail=f"unknown service '{service_name}'")
    if state.failure_mode == FailureMode.CRASH_LOOP:
        raise HTTPException(status_code=503, detail="service down: crash loop")
    return {"healthy": True}
@router.get("/services", response_model=list[ServiceState])
async def list_services() -> list[ServiceState]:
    """List all services and their current failure state."""
    return registry.all()


@router.get("/services/{service_name}/metrics", response_model=MetricsSnapshot)
async def get_metrics(service_name: str) -> MetricsSnapshot:
    state = registry.get(service_name)
    if state is None:
        raise HTTPException(status_code=404, detail=f"unknown service '{service_name}'")
    return generate_metrics(state.name, state.failure_mode)


@router.get("/services/{service_name}/logs", response_model=list[LogLine])
async def get_logs(service_name: str, count: int = 8) -> list[LogLine]:
    state = registry.get(service_name)
    if state is None:
        raise HTTPException(status_code=404, detail=f"unknown service '{service_name}'")
    return generate_logs(state.name, state.failure_mode, count=count)


# --- POST routes (mutate state) -----------------------------------------------

@router.post("/services/{service_name}/heal", response_model=ServiceState)
async def heal_service(service_name: str) -> ServiceState:
    """Reset a service back to healthy."""
    if service_name not in ALL_SERVICES:
        raise HTTPException(status_code=404, detail=f"unknown service '{service_name}'")
    return registry.heal(service_name)


@router.post("/services/{service_name}/poison_log", response_model=dict)
async def poison_log(service_name: str, body: PoisonLogRequest) -> dict:
    """Push attacker-crafted text into the service's log feed (test-only)."""
    if service_name not in ALL_SERVICES:
        raise HTTPException(status_code=404, detail=f"unknown service '{service_name}'")
    set_poison(service_name, body.level, body.message)
    return {"service": service_name, "poisoned_level": body.level, "poisoned_message": body.message}


@router.post("/services/{service_name}/clear_poison", response_model=dict)
async def clear_poison_route(service_name: str) -> dict:
    """Drop poisoned lines for the service (clean-up after a test)."""
    clear_poison(service_name)
    return {"service": service_name, "cleared": True}


@router.post("/services/{service_name}/inject", response_model=ServiceState)
async def inject_failure(service_name: str, body: InjectRequest) -> ServiceState:
    """Inject a failure mode into a service.

    TODO — your turn:
      1. look up the service:  registry.get(service_name)
      2. if None:              raise HTTPException(status_code=404, detail=f"unknown service")
      3. inject the failure:   registry.inject(service_name, body.mode)
      4. return the result
    """
    state = registry.get(service_name)
    if state is None:
        raise HTTPException(status_code=404, detail=f"unknown service '{service_name}'")
    return registry.inject(service_name, body.mode)
