"""Provider adapters, cached metadata and federated search (no title-only dedup)."""
import hashlib
import html
import json
import os
import re
import sqlite3
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urljoin
import requests
from fastapi import APIRouter, HTTPException, Query
from anime_dl_core.sources import AnimeGo, Animedia, Alloha
from . import kodik
from .settings import catalog_db_path

router = APIRouter(prefix='/api')
LIB = 'https://anilibria.top'
ANILIST = 'https://graphql.anilist.co'
PROXY = os.getenv('ANIME_PROXY')
DB = catalog_db_path()
cache = {}
cache_lock = threading.Lock()
provider_states = {}
SOURCE_NAMES = {'aniliberty':'AniLibria.TV', 'anilist':'AniList', 'animego':'AnimeGO', 'animedia':'Animedia', 'alloha':'Alloha', 'kodik':'Kodik', 'animelib':'AnimeLib', 'animevost':'AnimeVost'}
FIELDS = '''id idMal title { romaji english native } coverImage { extraLarge large } bannerImage description(asHtml:false) format status seasonYear episodes duration averageScore popularity genres siteUrl studios(isMain:true){nodes{name}} relations{edges{relationType node{id title{romaji} coverImage{large} type}}}'''


def cached(key, function, ttl=180):
    with cache_lock:
        value = cache.get(key)
        if value and value[0] > time.monotonic():
            return value[1]
    data = function()
    with cache_lock:
        if len(cache) > 300:
            cache.clear()
        cache[key] = (time.monotonic()+ttl, data)
    return data


def remote(url, params=None, body=None):
    proxies = {'http': PROXY, 'https': PROXY} if PROXY else None
    def fetch():
        with requests.Session() as session:
            r = session.request('POST' if body is not None else 'GET', url, params=params, json=body,
                headers={'Accept':'application/json', 'User-Agent':'DeltaAnime/0.2 (local prototype)'},
                timeout=(4, 9), proxies=proxies)
            r.raise_for_status()
            data = r.json()
            if isinstance(data, dict) and data.get('errors'):
                raise ValueError('API rejected request')
            return data
    return cached(json.dumps([url, params, body],sort_keys=True), fetch)


def save(item, lookup=None):
    with sqlite3.connect(DB) as db:
        db.execute('CREATE TABLE IF NOT EXISTS titles (id TEXT PRIMARY KEY, item TEXT, lookup TEXT)')
        db.execute('INSERT OR REPLACE INTO titles VALUES (?,?,?)', (item['id'],json.dumps(item),json.dumps(lookup or {})))
    return item


def saved(key):
    with sqlite3.connect(DB) as db:
        db.execute('CREATE TABLE IF NOT EXISTS titles (id TEXT PRIMARY KEY, item TEXT, lookup TEXT)')
        row=db.execute('SELECT item,lookup FROM titles WHERE id=?',(key,)).fetchone()
    if not row:
        raise HTTPException(404,'Тайтл не найден. Выполните поиск ещё раз.')
    return json.loads(row[0]), json.loads(row[1])


def plain(value):
    if isinstance(value,dict):
        return (str(value.get('text','')) + ''.join(plain(child) for child in value.get('content',[])) + ('\n' if value.get('type')=='paragraph' else '')).replace('\\n','\n')
    if isinstance(value,list):return '\n'.join(plain(v) for v in value)
    return html.unescape(re.sub(r'<[^>]*>', '', (value or '').replace('<br>', '\n').replace('<br />','\n')))


