"""Offline-friendly runtime checks against a running DeltaAnime container."""
import json
import re
import sys
from urllib.error import HTTPError
from urllib.request import Request, urlopen

base = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8080').rstrip('/')


def get(path, expected=200, headers=None):
    request = Request(base + path, headers=headers or {})
    try:
        with urlopen(request, timeout=10) as response:
            status, headers, body = response.status, response.headers, response.read()
    except HTTPError as error:
        status, headers, body = error.code, error.headers, error.read()
    assert status == expected, f'{path}: expected {expected}, got {status}'
    return headers, body


_, health = get('/api/health')
assert json.loads(health)['ok'] is True
headers, html = get('/')
assert 'text/html' in headers['Content-Type']
assert headers.get('Cache-Control') == 'no-cache'
assert b'id="root"' in html
for path in ['/catalog', '/search?q=naruto', '/anime/lib-8452', '/watch/kd-shiki-49596?episode=7']:
    _, page = get(path)
    assert page == html, f'{path}: not the SPA entry point'
asset = re.search(rb'src="(/assets/[^\"]+\.js)"', html)
assert asset, 'Built JavaScript asset missing from HTML'
headers, javascript = get(asset[1].decode())
assert javascript and 'immutable' in headers.get('Cache-Control', '')
for path in ['/api/not-a-route', '/assets/not-a-file.js', '/.env', '/backend/app.py']:
    get(path, 404)
get('/', 400, {'Host': 'untrusted.invalid'})
print('PASS: health, frontend, SPA deep links, assets, missing routes and Host validation')
