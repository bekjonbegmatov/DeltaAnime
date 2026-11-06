import {useEffect,useState} from 'react';
export type Anime={id:string;title:string;original_title?:string;poster?:string;banner?:string;provider:string;source?:string;year?:number;format?:string;status?:string;rating?:number;rating_source?:string;genres?:string[];description?:string;episodes_total?:number;available_episodes?:number;duration?:number;playable?:boolean;mal_id?:number;shikimori_id?:number;studios?:string[];age?:string;notification?:string;url?:string;relations?:{id:string;title:string;poster:string;relation:string}[];variants?:{id:string;provider:string;playable:boolean}[]};
export type Source={id:string;name:string;search:boolean;type:string;state:string;note:string;playback?:boolean};
export type SearchResult={items:Anime[];source:string;status:string;count?:number;message?:string};
export type Catalog={items:Anime[];total?:number;total_pages?:number;has_next?:boolean;next_cursor?:string;prev_cursor?:string;page?:number;source?:string;degraded?:boolean;note?:string};
export async function api<T>(path:string,signal?:AbortSignal,body?:unknown):Promise<T>{
 const r=await fetch('/api'+path,{signal,...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
 let data;try{data=await r.json()}catch{throw new Error('Сервер недоступен. Повторите позже.')}
 if(!r.ok)throw new Error(typeof data.detail==='string'?data.detail:'Не удалось выполнить запрос');
 return data;
}
export function useApi<T>(path:string|null){const [data,setData]=useState<T|null>(null);const [error,setError]=useState('');const [loading,setLoading]=useState(!!path);const [retry,setRetry]=useState(0);
 useEffect(()=>{setData(null);setError('');if(!path){setLoading(false);return}const controller=new AbortController();setLoading(true);api<T>(path,controller.signal).then(setData).catch(e=>{if(!controller.signal.aborted)setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});return()=>controller.abort()},[path,retry]);
 return {data,error,loading,reload:()=>setRetry(n=>n+1)};
}
export function read<T>(key:string,fallback:T):T{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch{return fallback}}
export function write(key:string,value:unknown){try{localStorage.setItem(key,JSON.stringify(value))}catch{}}
export type Progress={anime:Anime;episode:number;season:number;time:number;updated:number};
export {merge} from './title-identity';
export function relevance(anime:Anime,query:string){const normalize=(s:string)=>s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();const q=normalize(query);return Math.max(...[anime.title,anime.original_title||''].map(name=>{const t=normalize(name);if(t===q)return 100;if(t.startsWith(q+' '))return 80;if(t.includes(q))return 60;const words=q.split(' ');return words.filter(w=>t.split(' ').includes(w)).length/words.length*40}))}
