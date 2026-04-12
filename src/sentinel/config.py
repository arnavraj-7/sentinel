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


settings = Settings()
