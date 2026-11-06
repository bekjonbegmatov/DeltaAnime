import socket
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from backend import app as module

client = TestClient(module.app)


def test_health_and_input_validation():
    assert client.get('/api/health').json()['ok']
    assert client.get('/api/search?q=x').status_code == 422
    assert client.get('/api/anime/bad/episodes').status_code == 400
    assert client.get('/api/anime/1/players?episode=-1').status_code == 422


def test_expired_and_wrong_kind_handles():
    token = module.remember('player', 'example')
    assert client.get('/api/media/' + token).status_code == 410
    module.handles[token] = (0, 'player', 'example')
    assert client.get('/api/resolve/' + token).status_code == 410


def test_manifest_rewrites_segments_variants_and_keys():
    text = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio.m3u8"\n../segment.ts\n'
    rewritten = module.rewrite_manifest(text, 'https://cdn.example/video/index.m3u8', {'Referer': 'https://example.com'})
    assert 'URI="/api/media/' in rewritten
    assert '../segment.ts' not in rewritten
    token = rewritten.strip().splitlines()[-1].split('/')[-1]
    assert module.recall(token, 'media')[0] == 'https://cdn.example/segment.ts'


def test_private_network_is_rejected(monkeypatch):
    monkeypatch.setattr(socket, 'getaddrinfo', lambda *a, **kw: [(2, 1, 6, '', ('127.0.0.1', 443))])
    with pytest.raises(module.HTTPException) as error:
        module.validate_remote('https://cdn.example/movie.mp4')
    assert error.value.status_code == 400


def test_provider_failure_is_not_fake_success(monkeypatch):
    from backend import catalog
    def broken(*args, **kwargs):
        raise RuntimeError('secret proxy credentials')
    monkeypatch.setattr(catalog, 'catalog_data', broken)
    response = catalog.search_provider('aniliberty', 'naruto')
    assert response['status'] == 'error'
    assert response['items'] == []
    assert 'secret' not in str(response)


def test_demo_is_explicit_and_uses_media_handle():
    response = client.get('/api/demo')
    stream = response.json()['streams'][0]
    assert stream['label'] == 'Тестовый ролик'
    assert stream['url'].startswith('/api/media/')
