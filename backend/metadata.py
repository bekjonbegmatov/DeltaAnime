"""Public metadata sources. These adapters never advertise playable video.

Kitsu JSON:API relationships are resolved by their IDs; unrelated included
mappings must never attach another season's MAL identity to a title.
"""
import html
import math
import re
import threading
import time
from urllib.parse import urljoin

import requests
from fastapi import HTTPException

KITSU = 'https://kitsu.io/api/edge'
SHIKIMORI = 'https://shikimori.io'
_shiki_lock = threading.Lock()
_shiki_next_request = 0.0


def positive_int(value):
    if isinstance(value, bool) or not re.fullmatch(r'[1-9]\d*', str(value or '')):
        return None
    return int(value)


def score(value, divisor=1):
    try:
        number = float(value) / divisor
        return round(number, 2) if math.isfinite(number) and 0 < number <= 10 else None
    except (ValueError, TypeError):
        return None


def text(value):
    """Keep paragraph breaks and link text; do not render upstream HTML."""
    value = re.sub(r'<br\b[^>]*>|</p>|</div>', '\n', value or '', flags=re.I)
    return html.unescape(re.sub(r'<[^>]*>', '', value)).strip()


def year(value):
    match = re.match(r'^(\d{4})-', str(value or ''))
    return int(match[1]) if match else None


def fetch(provider, path, params=None):
    from . import catalog

    def request():
        global _shiki_next_request
        # Keep uncached Shikimori requests below its documented per-minute cap.
        # Waiting happens before the request, never while holding a cache lock.
        if provider == 'shikimori':
            with _shiki_lock:
                delay = max(0, _shiki_next_request - time.monotonic())
                if delay:
                    time.sleep(delay)
                _shiki_next_request = time.monotonic() + .8
        base = KITSU if provider == 'kitsu' else SHIKIMORI + '/api'
        headers = {'User-Agent': 'DeltaAnime/0.4 (metadata client)',
                   'Accept': 'application/vnd.api+json' if provider == 'kitsu' else 'application/json'}
        proxies = {'http': catalog.PROXY, 'https': catalog.PROXY} if catalog.PROXY else None
        response = requests.get(base + path, params=params, headers=headers,
                                timeout=(4, 10), proxies=proxies)
        response.raise_for_status()
        data = response.json()
        if isinstance(data, dict) and data.get('errors'):
            raise ValueError('Metadata API rejected request')
        return data

    return catalog.cached(('metadata', provider, path, tuple(sorted((params or {}).items()))), request, 300)


def normalize_shikimori(item):
    key = positive_int(item.get('id'))
    if not key:
        raise ValueError('Invalid Shikimori ID')
    # Search responses do not contain myanimelist_id. Do not assume their
    # numeric Shikimori ID is also a MAL ID; detail supplies the explicit field.
    description = text(item.get('description_html'))
    if not description:
        description = re.sub(r'\[/?(?:character|anime|manga|person|url|spoiler|b|i)[^\]]*\]', '', item.get('description') or '')
    return {
        'id': f'shiki-{key}', 'provider': 'Shikimori', 'source': 'shikimori', 'playable': False,
        'title': item.get('russian') or item.get('name') or f'Аниме {key}',
        'original_title': item.get('name'),
        'poster': urljoin(SHIKIMORI, (item.get('image') or {}).get('original')) if (item.get('image') or {}).get('original') else None,
        'description': description, 'year': year(item.get('aired_on')),
        'format': (item.get('kind') or '').upper() or None,
        'status': {'released': 'Завершён', 'ongoing': 'Сейчас выходит', 'anons': 'Анонс'}.get(item.get('status'), item.get('status')),
        'rating': score(item.get('score')), 'rating_source': 'Shikimori',
        'episodes_total': positive_int(item.get('episodes')), 'duration': positive_int(item.get('duration')),
        'genres': [g.get('russian') or g.get('name') for g in item.get('genres', []) if g.get('russian') or g.get('name')],
        'studios': [s['name'] for s in item.get('studios', []) if s.get('name')],
        'age': {'g': '0+', 'pg': '6+', 'pg_13': '13+', 'r': '17+', 'r_plus': '18+', 'rx': '18+'}.get(item.get('rating')),
        'mal_id': positive_int(item.get('myanimelist_id')), 'shikimori_id': key,
        'url': urljoin(SHIKIMORI, item.get('url') or f'/animes/{key}'),
    }


