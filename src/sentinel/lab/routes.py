from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from sentinel.lab.generators import generate_logs, generate_metrics
from sentinel.lab.models import FailureMode, LogLine, MetricsSnapshot, ServiceState
from sentinel.lab.registry import ALL_SERVICES, registry

router = APIRouter(prefix="/lab", tags=["lab"])


class InjectRequest(BaseModel):
    mode: FailureMode


# --- GET routes (read-only) ---------------------------------------------------

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
