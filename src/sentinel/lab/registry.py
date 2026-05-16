from datetime import UTC, datetime

from sentinel.lab.models import FailureMode, ServiceState

ALL_SERVICES = [
    "api-gateway",
    "auth-service",
    "payment-service",
    "db-proxy",
    "cache-service",
    "cert-manager",
]


class ServiceRegistry:
    """In-memory store of each service's current failure state.

    One instance is created at module load and shared across all requests.
    This is safe because we only replace whole ServiceState objects (no
    partial mutation), so there are no race conditions for our use case.
    """

    def __init__(self) -> None:
        self._state: dict[str, ServiceState] = {
            name: ServiceState(name=name) for name in ALL_SERVICES
        }

    def all(self) -> list[ServiceState]:
        return list(self._state.values())

    def get(self, name: str) -> ServiceState | None:
        return self._state.get(name)

    def inject(self, name: str, mode: FailureMode) -> ServiceState:
        self._state[name] = ServiceState(
            name=name,
            failure_mode=mode,
            injected_at=datetime.now(UTC),
        )
        return self._state[name]

    def heal(self, name: str) -> ServiceState:
        self._state[name] = ServiceState(name=name)
        return self._state[name]


registry = ServiceRegistry()
