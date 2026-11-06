import pytest
import requests
from fastapi.testclient import TestClient

from backend import catalog, metadata
from backend.app import app

client = TestClient(app)


def kitsu_title(key='44973', mapping_ids=('mal-first',)):
    return {
        'id': key, 'type': 'anime',
        'attributes': {'canonicalTitle': 'Blue Lock', 'titles': {'en': 'BLUE LOCK', 'en_jp': 'Blue Lock'},
                       'startDate': '2022-10-08', 'subtype': 'TV', 'status': 'finished',
                       'averageRating': '81.19', 'episodeCount': 24, 'episodeLength': 24,
                       'posterImage': {'large': 'https://media.kitsu.app/poster.jpg'},
                       'coverImage': {'small': 'https://media.kitsu.app/banner.jpg'}, 'nsfw': False},
        'relationships': {'mappings': {'data': [{'type': 'mappings', 'id': key} for key in mapping_ids]},
                          'categories': {'data': [{'type': 'categories', 'id': 'sports'}]}}}


def mapping(key, external_id, site='myanimelist/anime'):
    return {'id': key, 'type': 'mappings', 'attributes': {'externalSite': site, 'externalId': external_id}}


def test_kitsu_uses_only_title_relationships_to_link_mal():
    included = [mapping('mal-first', '49596'), mapping('mal-second', '54865'),
                mapping('anilist', '137822', 'anilist/anime'),
                {'type': 'categories', 'id': 'sports', 'attributes': {'title': 'Sports'}}]
    first = metadata.normalize_kitsu(kitsu_title(), included)
    second = metadata.normalize_kitsu(kitsu_title('47245', ('mal-second',)), included)
    assert first['mal_id'] == 49596 and second['mal_id'] == 54865
    assert first['id'] == 'kitsu-44973' and first['playable'] is False
    assert first['rating'] == 8.12 and first['rating_source'] == 'Kitsu'
    assert first['genres'] == ['Sports'] and first['banner'].endswith('/banner.jpg')
    assert first['year'] == 2022 and first['episodes_total'] == 24


@pytest.mark.parametrize('mappings', [
    [mapping('a', '42'), mapping('b', '43')],
    [mapping('a', '42', 'myanimelist/manga'), mapping('b', '0')],
    [mapping('a', 'invalid'), mapping('b', True)],
])
def test_kitsu_never_guesses_missing_or_conflicting_identity(mappings):
    item = metadata.normalize_kitsu(kitsu_title(mapping_ids=('a', 'b')), mappings)
    assert item['mal_id'] is None


def test_shikimori_uses_explicit_mal_and_safe_russian_description():
    item = {'id': 90, 'myanimelist_id': 125, 'name': 'Example', 'russian': 'Пример',
            'description_html': '<p>Первый <a href="https://example.com">герой</a>.</p><p>Второй<br class="br">абзац &amp; конец.</p>',
            'image': {'original': '/system/animes/original/90.jpg'}, 'aired_on': '2022-01-01',
            'score': '8.1', 'rating': 'pg_13', 'kind': 'tv', 'status': 'released',
            'genres': [{'name': 'Sports', 'russian': 'Спорт'}], 'studios': [{'name': 'Studio'}]}
    result = metadata.normalize_shikimori(item)
    assert result['mal_id'] == 125 and result['shikimori_id'] == 90
    assert result['description'] == 'Первый герой.\nВторой\nабзац & конец.'
    assert result['poster'] == 'https://shikimori.io/system/animes/original/90.jpg'
    assert result['title'] == 'Пример' and result['genres'] == ['Спорт']
    assert result['studios'] == ['Studio'] and result['playable'] is False
    item.pop('myanimelist_id')
    assert metadata.normalize_shikimori(item)['mal_id'] is None


def test_kitsu_search_excludes_nsfw_and_preserves_contract(monkeypatch):
    normal = kitsu_title()
    adult = kitsu_title('999')
    adult['attributes']['nsfw'] = True
    calls = []
    def fetch(provider, path, params):
        calls.append((provider, path, params))
        return {'data': [normal, adult], 'included': [mapping('mal-first', '49596')]}
    monkeypatch.setattr(metadata, 'fetch', fetch)
    result = catalog.search_provider('kitsu', 'Blue Lock')
    assert result['status'] == 'ok' and result['count'] == 1
    assert result['items'][0]['mal_id'] == 49596
    assert calls[0][2]['include'] == 'mappings,categories'


def test_metadata_timeout_is_partial_failure_not_unhandled_error(monkeypatch):
    def fetch(*args, **kwargs):
        raise requests.Timeout('upstream timeout')
    monkeypatch.setattr(metadata, 'fetch', fetch)
    result = catalog.search_provider('shikimori', 'Blue Lock')
    assert result['status'] == 'error' and result['items'] == []
    assert 'upstream' not in result['message']


def test_new_sources_are_searchable_but_never_video_sources():
    entries = {source['id']: source for source in catalog.sources()['sources']}
    for source in ('kitsu', 'shikimori'):
        assert entries[source]['search'] is True and entries[source]['playback'] is False
        assert entries[source]['type'] == 'Метаданные'
        assert client.get('/api/titles/lib-1/versions', params={'provider': source}).status_code == 400
    assert entries['jikan']['search'] is False
    assert 'anime365' not in entries


def test_metadata_detail_can_open_without_previous_search(monkeypatch):
    monkeypatch.setattr(metadata, 'fetch', lambda *args, **kwargs: {'data': kitsu_title(), 'included': [mapping('mal-first', '49596')]})
    response = client.get('/api/titles/kitsu-44973')
    assert response.status_code == 200
    assert response.json()['mal_id'] == 49596 and response.json()['playable'] is False
    assert client.get('/api/titles/kitsu-invalid').status_code == 400
    assert client.get('/api/titles/shiki-0').status_code == 400


def test_kitsu_fetch_sends_required_json_api_accept_header(monkeypatch):
    calls = []
    class Response:
        def raise_for_status(self): pass
        def json(self): return {'data': []}
    def get(url, **kwargs):
        calls.append((url, kwargs))
        return Response()
    monkeypatch.setattr(metadata.requests, 'get', get)
    catalog.cache.clear()
    metadata.fetch('kitsu', '/anime', {'filter[text]': 'contract-test'})
    metadata.fetch('kitsu', '/anime', {'filter[text]': 'contract-test'})
    assert len(calls) == 1
    assert calls[0][1]['headers']['Accept'] == 'application/vnd.api+json'
    assert calls[0][1]['timeout'] == (4, 10)
