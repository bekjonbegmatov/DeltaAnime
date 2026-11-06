import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from backend import catalog,providers
from backend import app as server
client=TestClient(server.app)


def test_structured_description_is_plain_text():
    assert catalog.plain({'type':'doc','content':[{'type':'paragraph','content':[{'type':'text','text':'Hello\\nworld'}]}]})=='Hello\nworld\n'


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
