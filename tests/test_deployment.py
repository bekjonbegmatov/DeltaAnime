import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.middleware.trustedhost import TrustedHostMiddleware

from backend import catalog, settings
from backend.app import mount_frontend


@pytest.fixture
def frontend_client(tmp_path):
    root = tmp_path / 'dist'
    root.mkdir()
    (root / 'index.html').write_text('<!doctype html><main>DeltaAnime</main>')
    (root / 'assets').mkdir()
    (root / 'assets' / 'index-a1b2c3.js').write_text('console.log("built frontend")')
    (tmp_path / 'secret.txt').write_text('outside static root')
    (root / 'assets' / 'escape.txt').symlink_to(tmp_path / 'secret.txt')
    app = FastAPI()
    @app.get('/api/health')
    def health():
        return {'ok': True}
    mount_frontend(app, root)
    return TestClient(app)


def test_frontend_routes_and_api_remain_separate(frontend_client):
    for route in ['/', '/catalog', '/search?q=Blue+Lock', '/anime/kd-shiki-49596', '/watch/lib-8452?episode=2', '/sources', '/saved', '/top']:
        response = frontend_client.get(route)
        assert response.status_code == 200, route
        assert 'DeltaAnime' in response.text
        assert response.headers['cache-control'] == 'no-cache'
    assert frontend_client.get('/api/health').json() == {'ok': True}
    assert frontend_client.get('/index.html').headers['cache-control'] == 'no-cache'
    assert frontend_client.head('/watch/demo').status_code == 200
    assert frontend_client.post('/watch/demo').status_code == 405
    for route in ['/api', '/api/missing', '/not-a-ui-route', '/assets/missing.js', '/favicon-missing.svg']:
        response = frontend_client.get(route)
        assert response.status_code == 404, route
        assert 'DeltaAnime' not in response.text


def test_static_assets_are_cached_without_exposing_files(frontend_client):
    response = frontend_client.get('/assets/index-a1b2c3.js')
    assert response.status_code == 200
    assert 'built frontend' in response.text
    assert response.headers['cache-control'] == 'public, max-age=31536000, immutable'
    for route in ['/assets/escape.txt', '/%2e%2e/secret.txt', '/assets/%2e%2e/%2e%2e/secret.txt', '/assets/%5c..%5csecret.txt']:
        response = frontend_client.get(route)
        assert response.status_code == 404, route
        assert 'outside static root' not in response.text


def test_frontend_config_requires_a_real_build(tmp_path):
    app = FastAPI()
    mount_frontend(app, None)
    assert TestClient(app).get('/').status_code == 404
    for directory in ['', tmp_path, tmp_path / 'missing']:
        with pytest.raises(RuntimeError, match='STATIC_DIR'):
            mount_frontend(FastAPI(), directory)


def test_catalog_path_supports_a_fresh_persistent_volume(monkeypatch, tmp_path):
    target = tmp_path / 'data' / 'nested' / 'catalog.sqlite3'
    monkeypatch.setenv('CATALOG_DB_PATH', str(target))
    monkeypatch.setattr(catalog, 'DB', settings.catalog_db_path())
    assert target.parent.is_dir()
    item = {'id': 'docker-test', 'title': 'Persisted title'}
    catalog.save(item, {'shikimori_id': 123})
    assert target.is_file()
    assert catalog.saved('docker-test') == (item, {'shikimori_id': 123})
    monkeypatch.setenv('CATALOG_DB_PATH', '')
    with pytest.raises(ValueError, match='CATALOG_DB_PATH'):
        settings.catalog_db_path()


def test_allowed_hosts_are_explicit_and_configurable(monkeypatch):
    monkeypatch.delenv('ALLOWED_HOSTS', raising=False)
    assert settings.allowed_hosts() == ['localhost', '127.0.0.1', 'testserver']
    monkeypatch.setenv('ALLOWED_HOSTS', 'localhost, ANIME.EXAMPLE.COM,anime.example.com')
    app = FastAPI()
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts())
    @app.get('/api/health')
    def health():
        return {'ok': True}
    client = TestClient(app)
    assert client.get('/api/health', headers={'host': 'anime.example.com:8080'}).status_code == 200
    assert client.get('/api/health', headers={'host': 'untrusted.example.com'}).status_code == 400
    for value in ['', 'localhost,', 'https://anime.example.com', 'localhost:8080', 'bad*host', 'a..b']:
        monkeypatch.setenv('ALLOWED_HOSTS', value)
        with pytest.raises(ValueError, match='ALLOWED_HOSTS'):
            settings.allowed_hosts()
    monkeypatch.setenv('ALLOWED_HOSTS', '*.example.com')
    assert settings.allowed_hosts() == ['*.example.com']
