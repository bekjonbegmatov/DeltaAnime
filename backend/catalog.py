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
SOURCE_NAMES = {'aniliberty':'AniLibria.TV', 'anilist':'AniList', 'shikimori':'Shikimori', 'kitsu':'Kitsu', 'animego':'AnimeGO', 'animedia':'Animedia', 'alloha':'Alloha', 'kodik':'Kodik', 'animelib':'AnimeLib', 'animevost':'AnimeVost'}
METADATA_SOURCES = {'anilist', 'shikimori', 'kitsu'}
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
    available=sum(1 for episode in a.get('episodes',[]) if episode.get('ordinal')
                  and any(episode.get('hls_'+quality) for quality in ('480','720','1080')))
    return {'id':f"lib-{a['id']}", 'title':a['name']['main'], 'original_title':a['name'].get('english'),
        'poster':urljoin(LIB,(poster.get('optimized') or {}).get('src') or poster.get('src') or ''),
        'provider':'AniLibria.TV','source':'aniliberty','description':plain(a.get('description')),
        'year':a.get('year'),'format':(a.get('type') or {}).get('value'),
        'status':'Сейчас выходит' if a.get('is_ongoing') else 'Завершён',
        'rating':rating,'rating_source':'Shikimori' if (a.get('shikimori') or {}).get('rating') else 'MAL',
        'genres':[g['name'] for g in a.get('genres',[])], 'genre_ids':[g['id'] for g in a.get('genres',[])],
        'episodes_total':a.get('episodes_total'),'duration':a.get('average_duration_of_episode'),
        'mal_id':(a.get('mal') or {}).get('id'),'shikimori_id':(a.get('shikimori') or {}).get('id'),
        'age':(a.get('age_rating') or {}).get('label'),'available_episodes':available,
        'playable':available>0 and not(a.get('is_blocked_by_geo') or a.get('is_blocked_by_copyrights')),
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
    rows=data['data']
    # Catalog summaries omit all episode links. Fetch availability in one batch
    # instead of advertising announced/empty releases as watchable.
    releases=remote(f'{LIB}/api/v1/anime/releases/list',params={
        'ids':','.join(str(a['id']) for a in rows),'limit':limit,
        'include':'id,episodes.ordinal,episodes.hls_480,episodes.hls_720,episodes.hls_1080,is_blocked_by_geo,is_blocked_by_copyrights'}) if rows else {'data':[]}
    availability={a['id']:a for a in releases['data']}
    items=[normalize_lib({**a,**availability.get(a['id'],{})}) for a in rows]
    pagination={k:v for k,v in data['meta']['pagination'].items() if k!='total'}
    return {'items':[a for a in items if a['playable']], **pagination}


def list_query(q='', page=1, top=False):
    query='query($q:String,$page:Int,$sort:[MediaSort]){Page(page:$page,perPage:24){pageInfo{hasNextPage} media(type:ANIME,isAdult:false,search:$q,sort:$sort){'+FIELDS+'}}}'
    data=remote(ANILIST,body={'query':query,'variables':{'q':q or None,'page':page,'sort':['SCORE_DESC'] if top else ['SEARCH_MATCH']}})['data']['Page']
    return {'items':[normalize_list(a) for a in data['media']], 'has_next':data['pageInfo']['hasNextPage']}


def search_title_matches(item,q):
    """Guard against mirrors returning their front page instead of search data."""
    normalize=lambda value:' '.join(re.findall(r'\w+',str(value).casefold(),flags=re.UNICODE))
    query=normalize(q)
    names=[normalize(item.get(field) or '') for field in ('title','original_title','other_title','aliases')]
    words=[word for word in query.split() if len(word)>2]
    return bool(query) and any((' '+query) in (' '+name) or any(
        candidate.startswith(word) for word in words for candidate in name.split()) for name in names)


def search_provider(provider, q):
    started=time.monotonic()
    try:
        if provider in ('shikimori','kitsu'):
            from . import metadata
            items=metadata.search(provider,q)
        elif provider in ('animelib','animevost'):
            from . import providers
            items=providers.search(provider,q)
        elif provider=='aniliberty':
            items=catalog_data(q=q)['items']
        elif provider=='anilist':
            items=list_query(q)['items']
        elif provider=='animego':
            with AnimeGo(mirror=os.getenv('ANIMEGO_MIRROR','animego.me'),proxy=PROXY,timeout=8) as site:
                items=[save({**a.to_dict(),'provider':'AnimeGO','source':provider,'playable':True}, {'url':a.url}) for a in site.search(q,limit=20)
                       if search_title_matches(a.to_dict(),q)]
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
            items=kodik_discover(q)
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
        'type':'Метаданные' if key in METADATA_SOURCES else 'Каталог и просмотр',
        'playback':key not in METADATA_SOURCES,
        'state':provider_states.get(key,{}).get('status','needs_key' if key=='kodik' and not kodik.enabled() else 'not_checked'),
        'note':'Поиск по названию на латинице' if key=='anilist' else ('Нужен серверный KODIK_TOKEN' if key=='kodik' and not kodik.enabled() else 'Проверяется при поиске')} for key,name in SOURCE_NAMES.items()]
    entries += [{'id':'jikan','name':'Jikan / MyAnimeList','search':False,'playback':False,'type':'Метаданные','state':'unavailable','note':'Проверка 07.11: API не ответил за отведённое время; адаптер не подключён'},
        {'id':'jutsu','name':'JutSu','search':False,'type':'Просмотр','state':'not_integrated','note':'В AnimeParsers нет общего поиска JutSu; адаптер ещё не подключён'}]
    notes={'kodik':'Поиск, серии и озвучки. Используется собственный KODIK_TOKEN или опубликованный общий токен AnimeParsers.', 'aniliberty':'Прямой каталог AniLibria.TV через актуальный API AniLiberty: поиск, серии, HLS и таймкоды.', 'animevost':'Собственная озвучка AnimeVost; проверен MP4 с перемоткой.', 'animelib':'Команды озвучки, серии, Kodik и собственные видео. Недоступные релизы исключаются источником.', 'alloha':'Одно совпадение за запрос; просмотр через внешний плеер.', 'shikimori':'Русские названия, описания, жанры и оценки. Только информация об аниме, без видео.', 'kitsu':'Постеры, обложки, описания и оценки. Лучше ищет по названию на латинице; видеопотоков нет.'}
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


