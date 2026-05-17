from sentinel.config import settings
from sentinel.datasource.base import DataSource
from sentinel.datasource.gcp import GCPDataSource
from sentinel.datasource.lab import LabDataSource

_instance: DataSource | None = None


def get_datasource() -> DataSource:
    global _instance
    if _instance is None:
        if settings.datasource == "gcp":
            _instance = GCPDataSource()
        else:
            _instance = LabDataSource()
    return _instance