def normalize_lib(a):
    poster=a.get('poster') or {}
    rating=(a.get('shikimori') or {}).get('rating') or (a.get('mal') or {}).get('rating')
    return {'id':f"lib-{a['id']}", 'title':a['name']['main'], 'original_title':a['name'].get('english'),
        'poster':urljoin(LIB,(poster.get('optimized') or {}).get('src') or poster.get('src') or ''),
        'provider':'AniLibria.TV','source':'aniliberty','description':plain(a.get('description')),
        'year':a.get('year'),'format':(a.get('type') or {}).get('value'),
        'status':'Сейчас выходит' if a.get('is_ongoing') else 'Завершён',
        'rating':rating,'rating_source':'Shikimori' if (a.get('shikimori') or {}).get('rating') else 'MAL',
        'genres':[g['name'] for g in a.get('genres',[])], 'genre_ids':[g['id'] for g in a.get('genres',[])],
        'episodes_total':a.get('episodes_total'),'duration':a.get('average_duration_of_episode'),
        'mal_id':(a.get('mal') or {}).get('id'),'shikimori_id':(a.get('shikimori') or {}).get('id'),
        'age':(a.get('age_rating') or {}).get('label'),'playable':not(a.get('is_blocked_by_geo') or a.get('is_blocked_by_copyrights')),
        'notification':a.get('notification'), 'url':f"{LIB}/anime/releases/release/{a.get('alias',a['id'])}",
        'banner':urljoin(LIB,a['background_covers'][0]['preview']) if a.get('background_covers') else None}


def normalize_list(a):
    return {'id':f"al-{a['id']}",'title':a['title'].get('english') or a['title']['romaji'],
        'original_title':a['title']['romaji'],'poster':a['coverImage'].get('extraLarge') or a['coverImage'].get('large'),
        'banner':a.get('bannerImage'),'provider':'AniList','source':'anilist','description':plain(a.get('description')),
        'year':a.get('seasonYear'),'format':a.get('format'),'status':{'RELEASING':'Сейчас выходит','FINISHED':'Завершён','NOT_YET_RELEASED':'Анонс'}.get(a.get('status'),a.get('status')),
        'rating':a['averageScore']/10 if a.get('averageScore') else None,'rating_source':'AniList',
        'genres':a.get('genres',[]),'episodes_total':a.get('episodes'),'duration':a.get('duration'),
        'mal_id':a.get('idMal'),'playable':False,'url':a.get('siteUrl'),
        'studios':[x['name'] for x in a.get('studios',{}).get('nodes',[])],
        'relations':[{'id':f"al-{e['node']['id']}",'title':e['node']['title']['romaji'],'poster':e['node']['coverImage']['large'],'relation':e['relationType']} for e in a.get('relations',{}).get('edges',[]) if e['node']['type']=='ANIME']}


def lib_release(key):
    a=remote(f'{LIB}/api/v1/anime/releases/{key}')
    if a.get('is_blocked_by_geo') or a.get('is_blocked_by_copyrights'):
        raise HTTPException(403,'Релиз недоступен у источника в текущей сети.')
    return a


def catalog_data(page=1, sort='fresh', genre='', year=None, kind='', status='', q='', limit=24):
    filters={'sorting':{'fresh':'FRESH_AT_DESC','rating':'RATING_DESC','year':'YEAR_DESC'}[sort]}
    if genre: filters['genres']=[int(genre)]
    if year: filters['years']={'from_year':year,'to_year':year}
    if kind: filters['types']=[kind]
    if status: filters['publish_statuses']=['IS_ONGOING' if status=='ongoing' else 'IS_NOT_ONGOING']
    if q: filters['search']=q
    data=remote(f'{LIB}/api/v1/anime/catalog/releases',body={'page':page,'limit':limit,'f':filters})
    return {'items':[normalize_lib(a) for a in data['data']], **data['meta']['pagination']}


def list_query(q='', page=1, top=False):
    query='query($q:String,$page:Int,$sort:[MediaSort]){Page(page:$page,perPage:24){pageInfo{hasNextPage} media(type:ANIME,isAdult:false,search:$q,sort:$sort){'+FIELDS+'}}}'
    data=remote(ANILIST,body={'query':query,'variables':{'q':q or None,'page':page,'sort':['SCORE_DESC'] if top else ['SEARCH_MATCH']}})['data']['Page']
    return {'items':[normalize_list(a) for a in data['media']], 'has_next':data['pageInfo']['hasNextPage']}


