import pytest
from fastapi.testclient import TestClient
from backend import catalog
from backend.app import app
client=TestClient(app)


def test_federated_search_returns_healthy_sources_when_one_fails(monkeypatch):
    monkeypatch.setattr(catalog,'sources',lambda:{'sources':[{'id':'aniliberty','search':True},{'id':'animego','search':True}]})
    def provider(name,q):
        if name=='animego':return {'items':[],'source':name,'status':'error','message':'unavailable'}
        return {'items':[{'id':'lib-1','title':'Test','provider':'AniLiberty','playable':True}],'source':name,'status':'ok'}
    monkeypatch.setattr(catalog,'search_provider',provider)
    catalog.cache.clear()
    response=client.get('/api/search?q=unique-test')
    assert response.status_code==200
    data=response.json()
    assert data['items'][0]['id']=='lib-1'
    assert {x['status'] for x in data['sources']}=={'ok','error'}


def test_identical_titles_are_not_merged_without_shared_id():
    items=[{'id':'a','title':'Same','provider':'A'},{'id':'b','title':'Same','provider':'B'}]
    assert len(catalog.merge_results(items))==2


def test_shared_mal_id_prefers_playable_and_keeps_variants():
    result=catalog.merge_results([
        {'id':'al-1','mal_id':269,'title':'Bleach','provider':'AniList','playable':False},
        {'id':'lib-8452','mal_id':269,'title':'Блич','provider':'AniLiberty','playable':True}])
    assert len(result)==1
    assert result[0]['id']=='lib-8452'
    assert len(result[0]['variants'])==2


def test_filters_reach_upstream_and_paginate(monkeypatch):
    calls=[]
    def remote(url,params=None,body=None):
        calls.append(body)
        return {'data':[],'meta':{'pagination':{'total':0,'current_page':2,'total_pages':0}}}
    monkeypatch.setattr(catalog,'remote',remote)
    response=client.get('/api/catalog?provider=aniliberty&page=2&year=2020&genre=14&kind=TV&status=ongoing&sort=year')
    assert response.status_code==200
    body=calls[0]
    assert body['page']==2
    assert body['f']=={'sorting':'YEAR_DESC','genres':[14],'years':{'from_year':2020,'to_year':2020},'types':['TV'],'publish_statuses':['IS_ONGOING']}


def test_invalid_catalog_filters_are_rejected():
    assert client.get('/api/catalog?page=0').status_code==422
    assert client.get('/api/catalog?sort=sql').status_code==422
    assert client.get('/api/catalog?provider=aniliberty&genre=abc').status_code==400


def test_kodik_requires_configured_key(monkeypatch):
    monkeypatch.delenv('KODIK_TOKEN',raising=False)
    monkeypatch.setenv('KODIK_AUTO_TOKEN','0')
    data=catalog.search_provider('kodik','test')
    assert data['status']=='needs_key'
    assert not next(s for s in catalog.sources()['sources'] if s['id']=='kodik')['search']


def test_catalog_card_survives_database_reopen(tmp_path,monkeypatch):
    monkeypatch.setattr(catalog,'DB',tmp_path/'titles.sqlite3')
    item={'id':'amd-42','title':'Example','provider':'Animedia'}
    catalog.save(item,{'url':'https://amd.online/42-example.html'})
    loaded,lookup=catalog.saved('amd-42')
    assert loaded==item and lookup['url'].endswith('42-example.html')


def test_alloha_accepts_anime_classified_as_series(tmp_path,monkeypatch):
    from types import SimpleNamespace
    monkeypatch.setattr(catalog,'DB',tmp_path/'titles.sqlite3')
    class FakeAlloha:
        def __init__(self,**kwargs):pass
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def find(self,**kwargs):return SimpleNamespace(category='сериал',id_kp=258621,id_imdb=None,name='Блич',year=2004,original_name='Bleach',poster='https://example.com/poster.jpg',description='Example',rating_kp=8.0,seasons={1:[1,2]})
    monkeypatch.setattr(catalog,'Alloha',FakeAlloha)
    data=catalog.search_provider('alloha','Блич')
    assert data['status']=='ok' and len(data['items'])==1
    assert data['items'][0]['seasons']==[1]


def test_lib_rejects_unavailable_episode_and_binds_valid_episode(monkeypatch):
    from backend import app as server
    monkeypatch.setattr(catalog,'lib_release',lambda key:{'episodes':[{'ordinal':1},{'ordinal':3}]})
    assert client.get('/api/anime/lib-1/players?episode=2').status_code==404
    data=client.get('/api/anime/lib-1/players?episode=3').json()
    assert server.recall(data['players'][0]['id'],'lib-player')==('1',3)
    assert data['players'][0]['language']=='ru' and data['players'][0]['kind']=='voice'
