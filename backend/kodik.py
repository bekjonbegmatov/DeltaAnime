"""Kodik API with server-only configured or library-published shared token.
Reference: AnimeParsers/KODIK_API.md and kdk_tokns/TOKENS.md.
No TLS downgrade, legacy/dead credentials, downloaded code execution or client token exposure.
"""
import base64
import os
import threading
import time
import requests

TOKEN_LIST='https://raw.githubusercontent.com/YaNesyTortiK/AnimeParsers/refs/heads/main/kdk_tokns/tokens.json'
_lock=threading.Lock()
_token=None
_expires=0
_retry_after=0


class TokenUnavailable(Exception):
    pass


def enabled():
    return bool(os.getenv('KODIK_TOKEN')) or os.getenv('KODIK_AUTO_TOKEN','1')!='0'


def decode(value):
    half=len(value)//2
    result=(base64.b64decode(value[half:][::-1],validate=True)+base64.b64decode(value[:half][::-1],validate=True)).decode('ascii')
    if len(result)!=32 or not all(c in '0123456789abcdefABCDEF' for c in result):
        raise ValueError('Invalid shared token format')
    return result


def _request(token,params,endpoint='search'):
    if endpoint not in ('search','list'):raise ValueError('Unsupported Kodik endpoint')
    proxy=os.getenv('ANIME_PROXY')
    with requests.Session() as session:
        r=session.post('https://kodik-api.com/'+endpoint,data={**params,'token':token},timeout=(4,10),
            proxies={'http':proxy,'https':proxy} if proxy else None)
        if r.status_code in (401,403):raise TokenUnavailable('Kodik не принял токен')
        r.raise_for_status();data=r.json()
        if data.get('error'):raise TokenUnavailable('Kodik отклонил запрос с текущим токеном')
        if not isinstance(data.get('results'),list):raise ValueError('Invalid Kodik response')
        return data


def request(params,endpoint='search'):
    global _token,_expires,_retry_after
    if endpoint not in ('search','list'):raise ValueError('Unsupported Kodik endpoint')
    def perform(token):
        return _request(token,params) if endpoint=='search' else _request(token,params,endpoint)
    configured=os.getenv('KODIK_TOKEN')
    if configured:return perform(configured)
    if not enabled():raise TokenUnavailable('Автоматический общий токен выключен')
    with _lock:
        token=_token if _expires>time.monotonic() else None
    if token:
        try:return perform(token)
        except TokenUnavailable:
            with _lock:
                if _token==token:_token=None
    # Only the first concurrent search discovers a token. Cache success for six hours,
    # and failed discovery for ten minutes to avoid hammering GitHub or Kodik.
    with _lock:
        if _token and _expires>time.monotonic():return perform(_token)
        if _retry_after>time.monotonic():raise TokenUnavailable('Общий токен временно недоступен')
        _retry_after=time.monotonic()+600
        r=requests.get(TOKEN_LIST,timeout=(4,10));r.raise_for_status();data=r.json()
        candidates=(data.get('stable',[])+data.get('unstable',[]))[:3]
        for i,entry in enumerate(candidates):
            if i:time.sleep(2)
            try:
                token=decode(entry['tokn']);result=perform(token)
            except (TokenUnavailable,ValueError,KeyError):continue
            _token=token;_expires=time.monotonic()+21600;_retry_after=0
            return result
        raise TokenUnavailable('Опубликованные общие токены не работают; можно настроить собственный KODIK_TOKEN')
