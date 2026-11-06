import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from backend import catalog,providers
from backend import app as server
client=TestClient(server.app)


def test_structured_description_is_plain_text():
    assert catalog.plain({'type':'doc','content':[{'type':'paragraph','content':[{'type':'text','text':'Hello\\nworld'}]}]})=='Hello\nworld\n'


def test_animelib_shikimori_link_is_not_a_mal_mapping():
    item=providers.normalize_lib({'id':1,'name':'Example','slug_url':'example',
                                  'shikimori_href':'https://shikimori.io/animes/90-example'})
    assert item['shikimori_id']==90 and item['mal_id'] is None


def test_versions_reject_other_seasons_and_require_confirmation_without_ids(monkeypatch):
    monkeypatch.setattr(catalog,'detail',lambda key:{'id':key,'title':'Example','original_title':'Example','mal_id':12,'source':'aniliberty'})
    monkeypatch.setattr(catalog,'search',lambda q,p:{'source':p,'status':'ok','items':[
        {'id':'a','title':'Example','mal_id':12,'playable':True},
        {'id':'b','title':'Example Season 2','mal_id':13,'playable':True},
        {'id':'c','title':'Example','playable':True}]})
    data=client.get('/api/titles/lib-1/versions?provider=animelib').json()
    assert [(v['id'],v['match']) for v in data['items']]==[('a','exact'),('c','candidate')]


def test_vost_preserves_sparse_episode_numbers_and_rejects_missing(monkeypatch):
    monkeypatch.setattr(catalog,'saved',lambda key:({'playable':True},{'id':1}))
    monkeypatch.setattr(providers,'fetch',lambda *a,**kw:[{'name':'1 серия','hd':'https://cdn.example/1.mp4'},{'name':'3 серия','std':'https://cdn.example/3.mp4'}])
    assert [e['number'] for e in providers.episode_rows('av-1')]==[1,3]
    with pytest.raises(HTTPException):providers.players('av-1',2,1,server.remember)
    v=providers.players('av-1',3,1,server.remember)[0]
    assert server.recall(v['id'],'direct-streams')[0]['quality']==480


def test_vost_named_movie_is_episode_one_with_real_streams(monkeypatch):
    monkeypatch.setattr(catalog,'saved',lambda key:({'playable':True},{'id':3678}))
    movie=[{'name':'Фильм','hd':'https://cdn.example/movie.mp4'}]
    monkeypatch.setattr(providers,'fetch',lambda *a,**kw:movie)
    item=providers.normalize_vost({'id':3678,'title':'Резе [1 из 1]','type':'полнометражный фильм'},movie)
    assert item['playable'] and item['available_episodes']==1
    assert providers.episode_rows('av-3678')[0]['number']==1
    assert providers.players('av-3678',1,1,server.remember)[0]['label']=='AnimeVost'


def test_vost_empty_or_trailer_only_playlists_are_not_watchable():
    title={'id':1,'title':'Анонс [0 из 12]','series':"{'1 серия':'123'}"}
    for playlist in ([],[{'name':'Трейлер','hd':'https://cdn.example/trailer.mp4'}],[{'name':'1 серия','hd':''}]):
        item=providers.normalize_vost(title,playlist)
        assert item['playable'] is False and item['available_episodes']==0


def test_vost_poster_uses_verified_main_site_upload_path():
    item=providers.normalize_vost({'id':1,'title':'Movie','urlImagePreview':'https://static.openni.ru/uploads/posts/2025-09/poster.jpg'})
    assert item['poster']=='https://animevost.org/uploads/posts/2025-09/poster.jpg'


def test_licensed_animelib_is_not_playable(monkeypatch):
    monkeypatch.setattr(catalog,'saved',lambda key:({'playable':False},{'slug':'test'}))
    with pytest.raises(HTTPException) as error:providers.episode_rows('aml-1')
    assert error.value.status_code==403


def test_native_stream_resolve_keeps_headers_server_side(monkeypatch):
    monkeypatch.setattr(server,'validate_remote',lambda u:None)
    token=server.remember('direct-streams',[{'url':'https://cdn.example/file.mp4','headers':{'Referer':'https://example.com/'},'quality':720,'kind':'mp4','label':'720p'}])
    data=client.get('/api/resolve/'+token).json()
    stream=data['streams'][0]
    assert 'headers' not in stream and stream['url'].startswith('/api/media/')
    assert server.recall(stream['url'].split('/')[-1],'media')[1]['Referer']=='https://example.com/'


def test_removed_source_cannot_be_searched_or_opened():
    assert not any(s['id']=='anime365' for s in catalog.sources()['sources'])
    assert client.get('/api/search?q=Blue%20Lock&provider=anime365').status_code==400
    assert client.get('/api/titles/a365-25142').status_code==410
    assert client.get('/api/anime/a365-25142/players?episode=1').status_code==400
