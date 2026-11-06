import base64
import pytest
from backend import catalog,kodik


def test_published_token_encoding_roundtrip():
    token='0123456789abcdef0123456789abcdef'
    encoded=base64.b64encode(token[16:].encode()).decode()[::-1]+base64.b64encode(token[:16].encode()).decode()[::-1]
    assert kodik.decode(encoded)==token
    with pytest.raises(ValueError):kodik.decode('not-a-token')


def test_own_token_has_priority_and_is_not_replaced(monkeypatch):
    monkeypatch.setenv('KODIK_TOKEN','configured-test-key')
    calls=[]
    def request(token,params):
        calls.append(token)
        raise kodik.TokenUnavailable('Invalid')
    monkeypatch.setattr(kodik,'_request',request)
    monkeypatch.setattr(kodik.requests,'get',lambda *a,**kw:pytest.fail('Must not download another token'))
    with pytest.raises(kodik.TokenUnavailable):kodik.request({'title':'Test'})
    assert calls==['configured-test-key']


def test_kodik_groups_translations_by_release_and_retains_external_id(tmp_path,monkeypatch):
    monkeypatch.setattr(catalog,'DB',tmp_path/'catalog.sqlite3')
    catalog.cache.clear()
    monkeypatch.setattr(kodik,'request',lambda params:{'results':[
        {'id':'serial-1','title':'First season','shikimori_id':'12','translation':{'title':'A'}},
        {'id':'serial-2','title':'First season','shikimori_id':'12','translation':{'title':'B'}},
        {'id':'serial-3','title':'Second season','shikimori_id':'13'}]})
    items=catalog.kodik_search('Test')
    assert [a['id'] for a in items]==['kd-shiki-12','kd-shiki-13']
    assert catalog.saved('kd-shiki-12')[1]=={'shikimori_id':'12'}
    assert items[0]['mal_id']==12


def test_kodik_episode_objects_and_subtitle_kind(monkeypatch,tmp_path):
    from backend import app as server
    monkeypatch.setattr(catalog,'DB',tmp_path/'catalog.sqlite3')
    catalog.save({'id':'kd-shiki-12','title':'Test'},{'shikimori_id':'12'})
    monkeypatch.setattr(server,'kodik_results',lambda lookup:[{'translation':{'title':'Subs','type':'subtitles'},'seasons':{'1':{'episodes':{'7':{'link':'https://kodikplayer.com/seria/1/hash/720p'}}}}}])
    data=server.players('kd-shiki-12',7,1)
    assert data['players'][0]['kind']=='sub'
    assert server.recall(data['players'][0]['id'],'embed')['episode']==7