def normalize_kitsu(item, included=()):
    key = positive_int(item.get('id'))
    if item.get('type') != 'anime' or not key:
        raise ValueError('Invalid Kitsu anime')
    attributes = item.get('attributes') or {}
    titles = attributes.get('titles') or {}
    relationships = item.get('relationships') or {}
    resources = {(r.get('type'), str(r.get('id'))): r.get('attributes') or {} for r in included}

    def related(name):
        return [resources.get((r.get('type'), str(r.get('id'))), {})
                for r in (relationships.get(name) or {}).get('data', []) or []]

    # Multiple conflicting mappings are left unlinked, never guessed.
    mal_ids = {positive_int(mapping.get('externalId')) for mapping in related('mappings')
               if mapping.get('externalSite') == 'myanimelist/anime'} - {None}
    poster = attributes.get('posterImage') or {}
    cover = attributes.get('coverImage') or {}
    genres = [g.get('name') for g in related('genres') if g.get('name')]
    if not genres:
        genres = [c['title'] for c in related('categories') if c.get('title')]
    return {
        'id': f'kitsu-{key}', 'provider': 'Kitsu', 'source': 'kitsu', 'playable': False,
        'title': titles.get('en') or attributes.get('canonicalTitle') or titles.get('en_jp') or f'Аниме {key}',
        'original_title': titles.get('en_jp') or attributes.get('canonicalTitle'),
        'poster': poster.get('large') or poster.get('original') or poster.get('medium'),
        'banner': cover.get('small') or cover.get('large') or cover.get('original'),
        'description': text(attributes.get('synopsis') or attributes.get('description')),
        'year': year(attributes.get('startDate')), 'format': (attributes.get('subtype') or '').upper() or None,
        'status': {'current': 'Сейчас выходит', 'finished': 'Завершён', 'upcoming': 'Анонс', 'unreleased': 'Анонс', 'tba': 'Анонс'}.get(attributes.get('status'), attributes.get('status')),
        'rating': score(attributes.get('averageRating'), 10), 'rating_source': 'Kitsu',
        'genres': list(dict.fromkeys(genres)), 'episodes_total': positive_int(attributes.get('episodeCount')),
        'duration': positive_int(attributes.get('episodeLength')), 'age': attributes.get('ageRating'),
        'mal_id': next(iter(mal_ids)) if len(mal_ids) == 1 else None,
        'url': f'https://kitsu.app/anime/{key}',
    }


def search(provider, query):
    if provider == 'shikimori':
        data = fetch(provider, '/animes', {'search': query, 'limit': 24, 'censored': 'true'})
        if not isinstance(data, list):
            raise ValueError('Invalid Shikimori search response')
        return [normalize_shikimori(item) for item in data if item.get('rating') != 'rx']
    data = fetch(provider, '/anime', {'filter[text]': query, 'page[limit]': 20, 'include': 'mappings,categories'})
    if not isinstance(data, dict) or not isinstance(data.get('data'), list):
        raise ValueError('Invalid Kitsu search response')
    return [normalize_kitsu(item, data.get('included') or []) for item in data['data']
            if not (item.get('attributes') or {}).get('nsfw')]


def detail(key):
    if re.fullmatch(r'shiki-[1-9]\d*', key):
        data = fetch('shikimori', '/animes/' + key[6:])
        if data.get('rating') == 'rx':
            raise HTTPException(404, 'Тайтл недоступен в каталоге')
        return normalize_shikimori(data)
    if re.fullmatch(r'kitsu-[1-9]\d*', key):
        data = fetch('kitsu', '/anime/' + key[6:], {'include': 'mappings,categories'})
        if (data['data'].get('attributes') or {}).get('nsfw'):
            raise HTTPException(404, 'Тайтл недоступен в каталоге')
        return normalize_kitsu(data['data'], data.get('included') or [])
    raise HTTPException(400, 'Некорректный ID метаданных')
