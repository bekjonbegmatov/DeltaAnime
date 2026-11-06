export type PlayerPreferences = {
  skipOpening: boolean;
  skipEnding: boolean;
  autoNext: boolean;
  autoFullscreen: boolean;
  theatre: boolean;
  speed: number;
  quality: number;
  volume: number;
};
export const PLAYER_DEFAULTS: PlayerPreferences = {
  skipOpening: false, skipEnding: false, autoNext: true, autoFullscreen: false,
  theatre: false, speed: 1, quality: 0, volume: 1,
};
export function normalizePreferences(value:unknown):PlayerPreferences {
  const v=(value&&typeof value==='object'?value:{}) as Partial<PlayerPreferences>;
  const bool=(key:keyof PlayerPreferences)=>typeof v[key]==='boolean'?v[key] as boolean:PLAYER_DEFAULTS[key] as boolean;
  return {skipOpening:bool('skipOpening'),skipEnding:bool('skipEnding'),autoNext:bool('autoNext'),autoFullscreen:bool('autoFullscreen'),theatre:bool('theatre'),
    speed:[.5,.75,1,1.25,1.5,1.75,2].includes(v.speed as number)?v.speed!:1,
    quality:[0,360,480,720,1080,1440,2160].includes(v.quality as number)?v.quality!:0,
    volume:typeof v.volume==='number'&&Number.isFinite(v.volume)?Math.min(1,Math.max(0,v.volume)):1};
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
