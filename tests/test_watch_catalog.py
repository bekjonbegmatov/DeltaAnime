import json
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from backend import catalog, kodik, metadata, watch_catalog
from backend.app import app

client=TestClient(app)


def movie(number, **extra):
    return {'id':f'movie-{number}','type':'anime','link':f'//kodik.info/video/{number}/hash/720p',
            'title':f'Movie {number}','shikimori_id':str(number),
            'material_data':{'anime_kind':'movie','anime_status':'released','shikimori_rating':8},**extra}


@pytest.fixture(autouse=True)
def isolated_state(tmp_path,monkeypatch):
    monkeypatch.setattr(catalog,'DB',tmp_path/'catalog.sqlite3')
    catalog.cache.clear()
    watch_catalog._cursors.clear()


def test_cursor_pagination_deduplicates_voices_and_never_exposes_token(monkeypatch):
    calls=[]
    def request(params,endpoint='search'):
        calls.append((params,endpoint))
        if 'next' not in params:
            return {'total':90000,'results':[movie(i) for i in range(1,26) for _ in range(2)],
                    'next_page':'https://kodik-api.com/list?token=server-secret&next=cGFnZTI='}
        return {'results':[movie(1),movie(26),movie(27)],'next_page':None}
    monkeypatch.setattr(kodik,'request',request)
    first=watch_catalog.page(sort='rating',genre='Спорт',year=2025,kind='MOVIE',status='finished')
    second=watch_catalog.page(sort='rating',genre='Спорт',year=2025,kind='MOVIE',status='finished',cursor=first['next_cursor'])
    assert len(first['items'])==24 and len(second['items'])==3
    assert not {item['id'] for item in first['items']} & {item['id'] for item in second['items']}
    assert second['page']==2 and second['has_next'] is False
    assert 'total' not in first and 'server-secret' not in json.dumps(first)
    assert calls[0][1]=='list'
    assert calls[0][0]['sort']=='shikimori_rating' and calls[0][0]['anime_genres']=='Спорт'
    assert calls[0][0]['anime_kind']=='movie' and calls[0][0]['anime_status']=='released'
    assert 'token' not in calls[1][0] and calls[1][0]['next']=='cGFnZTI='


def test_cursor_rejects_invalid_expired_or_changed_filter_state(monkeypatch):
    with pytest.raises(HTTPException) as bad:watch_catalog.page(cursor='https://evil.test/list')
    assert bad.value.status_code==400
    with pytest.raises(HTTPException) as expired:watch_catalog.page(cursor='a'*32)
    assert expired.value.status_code==410
    token=watch_catalog.remember({'filters':('fresh','',None,'','')})
    with pytest.raises(HTTPException) as changed:watch_catalog.page(sort='rating',cursor=token)
    assert changed.value.status_code==400
    with pytest.raises(ValueError):watch_catalog.upstream_cursor('https://evil.test/list?next=abcd')


def test_repeating_upstream_cursor_cannot_create_endless_empty_pages(monkeypatch):
    calls=[]
    def request(params,endpoint='search'):
        calls.append(params)
        return {'results':[movie(1)],'next_page':'https://kodik-api.com/list?token=secret&next=AAAA'}
    monkeypatch.setattr(kodik,'request',request)
    result=watch_catalog.page()
    assert len(calls)==2 and len(result['items'])==1
    assert result['has_next'] is False and result['next_cursor'] is None


@pytest.mark.parametrize('changes',[
    {'link':None},{'type':'foreign-movie'},
    {'type':'anime-serial','episodes_count':0,'seasons':{'1':{'link':'//kodik.info/season/1'}}},
    {'type':'anime-serial','episodes_count':12,'seasons':{}},
    {'material_data':{'anime_status':'anons'}},
])
def test_kodik_does_not_advertise_unavailable_material(changes):
    assert catalog.normalize_kodik_rows([movie(1,**changes)])==[]


def test_film_without_episodes_is_watchable_and_ids_are_numeric():
    item=catalog.normalize_kodik_rows([movie(57555)])[0]
    assert item['available_episodes']==1 and item['episodes_total']==1
    assert item['playable'] is True and item['shikimori_id']==57555