def browse_catalog(provider='kodik',page=1,sort='fresh',genre='',year=None,kind='',status='',cursor=None):
    from . import watch_catalog
    if provider=='kodik':
        if genre.isdigit():
            match=next((g['name'] for g in remote(f'{LIB}/api/v1/anime/genres') if str(g['id'])==genre),None)
            if not match:raise HTTPException(400,'Неизвестный жанр')
            genre=match
        try:return watch_catalog.page(sort,genre,year,kind,status,cursor)
        except HTTPException:raise
        except Exception:
            if cursor:raise HTTPException(502,'Не удалось загрузить следующую страницу Kodik. Повторите позже.')
            # A different catalog has different cursors and genre IDs. Only the
            # initial page may fall back, and its source is explicit in the UI.
            if genre:
                match=next((str(g['id']) for g in remote(f'{LIB}/api/v1/anime/genres') if g['name'].casefold()==genre.casefold()),None)
                if not match:raise HTTPException(502,'Каталог Kodik временно недоступен для выбранных фильтров')
                genre=match
            result=catalog_data(page=1,sort=sort,genre=genre,year=year,kind=kind,status=status)
            return {**result,'items':[a for a in result['items'] if a.get('playable')],
                    'source':'aniliberty','page':1,'has_next':False,'degraded':True,
                    'note':'Kodik временно не ответил. Показаны доступные релизы AniLibria.TV; выберите этот источник для продолжения.'}
    if cursor:raise HTTPException(400,'Курсор Kodik нельзя использовать для другого источника')
    if genre and not genre.isdigit():raise HTTPException(400,'Некорректный жанр AniLibria.TV')
    result=catalog_data(page,sort,genre,year,kind,status)
    return {**result,'items':[a for a in result['items'] if a.get('playable')],
            'source':'aniliberty','page':page,'has_next':page<result.get('total_pages',1)}


@router.get('/catalog')
def catalog(page:int=Query(1,ge=1,le=1000),sort:str=Query('fresh',pattern='^(fresh|rating|year)$'),
            genre:str=Query('',max_length=80),year:int|None=Query(None,ge=1900,le=2100),
            kind:str=Query('',pattern='^(|TV|ONA|OVA|OAD|MOVIE|SPECIAL|WEB|DORAMA|MUSIC)$'),
            status:str=Query('',pattern='^(|ongoing|finished)$'),
            provider:str=Query('kodik',pattern='^(kodik|aniliberty)$'),cursor:str|None=Query(None,max_length=64)):
    try:return browse_catalog(provider,page,sort,genre,year,kind,status,cursor)
    except HTTPException:raise
    except Exception as exc:raise HTTPException(502,'Каталог временно недоступен. Попробуйте повторить.') from exc


