from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="SENTINEL_",
        extra="ignore",
    )

    env: str = "dev"
    log_level: str = "INFO"
    checkpoint_db: Path = Path("./data/checkpoints.sqlite")
    google_project: str = "sentinel-496513"
    lab_base_url: str = "http://localhost:8000"
    sentinel_base_url: str = "http://localhost:8000"
    github_prod_link: str = "D:/projects/codefix-testrepo"
    test_command: str = "pytest"  # python test-runner module for sandbox verification
    datasource: str = "gcp"  # prod default; eval overrides via SENTINEL_DATASOURCE=lab
    max_healthy_error_rate_pct: float = 5.0
    max_healthy_latency_ms: float = 300.0
    min_healthy_uptime_s: float = 60.0
    max_healthy_cpu_pct: float = 60.0
    max_healthy_memory_mb: float = 600.0

settings = Settings()
