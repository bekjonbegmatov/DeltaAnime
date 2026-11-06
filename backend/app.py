"""Anime API and optional built frontend. Playback handles stay inside one worker."""
import os
import re
import time
import secrets
import socket
import ipaddress
import threading
from typing import Literal
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import requests
import anime_dl_core as core
from anime_dl_core.sources import AnimeGo, Animedia, Alloha
from pydantic import BaseModel, Field
from . import catalog, providers, kodik
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.staticfiles import StaticFiles
from .settings import allowed_hosts

app = FastAPI(title="DeltaAnime", version="0.3.0")
app.include_router(catalog.router)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts())
MIRROR = os.getenv("ANIMEGO_MIRROR", "animego.me")
PROXY = os.getenv("ANIME_PROXY")
handles = {}
lock = threading.Lock()
TTL = 7200
DEMO = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"


def remember(kind, value):
    with lock:
        now = time.monotonic()
        for key in list(handles):
            if handles[key][0] < now:
                del handles[key]
        if len(handles) >= 10000:
            del handles[next(iter(handles))]
        token = secrets.token_urlsafe(24)
        handles[token] = (now + TTL, kind, value)
        return token


def recall(token, kind):
    with lock:
        entry = handles.get(token)
    if not entry or entry[0] < time.monotonic() or entry[1] != kind:
        raise HTTPException(410, "Ссылка устарела. Выберите серию заново.")
    return entry[2]


def source():
    return AnimeGo(mirror=MIRROR, proxy=PROXY, timeout=12)


def provider_error(exc):
    # Do not expose upstream URLs, signatures or proxy credentials.
    name = type(exc).__name__
    status = 404 if name == "NotFound" else 502
    return HTTPException(status, f"Источник сейчас не вернул данные ({name}). Попробуйте другое название или повторите позже.")


@app.get('/api/health')
def health():
    return {"ok": True, "providers": catalog.sources()["sources"], "version": "0.3.0"}


@app.get('/api/anime/{anime_id}/episodes')
def episodes(anime_id: str, season: int = Query(1, ge=1, le=100)):
    if anime_id.startswith(('aml-','av-')):
        try:
            rows=providers.episode_rows(anime_id)
            return {'episodes':sorted({e['number'] for e in rows if e['season']==season}), 'seasons':sorted({e['season'] for e in rows})}
        except HTTPException:raise
        except Exception as exc:raise provider_error(exc) from exc
    if anime_id.startswith(('amd-', 'all-', 'kd-')):
        try:
            _, lookup = catalog.saved(anime_id)
            if anime_id.startswith('amd-'):
                with Animedia(proxy=PROXY, timeout=10) as site:
                    return {'episodes': sorted(site.episodes(lookup['url'])), 'seasons':[1]}
            if anime_id.startswith('all-'):
                with alloha_source() as site:
                    item = catalog.cached(('alloha',anime_id),lambda:site.find(**lookup),120)
                    return {'episodes':item.seasons.get(season,[]) if item.seasons else [1], 'seasons':sorted(item.seasons) or [1]}
            results = kodik_results(lookup)
            numbers=set()
            seasons=set()
            for item in results:
                if not item.get('seasons'): numbers.add(1)
                for number, data in item.get('seasons',{}).items():
                    seasons.add(int(number))
                    if int(number)==season:numbers.update(int(e) for e in data.get('episodes',{}))
            return {'episodes':sorted(numbers),'seasons':sorted(seasons) or [1]}
        except HTTPException: raise
        except Exception as exc:raise provider_error(exc) from exc
    if re.fullmatch(r"lib-\d+", anime_id):
        try:
            with core.AnilibriaPlayer(proxy=PROXY, timeout=12) as player:
                return {"episodes": sorted({int(e["ordinal"]) for e in player.episodes(anime_id[4:]) if e.get("ordinal") and int(e["ordinal"]) > 0})}
        except Exception as exc:
            raise provider_error(exc) from exc
    if not anime_id.isdigit():
        raise HTTPException(400, "Некорректный ID")
    try:
        with source() as site:
            numbers = sorted(site.episodes(anime_id))
            # A film may have no episode selector; verify its player exists.
            if not numbers:
                site.players(anime_id, 1)
                numbers = [1]
            return {"episodes": numbers}
    except Exception as exc:
        raise provider_error(exc) from exc