def search_provider(provider, q):
    started=time.monotonic()
    try:
        if provider in ('animelib','animevost'):
            from . import providers
            items=providers.search(provider,q)
        elif provider=='aniliberty':
            items=catalog_data(q=q)['items']
        elif provider=='anilist':
            items=list_query(q)['items']
        elif provider=='animego':
            with AnimeGo(mirror=os.getenv('ANIMEGO_MIRROR','animego.me'),proxy=PROXY,timeout=8) as site:
                items=[save({**a.to_dict(),'provider':'AnimeGO','source':provider,'playable':True}, {'url':a.url}) for a in site.search(q,limit=20)]
        elif provider=='animedia':
            with Animedia(proxy=PROXY,timeout=8) as site:
                found=site.search(q,limit=12)
            def enrich(a):
                try:
                    with Animedia(proxy=PROXY,timeout=5) as page:
                        a=page.info(a.url)
                except Exception:
                    pass
                return save({**a.to_dict(),'id':'amd-'+a.id,'provider':'Animedia','source':provider,'playable':True}, {'url':a.url})
            with ThreadPoolExecutor(max_workers=4) as pool:
                items=list(pool.map(enrich,found))
        elif provider=='alloha':
            with Alloha(proxy=PROXY,timeout=8,**({'token':os.environ['ALLOHA_TOKEN']} if os.getenv('ALLOHA_TOKEN') else {})) as site:
                a=site.find(name=q)
                if a.category not in ('аниме','мультсериал','мультфильм','сериал'):
                    items=[]
                else:
                    key=hashlib.sha256(f'{a.id_kp}:{a.id_imdb}:{a.name}:{a.year}'.encode()).hexdigest()[:20]
                    lookup={'kp':a.id_kp} if a.id_kp else {'name':a.name}
                    items=[save({'id':'all-'+key,'title':a.name,'original_title':a.original_name,'year':a.year,
                        'poster':a.poster,'description':plain(a.description),'provider':'Alloha','source':provider,
                        'rating':a.rating_kp,'rating_source':'Кинопоиск','playable':True,'seasons':sorted(a.seasons)},lookup)]
        elif provider=='kodik':
            items=kodik_search(q)
        else:
            raise HTTPException(400,'Неизвестный источник')
        result={'items':items,'source':provider,'status':'ok','count':len(items)}
    except HTTPException:
        raise
    except Exception as exc:
        if isinstance(exc,kodik.TokenUnavailable):
            result={'items':[],'source':provider,'status':'needs_key','message':'Общий токен Kodik недоступен. Повторите позже или настройте собственный KODIK_TOKEN.'}
        elif type(exc).__name__=='NotFound':
            result={'items':[],'source':provider,'status':'ok','count':0}
        else:
            result={'items':[],'source':provider,'status':'error','message':'Источник не отвечает или изменил формат данных. Повторите позже.'}
    result['elapsed_ms']=round((time.monotonic()-started)*1000)
    provider_states[provider]={k:v for k,v in result.items() if k!='items'}
    return result


def merge_results(items):
    merged={}
    for item in items:
        # MAL is a cross-provider identity; title strings are deliberately not used.
        identity='mal:'+str(item['mal_id']) if item.get('mal_id') else item['id']
        if identity not in merged:
            merged[identity]={**item,'variants':[{'id':item['id'],'provider':item['provider'],'playable':item.get('playable',False)}]}
        else:
            current=merged[identity]
            if not any(v['id']==item['id'] for v in current['variants']):
                current['variants'].append({'id':item['id'],'provider':item['provider'],'playable':item.get('playable',False)})
            if item.get('playable') and not current.get('playable'):
                merged[identity]={**item,'variants':current['variants']}
    return list(merged.values())