@router.get('/genres')
def genres(provider:str=Query('kodik',pattern='^(kodik|aniliberty)$')):
    if provider=='kodik':
        from .watch_catalog import GENRES
        return [{'id':name,'name':name} for name in GENRES]
    try:return [{'id':g['id'],'name':g['name']} for g in remote(f'{LIB}/api/v1/anime/genres')]
    except Exception as exc:raise HTTPException(502,'Не удалось получить жанры') from exc


@router.get('/top')
def top(page:int=Query(1,ge=1,le=1000),cursor:str|None=Query(None,max_length=64)):
    try:return browse_catalog(sort='rating',cursor=cursor)
    except HTTPException:raise
    except Exception as exc:raise HTTPException(502,'Топ доступных аниме временно недоступен') from exc


@router.get('/titles/{key}')
def detail(key:str):
    if key.startswith('a365-'):raise HTTPException(410,'Источник удалён. Найдите аниме в других источниках.')
    try:
        if key.startswith(('shiki-','kitsu-')):
            from . import metadata
            return metadata.detail(key)
        if key.startswith(('aml-','av-')):
            from . import providers
            return providers.detail(key)
        if re.fullmatch(r'lib-\d+',key):
            a=remote(f'{LIB}/api/v1/anime/releases/{key[4:]}')
            result=normalize_lib(a)
            result['studios']=list(dict.fromkeys(m.get('nickname') for m in a.get('members',[]) if m.get('role',{}).get('value')=='voice' and m.get('nickname')))
            return result
        if re.fullmatch(r'al-\d+',key):
            data=remote(ANILIST,body={'query':'query($id:Int){Media(id:$id,type:ANIME){'+FIELDS+'}}','variables':{'id':int(key[3:])}})
            return normalize_list(data['data']['Media'])
        item,lookup=saved(key)
        if key.startswith('kd-'):
            # Older cached cards treated Shikimori's number as a MAL ID. Only
            # retain an explicitly recorded upstream MAL mapping on reopen.
            item['mal_id']=lookup.get('mal_id')
        if key.startswith('amd-'):
            with Animedia(proxy=PROXY,timeout=8) as site:
                a=site.info(lookup['url']);item.update(title=a.title,poster=a.poster)
                save(item,lookup)
        return item
    except HTTPException:raise
    except Exception as exc:raise HTTPException(502,'Информация об аниме временно недоступна') from exc


@router.get('/titles/{key}/versions')
def versions(key:str,provider:str):
    if provider not in SOURCE_NAMES or provider in METADATA_SOURCES:raise HTTPException(400,'Неизвестный видеоисточник')
    item=detail(key)
    if provider==item.get('source'):return {'items':[],'source':provider,'status':'ok'}
    # Exact external identifiers auto-link. Name matches require an explicit viewer choice.
    if provider=='kodik' and (item.get('shikimori_id') or item.get('mal_id')):
        try:
            shiki=resolve_shikimori_id(item)
            if shiki:
                item={**item,'shikimori_id':shiki}
                outcome={'items':kodik_search(shikimori_id=shiki),'source':provider,'status':'ok'}
            else:outcome=search(item.get('original_title') or item['title'],provider)
        except Exception:return {'items':[],'source':provider,'status':'error'}
    else:outcome=search(item.get('original_title') or item['title'],provider)
    candidates=[]
    for other in outcome['items']:
        if other['id']==key or not other.get('playable'):continue
        # IDs only identify a release within their own namespace. Any shared
        # conflicting ID rejects a candidate, even if another namespace agrees.
        shared=[(item[field],other[field]) for field in ('mal_id','shikimori_id')
                if item.get(field) and other.get(field)]
        if any(str(left)!=str(right) for left,right in shared):continue
        candidates.append({**other,'match':'exact' if shared else 'candidate'})
    return {**outcome,'items':candidates}


def kodik_search(q=None,shikimori_id=None):
    query={'shikimori_id':str(shikimori_id)} if shikimori_id else {'title':q,'strict':'true'}
    params={**query,'types':'anime,anime-serial','with_material_data':'true','with_seasons':'true','limit':100}
    data=cached(('kodik-search',q,shikimori_id),lambda:kodik.request(params),120)
    return normalize_kodik_rows(data['results'])