@app.get('/api/anime/{anime_id}/players')
def players(anime_id: str, episode: int = Query(ge=1, le=10000), season:int=Query(1,ge=1,le=100)):
    if anime_id.startswith(('aml-','av-')):
        try:return {'players':providers.players(anime_id,episode,season,remember)}
        except HTTPException:raise
        except Exception as exc:raise provider_error(exc) from exc
    if anime_id.startswith(('amd-', 'all-', 'kd-')):
        try:
            _, lookup = catalog.saved(anime_id)
            if anime_id.startswith('amd-'):
                with Animedia(proxy=PROXY,timeout=10) as site:
                    link=site.episodes(lookup['url']).get(episode)
                    if not link:raise HTTPException(404,'Серия не найдена')
                    options=[{'id':remember('embed',{'url':link,'episode':episode}),'label':'Animedia','player':'Animedia'}]
                    for embed in site.players(lookup['url']).get('kodik',[]):
                        options.append({'id':remember('embed',{'url':embed,'episode':episode,'season':season}),'label':'Kodik · внешняя версия','player':'Kodik'})
                    return {'players':options}
            if anime_id.startswith('all-'):
                with alloha_source() as site:
                    item=catalog.cached(('alloha',anime_id),lambda:site.find(**lookup),120)
                    voices=site.translations_for(item,season=season,episode=episode)
                    return {'players':[{'id':remember('iframe',site.iframe(item,season=season,episode=episode,translation=v.id)),'label':v.name,'player':'Alloha · встроенный плеер','kind':'sub' if 'субтитр' in v.name.lower() else 'voice','language':'ru'} for v in voices]}
            options=[]
            for item in kodik_results(lookup):
                link=item.get('seasons',{}).get(str(season),{}).get('episodes',{}).get(str(episode)) if item.get('seasons') else item.get('link')
                if isinstance(link,dict):link=link.get('link')
                if link:
                    options.append({'id':remember('embed',{'url':link,'episode':episode,'season':season}),'label':(item.get('translation') or {}).get('title','Kodik'),'player':'Kodik','kind':'sub' if (item.get('translation') or {}).get('type')=='subtitles' else 'voice','language':'ru'})
            return {'players':options}
        except HTTPException:raise
        except Exception as exc:raise provider_error(exc) from exc
    if re.fullmatch(r"lib-\d+", anime_id):
        try:
            release=catalog.lib_release(anime_id[4:])
            if episode not in {int(e['ordinal']) for e in release.get('episodes',[]) if e.get('ordinal')}:
                raise HTTPException(404,'Серия недоступна')
            options=[{"id": remember("lib-player", (anime_id[4:], episode)), "label": "AniLibria.TV", "player": "AniLibria.TV · прямой HLS", "language":"ru", "kind":"voice"}]
            external=release.get('external_player')
            if external and core.supports('https:'+external if external.startswith('//') else external):
                options.append({'id':remember('embed',{'url':external,'episode':episode,'season':season}), 'label':'AniLibria.TV','player':'Kodik'})
            return {'players':options}
        except HTTPException:raise
        except Exception as exc:raise provider_error(exc) from exc
    if not anime_id.isdigit():
        raise HTTPException(400, "Некорректный ID")
    try:
        with source() as site:
            links = site.players(anime_id, episode)
            return {"players": [{"id": remember("embed", {"url":link.embed,"episode":episode,"studio":link.label}), "label": link.label, "player": link.player}
                                for link in links if core.supports(link.embed)]}
    except Exception as exc:
        raise provider_error(exc) from exc


