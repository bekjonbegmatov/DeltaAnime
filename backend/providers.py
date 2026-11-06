"""Public source APIs. Requests are bounded; video URLs are resolved per episode.
Protocol references and integration limits: docs/SOURCES.md.
"""
import re
from urllib.parse import urljoin
import requests
from fastapi import HTTPException

ANIMELIB = 'https://api.cdnlibs.org/api'
VOST = 'https://api.animevost.org/v1'


def fetch(url, params=None, form=None, headers=None):
    from . import catalog as c
    def request():
        with requests.Session() as session:
            r=session.request('POST' if form is not None else 'GET',url,params=params,data=form,
                headers={'User-Agent':'DeltaAnime/0.3','Accept':'application/json',**(headers or {})},
                proxies={'http':c.PROXY,'https':c.PROXY} if c.PROXY else None,timeout=(4,10))
            r.raise_for_status()
            data=r.json()
            if isinstance(data,dict) and (data.get('error') or data.get('errors')):raise ValueError('Source rejected request')
            return data
    return c.cached(('public-api',url,str(params),str(form)),request,120)


def lib(path,params=None):
    return fetch(ANIMELIB+path,params,headers={'Site-Id':'5','Referer':'https://animelib.org/'})


def normalize_lib(a):
    from . import catalog as c
    shiki=re.search(r'/animes/(?:[a-z]-)?(\d+)',a.get('shikimori_href') or '')
    year=re.search(r'\b(19\d{2}|20\d{2})\b',a.get('releaseDateString') or '')
    return {'id':f"aml-{a['id']}",'title':a.get('rus_name') or a['name'],'original_title':a['name'],
        'provider':'AnimeLib','source':'animelib','poster':a.get('cover',{}).get('default'),
        'description':c.plain(a.get('summary')),'genres':[g['name'] for g in a.get('genres',[])],
        'year':int(year[1]) if year else None,'shikimori_id':int(shiki[1]) if shiki else None,
        'mal_id':int(shiki[1]) if shiki else None,'rating':a.get('shiki_rate'),'rating_source':'Shikimori',
        'format':a.get('type',{}).get('label'),'status':a.get('status',{}).get('label'),
        'playable':not a.get('is_licensed',False),'url':'https://animelib.org/ru/anime/'+a['slug_url']}


def normalize_vost(a):
    from . import catalog as c
    title=re.sub(r'\s*\[[^]]*\]\s*$','',a['title']).strip().split(' / ',1)
    return {'id':f"av-{a['id']}",'title':title[0],'original_title':title[1] if len(title)>1 else None,
        'provider':'AnimeVost','source':'animevost','poster':a.get('urlImagePreview'),'year':int(a['year']) if str(a.get('year','')).isdigit() else None,
        'description':c.plain(a.get('description')),'genres':a.get('genre','').split(', '),'format':a.get('type'),'playable':True}


def search(source,q):
    from . import catalog as c
    if source=='animelib':
        return [c.save(normalize_lib(a),{'slug':a['slug_url']}) for a in lib('/anime',{'q':q,'site_id[]':5})['data']]
    data=fetch(VOST+'/search',form={'name':q})
    return [c.save(normalize_vost(a),{'id':a['id']}) for a in data.get('data',[])]


def detail(key):
    from . import catalog as c
    item,lookup=c.saved(key)
    if key.startswith('aml-'):
        a=lib('/anime/'+lookup['slug'],{'fields[]':['summary','genres']})['data']
        item=normalize_lib(a)
    elif key.startswith('av-'):
        data=fetch(VOST+'/info',form={'id':lookup['id']})
        if data.get('data'):item=normalize_vost(data['data'][0])
    return c.save(item,lookup)


def episode_rows(key):
    from . import catalog as c
    item,lookup=c.saved(key)
    if not item.get('playable'):raise HTTPException(403,'Просмотр недоступен у этого источника')
    if key.startswith('aml-'):
        rows=lib('/episodes',{'anime_id':lookup['slug']})['data']
        return [{'number':int(e['number']),'season':int(e['season'] or 1),'id':e['id']} for e in rows if str(e['number']).isdigit()]
    rows=fetch(VOST+'/playlist',form={'id':lookup['id']})
    if not isinstance(rows,list):raise ValueError('Invalid episode list')
    return [{'number':int(m[1]),'season':1,'streams':e} for e in rows if (m:=re.match(r'^(\d+)\s*(?:серия|$)',e.get('name','')))]


def players(key,episode,season,remember):
    rows=episode_rows(key)
    row=next((e for e in rows if e['number']==episode and e['season']==season),None)
    if not row:raise HTTPException(404,'Серия недоступна в этом источнике')
    if key.startswith('av-'):
        streams=[{'url':row['streams'][k],'quality':q,'kind':'mp4','label':f'{q}p'} for k,q in [('hd',720),('std',480)] if row['streams'].get(k)]
        return [{'id':remember('direct-streams',streams),'label':'AnimeVost','player':'AnimeVost','kind':'voice','language':'ru'}]
    result=[]
    for v in lib('/episodes/'+str(row['id']))['data'].get('players',[]):
        common={'label':v.get('team',{}).get('name','AnimeLib'),'player':'AnimeLib · '+v['player'],
            'kind':'sub' if v.get('translation_type',{}).get('id')==1 else 'voice','language':'ru'}
        if v['player'].lower()=='kodik' and v.get('src'):
            result.append({**common,'id':remember('embed',{'url':v['src'],'episode':episode,'season':season})})
        elif v['player'].lower()=='animelib' and (v.get('video') or {}).get('quality'):
            # Separate ASS subtitles need a renderer; do not advertise an untranslated video as subtitled.
            if common['kind']=='sub' and v.get('subtitles'):continue
            servers=lib('/constants',{'fields[]':'videoServers'})['data']['videoServers']
            server=next((s for s in servers if s['id']==v.get('video_domain')),servers[0])['url']
            streams=[{'url':server.rstrip('/')+'/'+q['href'].lstrip('/'),'kind':'mp4','quality':q['quality'],'label':str(q['quality'])+'p','headers':{'Referer':'https://animelib.org/'}} for q in v['video']['quality']]
            result.append({**common,'id':remember('direct-streams',streams)})
    return result