@router.get('/sources')
def sources():
    entries=[{'id':key,'name':name,'search':key!='kodik' or kodik.enabled(),
        'type':'Метаданные и мировой топ' if key=='anilist' else 'Каталог и просмотр',
        'state':provider_states.get(key,{}).get('status','needs_key' if key=='kodik' and not kodik.enabled() else 'not_checked'),
        'note':'Поиск по названию на латинице' if key=='anilist' else ('Нужен серверный KODIK_TOKEN' if key=='kodik' and not kodik.enabled() else 'Проверяется при поиске')} for key,name in SOURCE_NAMES.items()]
    entries += [{'id':'shikimori','name':'Shikimori','search':False,'type':'Метаданные','state':'unavailable','note':'Прямой API недоступен из текущей сети; рейтинги приходят через AniLiberty'},
        {'id':'jikan','name':'Jikan / MyAnimeList','search':False,'type':'Метаданные','state':'unavailable','note':'TLS-соединение не устанавливается; вместо него подключён AniList'},
        {'id':'jutsu','name':'JutSu','search':False,'type':'Просмотр','state':'not_integrated','note':'В AnimeParsers нет общего поиска JutSu; адаптер ещё не подключён'}]
    notes={'kodik':'Поиск, серии и озвучки. Используется собственный KODIK_TOKEN или опубликованный общий токен AnimeParsers.', 'aniliberty':'Прямой каталог AniLibria.TV через актуальный API AniLiberty: поиск, серии, HLS и таймкоды.', 'animevost':'Собственная озвучка AnimeVost; проверен MP4 с перемоткой.', 'animelib':'Команды озвучки, серии, Kodik и собственные видео. Недоступные релизы исключаются источником.', 'alloha':'Одно совпадение за запрос; просмотр через внешний плеер.'}
    for entry in entries:
        if entry['id'] in notes:entry['note']=notes[entry['id']]
    research=json.loads((Path(__file__).parent/'source_inventory.json').read_text())
    return {'sources':entries,'research':research}


@router.get('/search')
def search(q:str=Query(min_length=2,max_length=100), provider:str='all'):
    if provider!='all':
        if provider not in SOURCE_NAMES: raise HTTPException(400,'Неизвестный источник')
        return cached(('search',provider,q),lambda:search_provider(provider,q),60)
    providers=[s['id'] for s in sources()['sources'] if s['search']]
    outcomes=[]
    with ThreadPoolExecutor(max_workers=len(providers)) as pool:
        jobs=[pool.submit(search,q,p) for p in providers]
        for job in as_completed(jobs): outcomes.append(job.result())
    return {'items':merge_results([i for result in outcomes for i in result['items']]),'sources':[{k:v for k,v in r.items() if k!='items'} for r in outcomes]}


@router.get('/catalog')
def catalog(page:int=Query(1,ge=1,le=1000),sort:str=Query('fresh',pattern='^(fresh|rating|year)$'),
            genre:str=Query('',pattern=r'^\d*$'),year:int|None=Query(None,ge=1900,le=2100),
            kind:str=Query('',pattern='^(|TV|ONA|OVA|OAD|MOVIE|SPECIAL|WEB|DORAMA)$'),
            status:str=Query('',pattern='^(|ongoing|finished)$')):
    try:return catalog_data(page,sort,genre,year,kind,status)
    except Exception as exc:raise HTTPException(502,'Каталог временно недоступен. Попробуйте повторить.') from exc


@router.get('/genres')
def genres():
    try:return [{'id':g['id'],'name':g['name']} for g in remote(f'{LIB}/api/v1/anime/genres')]
    except Exception as exc:raise HTTPException(502,'Не удалось получить жанры') from exc


@router.get('/top')
def top(page:int=Query(1,ge=1,le=1000)):
    try:return list_query(page=page,top=True)
    except Exception as exc:raise HTTPException(502,'Мировой топ AniList временно недоступен') from exc


