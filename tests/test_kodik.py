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
        {'type':'anime','link':'https://kodik.info/video/1/a','id':'serial-1','title':'First season','shikimori_id':'12','translation':{'title':'A'}},
        {'type':'anime','link':'https://kodik.info/video/2/a','id':'serial-2','title':'First season','shikimori_id':'12','translation':{'title':'B'}},
        {'type':'anime','link':'https://kodik.info/video/3/a','id':'serial-3','title':'Second season','shikimori_id':'13'}]})
    items=catalog.kodik_search('Test')
    assert [a['id'] for a in items]==['kd-shiki-12','kd-shiki-13']
    assert catalog.saved('kd-shiki-12')[1]=={'shikimori_id':'12'}
    assert items[0]['mal_id'] is None


def test_kodik_only_retains_explicit_mal_mapping_and_drops_legacy_inferred_id(tmp_path,monkeypatch):
    monkeypatch.setattr(catalog,'DB',tmp_path/'catalog.sqlite3')
    catalog.cache.clear()
    monkeypatch.setattr(kodik,'request',lambda params:{'results':[
        {'type':'anime','link':'https://kodik.info/video/1/a','id':'serial-1','title':'Example','shikimori_id':'90','myanimelist_id':'125'}]})
    item=catalog.kodik_search('Example')[0]
    assert item['mal_id']==125 and item['shikimori_id']==90
    assert catalog.detail(item['id'])['mal_id']==125
    catalog.save({'id':'kd-shiki-91','title':'Legacy','mal_id':91,'shikimori_id':91},{'shikimori_id':'91'})
    assert catalog.detail('kd-shiki-91')['mal_id'] is None


def test_versions_kodik_lookup_uses_shikimori_not_mal(monkeypatch):
    monkeypatch.setattr(catalog,'detail',lambda key:{'id':key,'title':'Example','source':'shikimori','shikimori_id':90,'mal_id':125})
    calls=[]
    def search(q=None,shikimori_id=None):
        calls.append(shikimori_id)
        return [{'id':'kd-shiki-90','playable':True,'shikimori_id':'90'}]
    monkeypatch.setattr(catalog,'kodik_search',search)
    result=catalog.versions('shiki-90','kodik')
    assert calls==[90]
    assert result['items'][0]['match']=='exact'


def test_versions_mal_only_lookup_does_not_use_it_as_shikimori(monkeypatch):
    monkeypatch.setattr(catalog,'resolve_shikimori_id',lambda item:None)
    monkeypatch.setattr(catalog,'detail',lambda key:{'id':key,'title':'Example','mal_id':125})
    monkeypatch.setattr(catalog,'kodik_search',lambda **kwargs:pytest.fail('MAL must not be passed as Shikimori'))
    monkeypatch.setattr(catalog,'search',lambda q,provider:{'items':[{'id':'kd-1','playable':True,'shikimori_id':125}],'status':'ok','source':provider})
    result=catalog.versions('al-1','kodik')
    assert result['items'][0]['match']=='candidate'


def test_versions_compare_each_identity_namespace_independently(monkeypatch):
    monkeypatch.setattr(catalog,'detail',lambda key:{'id':key,'title':'Example','shikimori_id':90,'mal_id':125})
    monkeypatch.setattr(catalog,'search',lambda q,provider:{'items':[
        {'id':'same-shiki','playable':True,'shikimori_id':'90'},
        {'id':'same-mal','playable':True,'mal_id':'125'},
        {'id':'wrong-shiki','playable':True,'shikimori_id':125},
        {'id':'wrong-mal','playable':True,'mal_id':90},
        {'id':'conflicting-shiki','playable':True,'mal_id':125,'shikimori_id':91},
        {'id':'conflicting-mal','playable':True,'mal_id':126,'shikimori_id':90},
        {'id':'unknown','playable':True}], 'status':'ok','source':provider})
    result=catalog.versions('shiki-90','animelib')
    assert [(item['id'],item['match']) for item in result['items']]==[
        ('same-shiki','exact'),('same-mal','exact'),('unknown','candidate')]


def test_kodik_episode_objects_and_subtitle_kind(monkeypatch,tmp_path):
    from backend import app as server
    monkeypatch.setattr(catalog,'DB',tmp_path/'catalog.sqlite3')
    catalog.save({'id':'kd-shiki-12','title':'Test'},{'shikimori_id':'12'})
    monkeypatch.setattr(server,'kodik_results',lambda lookup:[{'translation':{'title':'Subs','type':'subtitles'},'seasons':{'1':{'episodes':{'7':{'link':'https://kodikplayer.com/seria/1/hash/720p'}}}}}])
    data=server.players('kd-shiki-12',7,1)
    assert data['players'][0]['kind']=='sub'
    assert server.recall(data['players'][0]['id'],'embed')['episode']==7
