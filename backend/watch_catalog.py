"""Watchable Kodik catalog, with server-held cursors and release deduplication."""
import re
import secrets
import threading
import time
from urllib.parse import parse_qs, urlsplit

from fastapi import HTTPException
from . import kodik

PAGE_SIZE = 24
CURSOR_TTL = 3600
_cursors = {}
_lock = threading.Lock()
GENRES = ['Военное', 'Драма', 'Исторический', 'Экшен', 'Приключения', 'Сёнен', 'Фэнтези',
          'Комедия', 'Боевые искусства', 'Романтика', 'Психологическое', 'Триллер',
          'Повседневность', 'Сверхъестественное', 'Спорт', 'Школа', 'Музыка', 'Фантастика', 'Самураи']


def valid_link(value):
    if not isinstance(value, str):return False
    parsed = urlsplit('https:' + value if value.startswith('//') else value)
    return parsed.scheme in ('https', 'http') and bool(parsed.hostname) and not parsed.username


def playable_kodik(item):
    if item.get('type') not in ('anime', 'anime-serial') or not valid_link(item.get('link')):
        return False
    if (item.get('material_data') or {}).get('anime_status') == 'anons':return False
    if item['type'] == 'anime':return True  # Films have no episode_count or seasons.
    try:
        if int(item.get('episodes_count') or 0) <= 0:return False
    except (ValueError, TypeError):return False
    seasons = item.get('seasons') or {}
    return any(valid_link(season.get('link')) or any(
        valid_link(episode.get('link') if isinstance(episode, dict) else episode)
        for episode in (season.get('episodes') or {}).values()) for season in seasons.values())


def upstream_cursor(value):
    if not value:return None
    parsed = urlsplit(value)
    if parsed.scheme != 'https' or parsed.hostname != 'kodik-api.com' or parsed.path != '/list':
        raise ValueError('Unexpected Kodik pagination URL')
    cursor = parse_qs(parsed.query).get('next', [None])[0]
    if not cursor or len(cursor) > 2048 or not re.fullmatch(r'[A-Za-z0-9_+/=-]+', cursor):
        raise ValueError('Invalid Kodik pagination cursor')
    return cursor  # Discard token, hostname and every other upstream URL parameter.


def remember(state):
    with _lock:
        now = time.monotonic()
        for key in list(_cursors):
            if _cursors[key][0] < now:del _cursors[key]
        if len(_cursors) >= 500:del _cursors[next(iter(_cursors))]
        token = secrets.token_urlsafe(24)
        _cursors[token] = (now + CURSOR_TTL, state)
        return token


def recall(cursor, filters):
    if not re.fullmatch(r'[A-Za-z0-9_-]{32}', cursor):raise HTTPException(400, 'Некорректная страница каталога')
    with _lock:entry = _cursors.get(cursor)
    if not entry or entry[0] < time.monotonic():raise HTTPException(410, 'Страница каталога устарела. Откройте каталог с начала.')
    state = entry[1]
    if state['filters'] != filters:raise HTTPException(400, 'Фильтры страницы изменились. Начните с первой страницы.')
    return state


def page(sort='fresh', genre='', year=None, kind='', status='', cursor=None):
    from . import catalog
    filters = (sort, genre, year, kind, status)
    if cursor:
        original = recall(cursor, filters)
    else:
        original = {'filters': filters, 'next': None, 'started': False, 'pending': [], 'seen': set(), 'visited': set(), 'page': 1, 'previous': None}
    seen = set(original['seen'])
    visited = set(original['visited'])
    pending = list(original['pending'])
    next_upstream = original['next']
    started = original['started']
    result = []
    calls = 0
    params = {'types': 'anime,anime-serial', 'with_material_data': 'true', 'with_seasons': 'true',
              'limit': 100, 'sort': {'fresh': 'updated_at', 'rating': 'shikimori_rating', 'year': 'year'}[sort],
              'order': 'desc', 'not_blocked_for_me': 'true'}
    if genre:params['anime_genres'] = genre
    if year:params['year'] = year
    if kind:params['anime_kind'] = {'TV': 'tv', 'MOVIE': 'movie', 'SPECIAL': 'special', 'ONA': 'ona', 'OVA': 'ova', 'MUSIC': 'music'}.get(kind, kind.lower())
    if status:params['anime_status'] = 'ongoing' if status == 'ongoing' else 'released'

    while len(result) < PAGE_SIZE:
        if pending:
            item = pending.pop(0)
            if item['id'] in seen:continue
            seen.add(item['id'])
            result.append(item)
            continue
        if started and not next_upstream:break
        # A popular show may have dozens of translations. Bound upstream work,
        # retain the rest for the next UI page, and never count voices as titles.
        if calls >= 4:break
        request = {**params, **({'next': next_upstream} if next_upstream else {})}
        visited.add(next_upstream)
        data = catalog.cached(('kodik-list', tuple(sorted(request.items()))), lambda: kodik.request(request, endpoint='list'), 120)
        pending = catalog.normalize_kodik_rows(data['results'])
        next_upstream = upstream_cursor(data.get('next_page'))
        if next_upstream in visited:next_upstream = None
        started = True
        calls += 1

    more = bool(pending or next_upstream)
    next_cursor = remember({'filters': filters, 'next': next_upstream, 'started': started, 'pending': pending,
                            'seen': seen, 'visited': visited, 'page': original['page'] + 1, 'previous': cursor}) if more else None
    return {'items': result, 'source': 'kodik', 'page': original['page'], 'has_next': more,
            'next_cursor': next_cursor, 'prev_cursor': original['previous']}