@app.get('/api/resolve/{token}')
def resolve(token: str):
    with lock:
        entry = handles.get(token)
    kind = entry[1] if entry else "player"
    if kind not in ("player", "lib-player", "embed", "iframe", "direct-streams"):
        raise HTTPException(410, "Ссылка устарела")
    link = recall(token, kind)
    try:
        if kind == "direct-streams":
            streams=[]
            for stream in link:
                validate_remote(stream["url"])
                key=remember("media",(stream["url"],stream.get("headers",{}),stream["kind"]))
                streams.append({**{k:v for k,v in stream.items() if k not in ("url","headers")},"url":f"/api/media/{key}"})
            return {"streams":streams,"skip_segments":[]}
        if kind == "iframe":
            url='https:'+link if link.startswith('//') else link
            validate_remote(url)
            return {'iframe':url,'streams':[],'skip_segments':[]}
        if kind == "embed":
            data=dict(link)
            url=data.pop('url')
            result=core.extract('https:'+url if url.startswith('//') else url,proxy=PROXY,timeout=12,**data)
        elif kind == "lib-player":
            with core.AnilibriaPlayer(proxy=PROXY, timeout=12) as player:
                result = player.extract(link[0], episode=link[1])
        else:
            result = core.extract(link.embed, proxy=PROXY, timeout=12)
        streams = []
        for stream in result.streams:
            # Separate-audio variants need a master playlist; DASH is deferred.
            if stream.kind.value not in ('hls', 'mp4') or stream.audio_url:
                continue
            key = remember("media", (stream.url, stream.headers, stream.kind.value))
            streams.append({"url": f"/api/media/{key}", "kind": stream.kind.value,
                            "quality": stream.quality, "label": stream.label})
        if not streams:
            raise ValueError("No playable HLS/MP4 streams")
        return {"streams": streams, "skip_segments": [s.to_dict() for s in result.skip_segments]}
    except Exception as exc:
        raise provider_error(exc) from exc


@app.get('/api/demo')
def demo():
    token = remember('media', (DEMO, {}, 'hls'))
    return {"streams": [{"url": f"/api/media/{token}", "kind": "hls", "quality": None, "label": "Тестовый ролик"}], "skip_segments": []}


def validate_remote(url):
    parsed = urlsplit(url)
    if parsed.scheme not in ('https', 'http') or not parsed.hostname or parsed.username or parsed.port not in (None, 80, 443):
        raise HTTPException(400, "Недопустимый адрес потока")
    try:
        addresses = socket.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise HTTPException(502, "CDN не найден") from exc
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise HTTPException(400, "Недопустимый адрес CDN")


def rewrite_manifest(text, base_url, headers):
    def local(uri):
        target = urljoin(base_url, uri)
        # Fetch-time validation also checks nested URIs and every redirect.
        return '/api/media/' + remember('media', (target, headers, 'auto'))
    lines = []
    for line in text.splitlines():
        if line and not line.startswith('#'):
            line = local(line.strip())
        elif 'URI="' in line:
            line = re.sub(r'URI="([^"]+)"', lambda m: 'URI="' + local(m[1]) + '"', line)
        lines.append(line)
    return '\n'.join(lines) + '\n'


@app.get('/api/media/{token}')
def media(token: str, request: Request):
    url, headers, kind = recall(token, 'media')
    headers = {**headers, 'Accept-Encoding': 'identity'}
    byte_range = request.headers.get('range')
    if byte_range:
        if not re.fullmatch(r'bytes=\d*-\d*', byte_range):
            raise HTTPException(400, 'Некорректный Range')
        headers['Range'] = byte_range
    proxies = {'http': PROXY, 'https': PROXY} if PROXY else None
    try:
        for _ in range(5):
            validate_remote(url)
            upstream = requests.get(url, headers=headers, proxies=proxies, stream=True, timeout=(10, 20), allow_redirects=False)
            if upstream.status_code in (301, 302, 303, 307, 308):
                destination = urljoin(url, upstream.headers.get('Location', ''))
                upstream.close()
                url = destination
                continue
            break
        else:
            raise HTTPException(502, 'Слишком много перенаправлений CDN')
        if upstream.status_code not in (200, 206):
            code = upstream.status_code
            upstream.close()
            raise HTTPException(502, f'CDN вернул {code}. Выберите озвучку заново.')
        content_type = upstream.headers.get('Content-Type', 'application/octet-stream')
        if kind == 'hls' or '.m3u8' in urlsplit(url).path or 'mpegurl' in content_type.lower():
            try:
                chunks, size = [], 0
                for chunk in upstream.iter_content(65536):
                    size += len(chunk)
                    if size > 2_000_000:
                        raise HTTPException(502, 'Плейлист слишком большой')
                    chunks.append(chunk)
                manifest = b''.join(chunks).decode('utf-8-sig')
                if not manifest.startswith('#EXTM3U'):
                    raise HTTPException(502, 'CDN вернул некорректный плейлист')
                return Response(rewrite_manifest(manifest, url, headers), media_type='application/vnd.apple.mpegurl')
            finally:
                upstream.close()
        def chunks():
            try:
                yield from upstream.iter_content(262144)
            finally:
                upstream.close()
        outgoing = {k: v for k, v in upstream.headers.items() if k.lower() in ('content-length', 'content-range', 'accept-ranges')}
        return StreamingResponse(chunks(), status_code=upstream.status_code, media_type=content_type, headers=outgoing)
    except requests.RequestException as exc:
        raise HTTPException(502, 'Не удалось подключиться к CDN') from exc