def normalize_kodik_rows(rows):
    from .watch_catalog import playable_kodik
    items={}
    for a in rows:
        m=a.get('material_data') or {}
        if m.get('rating_mpaa')=='rx' or not playable_kodik(a):continue
        from .metadata import positive_int
        shiki=positive_int(a.get('shikimori_id'))
        key='kd-shiki-'+str(shiki) if shiki else 'kd-'+a['id']
        available=int(a.get('episodes_count') or 0) if a.get('type')=='anime-serial' else 1
        if key in items:
            items[key]['available_episodes']=max(items[key].get('available_episodes') or 0,available)
            continue
        lookup={'shikimori_id':str(shiki)} if shiki else {'id':a['id']}
        raw_mal=a.get('mal_id') or a.get('myanimelist_id') or m.get('mal_id') or m.get('myanimelist_id')
        mal_id=int(raw_mal) if re.fullmatch(r'[1-9]\d*',str(raw_mal or '')) else None
        if mal_id:lookup['mal_id']=mal_id
        screenshots=m.get('screenshots') or a.get('screenshots') or []
        item={'id':key,'title':a['title'],'original_title':a.get('title_orig'),'provider':'Kodik','source':'kodik',
            'playable':True,'poster':m.get('anime_poster_url') or m.get('poster_url'),'year':a.get('year'),
            'banner':next((x for x in screenshots if isinstance(x,str) and x.startswith('https://')),None),
            'description':plain(m.get('anime_description') or m.get('description')),'shikimori_id':shiki,
            'mal_id':mal_id,'genres':m.get('anime_genres') or [],'duration':m.get('duration'),
            'rating':m.get('shikimori_rating'),'rating_source':'Shikimori',
            'episodes_total':m.get('episodes_total') or available,'available_episodes':available,
            'format':m.get('anime_kind') or ('movie' if a.get('type')=='anime' else 'tv'),
            'status':m.get('anime_status'),'studios':m.get('anime_studios') or [],
            'age':str(m['minimal_age'])+'+' if m.get('minimal_age') is not None else None}
        items[key]=save(item,lookup)
    return list(items.values())


def kodik_discover(q):
    """Resolve title aliases through explicit Shikimori IDs, never title equality."""
    items={item['id']:item for item in kodik_search(q)}
    from . import metadata
    try:candidates=[candidate for candidate in metadata.search('shikimori',q) if search_title_matches(candidate,q)][:3]
    except Exception:return list(items.values())
    missing=[candidate for candidate in candidates if 'kd-shiki-'+str(candidate['shikimori_id']) not in items]
    def resolve(candidate):
        try:
            found=kodik_search(shikimori_id=candidate['shikimori_id'])
            return [item for item in found if str(item.get('shikimori_id'))==str(candidate['shikimori_id'])]
        except Exception:return []
    with ThreadPoolExecutor(max_workers=3) as pool:
        for found in pool.map(resolve,missing):
            for item in found:items[item['id']]=item
    return list(items.values())


def resolve_shikimori_id(item):
    """Find a Shikimori ID for metadata only after verifying its explicit MAL."""
    if item.get('shikimori_id'):return item['shikimori_id']
    if not item.get('mal_id'):return None
    from . import metadata
    def resolve():
        candidates=metadata.search('shikimori',item.get('original_title') or item['title'])[:4]
        for candidate in candidates:
            try:
                card=metadata.detail(candidate['id'])
                if card.get('mal_id') and str(card['mal_id'])==str(item['mal_id']):return card['shikimori_id']
            except Exception:continue
        return None
    return cached(('mal-to-shiki',str(item['mal_id'])),resolve,3600)


@router.get('/titles/{key}/watchable')
def watchable(key:str):
    item=detail(key)
    if item.get('playable'):return {'item':item,'status':'ok'}
    try:
        shiki=resolve_shikimori_id(item)
        if not shiki:return {'item':None,'status':'unavailable'}
        found=kodik_search(shikimori_id=shiki)
        video=next((a for a in found if str(a.get('shikimori_id'))==str(shiki)
                    and not (item.get('mal_id') and a.get('mal_id') and str(item['mal_id'])!=str(a['mal_id']))),None)
        if video:
            for field in ('poster','banner','description','genres','duration','studios','year'):
                if not video.get(field) and item.get(field):video[field]=item[field]
            if item.get('mal_id'):video={**video,'mal_id':item['mal_id']}
            _,lookup=saved(video['id'])
            if video.get('mal_id'):lookup['mal_id']=video['mal_id']
            save(video,lookup)
        return {'item':video,'status':'ok' if video else 'unavailable'}
    except Exception:return {'item':None,'status':'error','message':'Не удалось проверить доступность просмотра. Повторите позже.'}
