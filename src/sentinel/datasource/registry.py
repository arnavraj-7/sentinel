"""Static service topology — the source of truth for what depends on what.

This is NOT fetched from running services. Topology is an architectural fact,
declared once here. The Topology Mapper reads this instead of hallucinating
a dependency graph from service names.
"""

SERVICE_REGISTRY: dict[str, dict] = {
    "api-gateway": {
        "url": "https://api-gateway-717499257054.us-central1.run.app",
        "depends_on": ["order-service", "inventory-service"],
    },
    "order-service": {
        "url": "https://order-service-717499257054.us-central1.run.app",
        "depends_on": ["inventory-service"],
    },
    "inventory-service": {
        "url": "https://inventory-service-717499257054.us-central1.run.app",
        "depends_on": [],
    },
}


def get_service_url(service: str) -> str:
    """Cloud Run base URL for a service. Raises if unknown."""
    entry = SERVICE_REGISTRY.get(service)
    if entry is None:
        raise KeyError(f"unknown service '{service}' — not in SERVICE_REGISTRY")
    return entry["url"]


def get_dependencies(service: str) -> list[str]:
    """Services this one calls (downstream)."""
    entry = SERVICE_REGISTRY.get(service)
    return entry["depends_on"] if entry else []


def get_dependents(service: str) -> list[str]:
    """Services that call this one (upstream) — reverse-lookup the graph."""
    return [
        name
        for name, entry in SERVICE_REGISTRY.items()
        if service in entry["depends_on"]
    ]


def describe_topology(service: str) -> str:
    """Human/LLM-readable blast-radius description for the failing service."""
    deps = get_dependencies(service)
    dependents = get_dependents(service)
    lines = [f"Failing service: {service}"]
    lines.append(
        f"  Depends on (downstream): {', '.join(deps) if deps else 'nothing'}"
    )
    lines.append(
        f"  Called by (upstream, blast radius): "
        f"{', '.join(dependents) if dependents else 'nothing — leaf service'}"
    )
    return "\n".join(lines)