def alloha_source():
    return Alloha(proxy=PROXY,timeout=10,**({'token':os.environ['ALLOHA_TOKEN']} if os.getenv('ALLOHA_TOKEN') else {}))


def kodik_results(lookup):
    filters={k:v for k,v in lookup.items() if k in ('id','shikimori_id')}
    if not filters:raise HTTPException(400,'Нет идентификатора Kodik')
    try:
        return catalog.cached(('kodik-episodes',tuple(sorted(filters.items()))),lambda:kodik.request({**filters,'with_episodes':'true','with_seasons':'true','limit':100}),120).get('results',[])
    except kodik.TokenUnavailable as exc:raise HTTPException(409,'Токен Kodik временно недоступен') from exc


class EmbedInput(BaseModel):
    url:str=Field(min_length=10,max_length=2048)
    episode:int=Field(default=1,ge=1,le=10000)


@app.get('/api/extractors')
def extractors():
    return {'players':[{'name':p.name,'title':p.title,'domains':list(p.domains),
        'status':'unavailable' if p.name=='sovetromantica' else 'supported',
        'note':p.note or 'По ссылке плеера; доступность проверяется при открытии'} for p in core.all_players()]}


@app.post('/api/embed')
def embed(data:EmbedInput):
    url=data.url.strip()
    validate_remote(url)
    host=urlsplit(url).hostname
    matching=[p for p in core.all_players() if any(host==d or host.endswith('.'+d) for d in p.domains)]
    if not matching:raise HTTPException(400,'Домен не входит в список поддерживаемых плееров')
    if matching[0].name=='sovetromantica':raise HTTPException(409,'Источник SovetRomantica сейчас недоступен')
    token=remember('embed',{'url':url,'episode':data.episode})
    return {'token':token,'title':matching[0].title}


class FrontendFiles(StaticFiles):
    """Serve the built SPA only on UI routes; missing assets and API stay 404."""
    async def get_response(self, path, scope):
        if path == 'api' or path.startswith('api/'):
            raise HTTPException(404, 'Not Found')
        ui_route = path == '.' or re.fullmatch(
            r'(?:catalog|top|search|saved|sources|(?:anime|watch)/[A-Za-z0-9_-]+)', path
        )
        if ui_route:
            response = await super().get_response('index.html', scope)
            # Never pin an old HTML document to newly fingerprinted JS/CSS assets.
            response.headers['Cache-Control'] = 'no-cache'
            return response
        response = await super().get_response(path, scope)
        if path == 'index.html':
            response.headers['Cache-Control'] = 'no-cache'
        elif path.startswith('assets/'):
            response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
        return response


def mount_frontend(application: FastAPI, directory: str | Path | None):
    if directory is None:
        return
    root = Path(directory)
    if not str(directory).strip() or not (root / 'index.html').is_file():
        raise RuntimeError('STATIC_DIR must point to a frontend build containing index.html')
    # This mount must follow every API route so /api retains its original behavior.
    application.mount('/', FrontendFiles(directory=root), name='frontend')


mount_frontend(app, os.getenv('STATIC_DIR'))
