export type PlayerPreferences = {
  skipOpening: boolean;
  skipEnding: boolean;
  autoNext: boolean;
  autoFullscreen: boolean;
  theatre: boolean;
  speed: number;
  quality: number;
  volume: number;
  muted: boolean;
  lastAudibleVolume: number;
};
export const PLAYER_DEFAULTS: PlayerPreferences = {
  skipOpening: false, skipEnding: false, autoNext: true, autoFullscreen: false,
  theatre: false, speed: 1, quality: 0, volume: 1, muted: false, lastAudibleVolume: 1,
};
export function normalizePreferences(value:unknown):PlayerPreferences {
  const v=(value&&typeof value==='object'?value:{}) as Partial<PlayerPreferences>;
  const bool=(key:keyof PlayerPreferences)=>typeof v[key]==='boolean'?v[key] as boolean:PLAYER_DEFAULTS[key] as boolean;
  const volume=typeof v.volume==='number'&&Number.isFinite(v.volume)?Math.min(1,Math.max(0,v.volume)):1;
  return {skipOpening:bool('skipOpening'),skipEnding:bool('skipEnding'),autoNext:bool('autoNext'),autoFullscreen:bool('autoFullscreen'),theatre:bool('theatre'),
    speed:[.5,.75,1,1.25,1.5,1.75,2].includes(v.speed as number)?v.speed!:1,
    quality:[0,360,480,720,1080,1440,2160].includes(v.quality as number)?v.quality!:0,
    volume,muted:bool('muted'),lastAudibleVolume:typeof v.lastAudibleVolume==='number'&&Number.isFinite(v.lastAudibleVolume)&&v.lastAudibleVolume>0?Math.min(1,v.lastAudibleVolume):volume||1};
}
export type AudioPreferences=Pick<PlayerPreferences,'volume'|'muted'|'lastAudibleVolume'>;
export type VolumeAction={type:'set'|'adjust';value:number}|{type:'toggle'};
export function changeVolume(current:AudioPreferences,action:VolumeAction):AudioPreferences{
  const clamp=(value:number)=>Math.round(Math.min(1,Math.max(0,Number.isFinite(value)?value:0))*100)/100;
  const volume=clamp(current.volume),last=clamp(current.lastAudibleVolume)||volume||1;
  if(action.type==='toggle')return current.muted||!volume?{volume:volume||last,muted:false,lastAudibleVolume:volume||last}:{volume,muted:true,lastAudibleVolume:volume};
  if(!Number.isFinite(action.value))return {volume,muted:current.muted,lastAudibleVolume:last};
  const value=clamp(action.type==='adjust'?volume+action.value:action.value);
  return {volume:value,muted:value===0,lastAudibleVolume:value||last};
}
export type SkipSegment={start:number;end:number;kind:string};
export function validSegments(segments:SkipSegment[],duration:number):SkipSegment[]{
  return segments.filter(s=>['opening','ending'].includes(s.kind)&&Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.start>=0&&s.end>s.start&&(!Number.isFinite(duration)||duration<=0||s.start<duration))
    .map(s=>({...s,end:Number.isFinite(duration)&&duration>0?Math.min(s.end,duration):s.end})).sort((a,b)=>a.start-b.start);
}
export function currentSegment(segments:SkipSegment[],time:number){return segments.find(s=>time>=s.start&&time<s.end)}
export function shouldAutoSkip(segment:SkipSegment,preferences:PlayerPreferences){return segment.kind==='opening'?preferences.skipOpening:segment.kind==='ending'&&preferences.skipEnding}
export function preferredStreamIndex(streams:{quality:number|null;kind:string}[],quality:number){
  if(!streams.length||!quality)return 0;
  const exact=streams.findIndex(s=>s.quality===quality&&s.kind==='hls');
  if(exact>=0)return exact;
  const any=streams.findIndex(s=>s.quality===quality);if(any>=0)return any;
  const under=streams.findIndex(s=>s.quality!==null&&s.quality<=quality);
  return under>=0?under:streams.length-1;
}
export function timeLabel(seconds:number){if(!Number.isFinite(seconds)||seconds<0)return '0:00';const s=Math.floor(seconds);const h=Math.floor(s/3600);return (h?h+':':'')+String(Math.floor(s%3600/60)).padStart(h?2:1,'0')+':'+String(s%60).padStart(2,'0')}

export type TranslationFilter={language?:string;kind?:string};
export function languageCode(language?:string){
  const value=(language||'').trim().toLowerCase().replaceAll('_','-');
  const aliases:Record<string,string>={rus:'ru',russian:'ru','русский':'ru',eng:'en',english:'en',jpn:'ja',japanese:'ja',ukr:'uk'};
  return aliases[value]||value.split('-')[0]||'und';
}
export function languageLabel(code:string){
  if(code==='all')return 'Все языки';
  if(code==='und')return 'Язык не указан';
  const names:Record<string,string>={ru:'Русский',en:'Английский',ja:'Японский',uk:'Украинский',zh:'Китайский',ko:'Корейский',de:'Немецкий',fr:'Французский',es:'Испанский'};
  if(names[code])return names[code];
  try{const name=new Intl.DisplayNames(['ru'],{type:'language'}).of(code);return name?name[0].toUpperCase()+name.slice(1):code.toUpperCase()}catch{return code.toUpperCase()}
}
export function translationFilters(tracks:TranslationFilter[],requestedLanguage:string,requestedKind:string){
  const languages=[...new Set(tracks.map(v=>languageCode(v.language)))].sort((a,b)=>a==='ru'?-1:b==='ru'?1:a==='und'?1:b==='und'?-1:a.localeCompare(b));
  const language=languages.includes(requestedLanguage)?requestedLanguage:'all';
  const inLanguage=tracks.filter(v=>language==='all'||languageCode(v.language)===language);
  const counts={all:inLanguage.length,voice:inLanguage.filter(v=>(v.kind||'voice')==='voice').length,sub:inLanguage.filter(v=>v.kind==='sub').length};
  const kind=(requestedKind==='voice'||requestedKind==='sub')&&counts[requestedKind]>0?requestedKind:'all';
  return {languages,language,kind,counts};
}
export function expiredPlaybackError(message:string){return /ссылка устарела/i.test(message)}
export function alternateStreamIndex(streams:{url:string;kind:string;quality:number|null}[],current:{url:string;kind:string;quality:number|null},failed:Set<string>){
  return streams.findIndex(s=>s.url!==current.url&&s.kind!==current.kind&&s.quality===current.quality&&!failed.has(s.url));
}