@router.get('/titles/{key}')
def detail(key:str):
    if key.startswith('a365-'):raise HTTPException(410,'Источник удалён. Найдите аниме в других источниках.')
    try:
        if key.startswith(('aml-','av-')):
            from . import providers
            return providers.detail(key)
        if re.fullmatch(r'lib-\d+',key):
            a=remote(f'{LIB}/api/v1/anime/releases/{key[4:]}')
            result=normalize_lib(a)
            result['available_episodes']=len(a.get('episodes',[]))
            result['studios']=list(dict.fromkeys(m.get('nickname') for m in a.get('members',[]) if m.get('role',{}).get('value')=='voice' and m.get('nickname')))
            return result
        if re.fullmatch(r'al-\d+',key):
            data=remote(ANILIST,body={'query':'query($id:Int){Media(id:$id,type:ANIME){'+FIELDS+'}}','variables':{'id':int(key[3:])}})
            return normalize_list(data['data']['Media'])
        item,lookup=saved(key)
        if key.startswith('amd-'):
            with Animedia(proxy=PROXY,timeout=8) as site:
                a=site.info(lookup['url']);item.update(title=a.title,poster=a.poster)
                save(item,lookup)
        return item
    except HTTPException:raise
    except Exception as exc:raise HTTPException(502,'Информация об аниме временно недоступна') from exc


@router.get('/titles/{key}/versions')
def versions(key:str,provider:str):
    if provider not in SOURCE_NAMES or provider=='anilist':raise HTTPException(400,'Неизвестный видеоисточник')
    item=detail(key)
    if provider==item.get('source'):return {'items':[],'source':provider,'status':'ok'}
    # Exact external identifiers auto-link. Name matches require an explicit viewer choice.
    if provider=='kodik' and (item.get('mal_id') or item.get('shikimori_id')):
        try:outcome={'items':kodik_search(shikimori_id=item.get('mal_id') or item.get('shikimori_id')),'source':provider,'status':'ok'}
        except Exception:return {'items':[],'source':provider,'status':'error'}
    else:outcome=search(item.get('original_title') or item['title'],provider)
    candidates=[]
    for other in outcome['items']:
        if other['id']==key or not other.get('playable'):continue
        left=item.get('mal_id') or item.get('shikimori_id')
        right=other.get('mal_id') or other.get('shikimori_id')
        if left and right and str(left)!=str(right):continue
        candidates.append({**other,'match':'exact' if left and right and str(left)==str(right) else 'candidate'})
    return {**outcome,'items':candidates}


def kodik_search(q=None,shikimori_id=None):
    query={'shikimori_id':str(shikimori_id)} if shikimori_id else {'title':q,'strict':'true'}
    params={**query,'types':'anime,anime-serial','with_material_data':'true','limit':100}
    data=cached(('kodik-search',q,shikimori_id),lambda:kodik.request(params),120)
    items={}
    for a in data['results']:
        m=a.get('material_data') or {}
        if m.get('rating_mpaa')=='rx':continue
        shiki=a.get('shikimori_id')
        key='kd-shiki-'+str(shiki) if shiki else 'kd-'+a['id']
        if key in items:continue
        lookup={'shikimori_id':str(shiki)} if shiki else {'id':a['id']}
        items[key]=save({'id':key,'title':a['title'],'original_title':a.get('title_orig'),'provider':'Kodik','source':'kodik',
            'playable':True,'poster':m.get('anime_poster_url') or m.get('poster_url'),'year':a.get('year'),
            'description':plain(m.get('anime_description') or m.get('description')),'shikimori_id':shiki,
            'mal_id':int(shiki) if shiki and str(shiki).isdigit() else None,'genres':m.get('anime_genres') or [],
            'rating':m.get('shikimori_rating'),'rating_source':'Shikimori','episodes_total':a.get('episodes_count'),
            'format':m.get('anime_kind'),'status':m.get('anime_status')},lookup)
    return list(items.values())
