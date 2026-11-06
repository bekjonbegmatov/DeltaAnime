"""Small deployment settings shared by local development and the Docker runtime."""
import os
import re
from pathlib import Path


def allowed_hosts() -> list[str]:
    value = os.getenv('ALLOWED_HOSTS')
    if value is None:
        return ['localhost', '127.0.0.1', 'testserver']
    hosts = [host.strip().lower() for host in value.split(',')]
    if not hosts or any(not host for host in hosts):
        raise ValueError('ALLOWED_HOSTS must contain a comma-separated list of hostnames')
    for host in hosts:
        # A wildcard is accepted only when explicitly configured by the operator.
        if host == '*':
            continue
        name = host[2:] if host.startswith('*.') else host
        if not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?', name) or '..' in name:
            raise ValueError('ALLOWED_HOSTS entries must be hostnames without schemes, ports or paths')
    return list(dict.fromkeys(hosts))


def catalog_db_path() -> Path:
    configured = os.getenv('CATALOG_DB_PATH')
    if configured is not None and not configured.strip():
        raise ValueError('CATALOG_DB_PATH must not be empty')
    path = Path(configured).expanduser() if configured else Path(__file__).parent / 'catalog.sqlite3'
    path.parent.mkdir(parents=True, exist_ok=True)
    return path
