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
    datasource: str = "gcp"  # prod default; eval overrides via SENTINEL_DATASOURCE=lab


settings = Settings()
