import type {Anime} from './api';
const canonicalId=(value:unknown)=>/^[1-9]\d*$/.test(String(value))?String(value):null;

export function sameTitle(a:Anime,b:Anime):boolean{
 const ids=['mal_id','shikimori_id'] as const;
 if(ids.some(key=>canonicalId(a[key])&&canonicalId(b[key])&&canonicalId(a[key])!==canonicalId(b[key])))return false;
 return a.id===b.id||ids.some(key=>canonicalId(a[key])&&canonicalId(a[key])===canonicalId(b[key]));
}

export function merge(items:Anime[]):Anime[]{
 const groups:Anime[]=[];
 for(const item of items){
  const index=groups.findIndex(old=>sameTitle(old,item));
  const incoming=item.variants?.length?item.variants:[{id:item.id,provider:item.provider,playable:!!item.playable}];
  if(index<0){groups.push({...item,variants:[...incoming]});continue}
  const old=groups[index];const primary=item.playable&&!old.playable?item:old;
  groups[index]={...primary,mal_id:old.mal_id||item.mal_id,shikimori_id:old.shikimori_id||item.shikimori_id,
   variants:[...new Map([...(old.variants||[]),...incoming].map(v=>[v.id,v])).values()]};
 }
 return groups;
}
