import type {Anime} from './api';

export type SearchView = 'grid' | 'table';
export type SearchSortKey = 'relevance' | 'title' | 'year' | 'rating' | 'episodes' | 'source';
export type SearchDirection = 'asc' | 'desc';
export type SearchSort = {key:SearchSortKey;direction:SearchDirection};
export const SEARCH_SORT_LABELS:Record<SearchSortKey,string> = {
 relevance:'По совпадению',title:'По названию',year:'По году',rating:'По рейтингу',episodes:'По числу серий',source:'По источнику',
};
export const FORMAT_NAMES:Record<string,string> = {tv:'Сериал',movie:'Фильм',special:'Спецвыпуск',other:'OVA / ONA',unknown:'Формат не указан'};
const collator = new Intl.Collator('ru',{numeric:true,sensitivity:'base'});

export function searchQuery(value:unknown):string {
 return typeof value==='string'?value.replace(/\s+/g,' ').trim().slice(0,100):'';
}
export function searchView(value:unknown,fallback:SearchView='grid'):SearchView {
 return value==='table'||value==='grid'?value:fallback;
}
export function searchSort(key:unknown,direction?:unknown):SearchSort {
 const validKey=typeof key==='string'&&Object.prototype.hasOwnProperty.call(SEARCH_SORT_LABELS,key)?key as SearchSortKey:'relevance';
 return {key:validKey,direction:direction==='asc'||direction==='desc'?direction:validKey==='title'||validKey==='source'?'asc':'desc'};
}
export function titleCount(count:number):string {
 const lastTwo=count%100,last=count%10;
 return lastTwo>=11&&lastTwo<=14?'тайтлов':last===1?'тайтл':last>=2&&last<=4?'тайтла':'тайтлов';
}
export function searchHistory(saved:unknown):string[] {
 if(!Array.isArray(saved))return [];
 const seen=new Set<string>();
 return saved.flatMap(value=>{const q=searchQuery(value),key=q.toLocaleLowerCase();if(q.length<2||seen.has(key))return [];seen.add(key);return [q]}).slice(0,8);
}
export function formatOf(anime:Anime):string {
 const f=(anime.format||'').toLowerCase();
 if(/movie|фильм|полнометраж/.test(f))return 'movie';
 if(/special|спец/.test(f))return 'special';
 if(/ova|ona|oad|web/.test(f))return 'other';
 if(/tv|тв|сериал/.test(f))return 'tv';
 return 'unknown';
}
export function numberValue(value:unknown,allowZero=false):number|null {
 if(value==null||value===''||typeof value==='boolean')return null;
 const n=Number(value);
 return Number.isFinite(n)&&(allowZero?n>=0:n>0)?n:null;
}
export function episodeCount(anime:Anime):number|null {
 return numberValue(anime.episodes_total)??numberValue(anime.available_episodes,true);
}
export function sourceNames(anime:Anime):string[] {
 return [...new Set([anime.provider,...(anime.variants||[]).map(v=>v.provider)].filter(Boolean))].sort(collator.compare);
}
function normalizedText(value:string):string {
 return value.normalize('NFKC').toLocaleLowerCase().replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}
export function searchScore(anime:Anime,query:string):number {
 const q=normalizedText(query);
 if(!q)return 0;
 const words=q.split(' ');
 return Math.max(...[anime.title,anime.original_title||''].map(name=>{
  const title=normalizedText(name);
  if(title===q)return 100;
  if(title.startsWith(q+' '))return 80;
  // Normalized spaces provide Unicode word boundaries; JS \b does not handle Cyrillic.
  if((' '+title+' ').includes(' '+q+' '))return 75;
  const titleWords=title.split(' '),exact=new Set(titleWords);
  const exactCount=words.filter(word=>exact.has(word)).length;
  const prefixCount=words.filter(word=>!exact.has(word)&&titleWords.some(token=>token.startsWith(word))).length;
  if(exactCount)return 35+(exactCount*25+prefixCount*10)/words.length;
  if(prefixCount)return 15+prefixCount/words.length*15;
  // A hit inside an unrelated word is weak evidence, below every complete-token hit.
  return title.includes(q)?5:0;
 }));
}
function compareNumbers(a:number|null,b:number|null,direction:SearchDirection):number {
 // Missing metadata stays last in both directions; it is not a zero rating or year.
 if(a===null)return b===null?0:1;
 if(b===null)return -1;
 return (a-b)*(direction==='asc'?1:-1);
}
export function sortSearchResults(items:Anime[],sort:SearchSort,query:string):Anime[] {
 const sign=sort.direction==='asc'?1:-1;
 return [...items].sort((a,b)=>{
  let primary=0;
  switch(sort.key){
   case 'title':primary=collator.compare(a.title,b.title)*sign;break;
   case 'source':primary=collator.compare(a.provider||'',b.provider||'')*sign;break;
   case 'year':primary=compareNumbers(numberValue(a.year),numberValue(b.year),sort.direction);break;
   case 'rating':primary=compareNumbers(numberValue(a.rating),numberValue(b.rating),sort.direction);break;
   case 'episodes':primary=compareNumbers(episodeCount(a),episodeCount(b),sort.direction);break;
   default:primary=(searchScore(a,query)-searchScore(b,query))*sign;
  }
  return primary||Number(!!b.playable)-Number(!!a.playable)||collator.compare(a.title,b.title)||a.id.localeCompare(b.id);
 });
}