def test_title_alias_search_uses_confirmed_shikimori_id(monkeypatch):
    monkeypatch.setattr(metadata,'search',lambda provider,q:[
        {'id':'shiki-36245','shikimori_id':36245,'title':'Зло или жизнь'},
        {'id':'shiki-57555','shikimori_id':57555,'title':'История Резе'}])
    calls=[]
    def search(q=None,shikimori_id=None):
        calls.append((q,shikimori_id))
        return [] if q else [{'id':'kd-shiki-57555','shikimori_id':57555,'playable':True}]
    monkeypatch.setattr(catalog,'kodik_search',search)
    result=catalog.kodik_discover('Резе')
    assert result[0]['id']=='kd-shiki-57555'
    assert calls==[('Резе',None),(None,57555)]


def test_metadata_to_video_checks_explicit_mal_mapping_not_equal_numbers(monkeypatch):
    monkeypatch.setattr(metadata,'search',lambda provider,q:[{'id':'shiki-125'},{'id':'shiki-90'}])
    monkeypatch.setattr(metadata,'detail',lambda key:{'mal_id':999 if key=='shiki-125' else 125,'shikimori_id':125 if key=='shiki-125' else 90})
    assert catalog.resolve_shikimori_id({'title':'Example','mal_id':125})==90


def test_watchable_rejects_conflicting_explicit_mal(monkeypatch):
    monkeypatch.setattr(catalog,'detail',lambda key:{'title':'Example','shikimori_id':90,'mal_id':125,'playable':False})
    monkeypatch.setattr(catalog,'kodik_search',lambda **kwargs:[{'id':'kd-shiki-90','shikimori_id':90,'mal_id':126,'playable':True}])
    response=client.get('/api/titles/al-1/watchable')
    assert response.status_code==200 and response.json()=={'item':None,'status':'unavailable'}


def test_anilibria_catalog_checks_episode_links_in_one_batch(monkeypatch):
    calls=[]
    def remote(url,params=None,body=None):
        calls.append(url)
        if url.endswith('/catalog/releases'):
            return {'data':[{'id':i,'name':{'main':f'Anime {i}'}} for i in (1,2,3)],'meta':{'pagination':{'total':3,'total_pages':1}}}
        return {'data':[{'id':1,'episodes':[{'ordinal':1,'hls_720':'https://cdn.example/1.m3u8'}]},
                        {'id':2,'episodes':[]},
                        {'id':3,'is_blocked_by_geo':True,'episodes':[{'ordinal':1,'hls_720':'https://cdn.example/3.m3u8'}]}]}
    monkeypatch.setattr(catalog,'remote',remote)
    result=catalog.catalog_data()
    assert [item['id'] for item in result['items']]==['lib-1']
    assert len(calls)==2 and calls[1].endswith('/releases/list')
    assert 'total' not in result


def test_animego_frontpage_results_are_not_search_matches():
    assert not catalog.search_title_matches({'title':'Боец Баки','original_title':'Baki'},'Chainsaw Man Reze')
    assert not catalog.search_title_matches({'title':'Боец-презерватив Горо'},'Резе')
    assert catalog.search_title_matches({'title':'История Резе','original_title':'Gekijouban Chainsaw Man Reze Hen'},'Chainsaw Man: Reze-hen')
    assert catalog.search_title_matches({'title':'Different display title','aliases':['Chainsaw Man Reze']},'Reze')


def test_catalog_fallback_is_explicit_and_cursors_never_silently_fall_back(monkeypatch):
    monkeypatch.setattr(watch_catalog,'page',lambda *args:(_ for _ in ()).throw(RuntimeError('unavailable')))
    monkeypatch.setattr(catalog,'catalog_data',lambda **kwargs:{'items':[{'id':'lib-1','playable':True}],'total_pages':5})
    first=catalog.browse_catalog()
    assert first['source']=='aniliberty' and first['degraded'] is True and first['has_next'] is False
    with pytest.raises(HTTPException) as failure:catalog.browse_catalog(cursor='a'*32)
    assert failure.value.status_code==502
