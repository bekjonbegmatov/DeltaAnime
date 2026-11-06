import {useEffect,useRef,useState} from 'react';
import {Link,Navigate,useParams,useSearchParams} from 'react-router-dom';
import {ArrowLeft,ChevronLeft,ChevronRight,Play,Pause,Search,SkipForward,LoaderCircle,RotateCw,Settings2,X,Maximize,Minimize,Volume2,VolumeX,Rewind,FastForward,Monitor,Check,ChevronDown,ListVideo,AudioLines,Captions,Volume1,ChevronUp,Plus,Minus} from 'lucide-react';
import type HlsType from 'hls.js';
import {Anime,Progress,api,useApi,read,write} from './api';
import {ErrorBox} from './components';
import {useVersions,Versions,useEpisodeSources} from './versions';
import {PlayerPreferences,normalizePreferences,validSegments,currentSegment,shouldAutoSkip,preferredStreamIndex,timeLabel,languageCode,languageLabel,translationFilters,expiredPlaybackError,alternateStreamIndex,changeVolume,VolumeAction} from './player-settings';
import './player.css';
type Voice={id:string;label:string;player:string;kind?:string;language?:string;note?:string;sourceId?:string};
type Stream={url:string;kind:string;quality:number|null;label:string};
type Playback={streams:Stream[];iframe?:string;skip_segments:{start:number;end:number;kind:string}[]};
export function WatchPage(){const {id}=useParams();const [params]=useSearchParams();if(id?.startsWith('a365-'))return <Navigate replace to={id==='a365-25142'?'/watch/av-2878?'+params.toString():'/search'}/>;return <WatchScreen/>}
function WatchScreen(){const {id}=useParams();const [params,setParams]=useSearchParams();const direct=id==='direct',demo=id==='demo';const special=direct||demo;
 const title=useApi<Anime>(special?null:'/titles/'+id);const season=Number(params.get('season')||1);const requested=Number(params.get('episode')||0);
 const anime=title.data||(special?{id:id!,title:demo?'Big Buck Bunny':params.get('title')||'Внешний плеер',provider:demo?'Демо':'По ссылке',playable:true}:null);
 const versions=useVersions(anime,!special);
 const episodes=useEpisodeSources(versions.versions,season,!special);
 const numbers=episodes.data?.episodes||[];const episode=requested||numbers[0]||1;const index=numbers.indexOf(episode);
 function jump(n:number,s=season){const next=new URLSearchParams(params);next.set('episode',String(n));next.set('season',String(s));setParams(next)}
 const next=index>=0?numbers[index+1]:undefined;
 const [preferences,setPreferences]=useState(()=>normalizePreferences(read('delta-player-settings',{autoNext:read('delta-autonext',true)})));
 const playbackStarted=useRef(false);const fullscreenAttempt=useRef<ReturnType<typeof setTimeout>|null>(null);const cinema=useRef<HTMLDivElement>(null);const [fullscreen,setFullscreen]=useState(false);const [fullscreenHint,setFullscreenHint]=useState('');
 function updatePreferences(update:Partial<PlayerPreferences>){setPreferences(old=>{const next={...old,...update};write('delta-player-settings',next);write('delta-autonext',next.autoNext);return next})}
 useEffect(()=>{const change=()=>setFullscreen(document.fullscreenElement===cinema.current);document.addEventListener('fullscreenchange',change);return()=>{document.removeEventListener('fullscreenchange',change);if(fullscreenAttempt.current)clearTimeout(fullscreenAttempt.current)}},[]);
 function toggleFullscreen(){setFullscreenHint('');if(fullscreenAttempt.current)clearTimeout(fullscreenAttempt.current);if(document.fullscreenElement){document.exitFullscreen().catch(()=>setFullscreenHint('Не удалось выйти из полноэкранного режима. Нажмите Esc.'));return}const host=cinema.current;if(!host?.requestFullscreen){setFullscreenHint('Полный экран недоступен в этом браузере. Используйте режим кинотеатра.');return}fullscreenAttempt.current=setTimeout(()=>{if(document.fullscreenElement!==host)setFullscreenHint('Браузер не открыл полный экран. Можно использовать режим кинотеатра.')},1800);host.requestFullscreen().catch(()=>{if(fullscreenAttempt.current)clearTimeout(fullscreenAttempt.current);setFullscreenHint('Браузер ограничил полный экран. Нажмите кнопку полного экрана ещё раз.')})}
 function playFullscreen(){playbackStarted.current=true;if(preferences.autoFullscreen&&!document.fullscreenElement)toggleFullscreen()}

 return <section className={'watch-page cinema-page'+(preferences.theatre?' theatre-mode':'')}>
   <Link className="breadcrumb" to={special?'/sources':'/anime/'+id}><ArrowLeft size={15}/> {special?'Источники':'Об аниме'}</Link>
   <div className="watch-heading"><div><div className="eyebrow">{anime?.provider||'ЗАГРУЗКА'} · ПРОСМОТР</div><h1>{anime?.title||'Загружаем аниме…'}</h1></div></div>
   {title.error&&<ErrorBox error={title.error} retry={title.reload}/>}
   {episodes.error&&<ErrorBox error={episodes.error} retry={episodes.reload}/>}
   {!special&&<EpisodeNavigator numbers={numbers} episode={episode} season={season} seasons={episodes.data?.seasons?.length?episodes.data.seasons:[season]} select={jump} loading={episodes.loading&&!episodes.data} autoNext={preferences.autoNext}/>}
   <div ref={cinema} className={'cinema-host'+(fullscreen?' is-fullscreen':'')}>
     {!special&&episodes.loading&&!episodes.data?<div className="video-placeholder"><LoaderCircle className="spin"/> Загружаем список серий…</div>:!special&&episodes.data&&!numbers.length?<EmptyPlayback animeId={id!} variants={versions.versions} season={season} multipleSeasons={(episodes.data.seasons?.length||0)>1} retry={episodes.reload}/>:!special&&episodes.data&&!numbers.includes(episode)?<ErrorBox error="Эта серия отсутствует у источника. Выберите доступную серию над плеером."/>:anime&&<PlaybackPanel key={`${id}:${season}:${episode}:${params.get('token')}`} anime={anime} versions={versions.versions} episode={episode} season={season} demo={demo} token={direct?params.get('token'):null} next={next?()=>jump(next):undefined} preferences={preferences} updatePreferences={updatePreferences} fullscreen={fullscreen} fullscreenHint={fullscreenHint} toggleFullscreen={toggleFullscreen} playFullscreen={playFullscreen} playOnLoad={preferences.autoNext&&(!preferences.autoFullscreen||playbackStarted.current)} onPlaybackStarted={()=>{playbackStarted.current=true}}/>}
   </div>
   {!special&&<Versions value={versions}/>}
   {demo&&<p className="subtle">Big Buck Bunny · Blender Foundation · CC BY 3.0. Отдельный тестовый ролик, не аниме из каталога.</p>}
 </section>
}
function EpisodeNavigator({numbers,episode,season,seasons,select,loading,autoNext}:{numbers:number[];episode:number;season:number;seasons:number[];select:(n:number,s?:number)=>void;loading:boolean;autoNext:boolean}){
 const [expanded,setExpanded]=useState(false);
 const index=numbers.indexOf(episode),previous=index>0?numbers[index-1]:undefined,next=index>=0?numbers[index+1]:undefined;
 const choose=(n:number)=>{select(n);setExpanded(false)};
 if(!loading&&!numbers.length)return seasons.length>1?<div className="empty-season-selector"><label>Другой сезон <select aria-label="Выбрать сезон" value={season} onChange={e=>select(0,Number(e.target.value))}>{seasons.map(n=><option key={n} value={n}>Сезон {n}</option>)}</select></label></div>:null;
 return <section className="episode-navigator" aria-label="Выбор серии">
   <div className="episode-command-bar">
     <div className="episode-selectors">
       <label className="episode-select-field"><span>Сезон</span><select aria-label="Выбрать сезон" value={season} disabled={loading||seasons.length<2} onChange={e=>{select(0,Number(e.target.value));setExpanded(false)}}>{seasons.map(n=><option key={n} value={n}>{n}</option>)}</select><ChevronDown size={13}/></label>
       <label className="episode-select-field episode-main-select"><span>Серия</span><select aria-label="Выбрать серию" value={numbers.includes(episode)?episode:''} disabled={loading||!numbers.length} onChange={e=>choose(Number(e.target.value))}>{!numbers.includes(episode)&&<option value="">{loading?'Загрузка…':'Выберите'}</option>}{numbers.map(n=><option key={n} value={n}>{n}</option>)}</select><ChevronDown size={13}/></label>
     </div>
     <div className="episode-step-controls"><button disabled={previous===undefined} onClick={()=>previous!==undefined&&choose(previous)} aria-label="Предыдущая серия"><ChevronLeft size={19}/><span>Назад</span></button><button disabled={next===undefined} onClick={()=>next!==undefined&&choose(next)} aria-label="Следующая серия"><span>Дальше</span><ChevronRight size={19}/></button></div>
     <button className={'episode-expand'+(expanded?' active':'')} aria-expanded={expanded} aria-controls="episode-collection" onClick={()=>setExpanded(v=>!v)}><ListVideo size={17}/><span>Все серии</span><small>{numbers.length||'—'}</small><ChevronDown size={14}/></button>
   </div>
   {expanded&&<div className="episode-collection" id="episode-collection"><div className="episode-collection-heading"><div><h2>Сезон {season}</h2><p>{loading?'Загружаем серии':`Доступно серий: ${numbers.length}`}</p></div><span className="episode-auto-status">{autoNext?<><Check size={13}/> Автопереход включён</>:'Автопереход выключен'}</span></div>{loading?<p className="subtle" role="status">Загружаем серии…</p>:<EpisodeList numbers={numbers} current={episode} select={choose}/>}</div>}
 </section>
}
function EmptyPlayback({animeId,variants,season,multipleSeasons,retry}:{animeId:string;variants:Anime[];season:number;multipleSeasons:boolean;retry:()=>void}){
 const alternatives=variants.filter(v=>v.id!==animeId&&v.playable);
 return <div className="watch-unavailable"><Monitor size={30}/><h2>{multipleSeasons?`В сезоне ${season} пока нет доступных серий`:'Источник не вернул серии'}</h2><p>{multipleSeasons?'Выберите другой сезон над плеером или проверьте загрузку ещё раз.':'Сейчас этот источник не предоставил видео для просмотра.'}</p><div className="watch-unavailable-actions"><button onClick={retry}><RotateCw size={15}/> Проверить ещё раз</button><Link to={'/anime/'+animeId}>К странице аниме <ChevronRight size={15}/></Link></div>{alternatives.length>0&&<div className="watch-alternatives"><span>Проверить другой источник</span>{alternatives.map(v=><Link key={v.id} to={'/watch/'+v.id}>{v.provider}<ChevronRight size={14}/></Link>)}</div>}</div>
}
function EpisodeList({numbers,current,select}:{numbers:number[];current:number;select:(n:number)=>void}){const [query,setQuery]=useState('');const [page,setPage]=useState(Math.max(0,Math.floor(numbers.indexOf(current)/60)));useEffect(()=>{setPage(Math.max(0,Math.floor(numbers.indexOf(current)/60)))},[current,numbers.join(',')]);const filtered=query?numbers.filter(n=>String(n).includes(query)):numbers.slice(page*60,page*60+60);return <><div className="episode-filter"><label><Search size={14}/><input aria-label="Найти серию" inputMode="numeric" placeholder="Номер серии" value={query} onChange={e=>setQuery(e.target.value)}/></label>{!query&&numbers.length>60&&<select aria-label="Диапазон серий" value={page} onChange={e=>setPage(Number(e.target.value))}>{Array.from({length:Math.ceil(numbers.length/60)},(_,i)=><option key={i} value={i}>{numbers[i*60]}–{numbers[Math.min(numbers.length-1,i*60+59)]}</option>)}</select>}</div><div className="episodes full-episodes">{filtered.map(n=><button aria-current={current===n?'true':undefined} className={current===n?'selected':''} key={n} onClick={()=>select(n)}>{n}</button>)}</div>{!filtered.length&&<p className="subtle">{query?'Такой серии нет.':'Серии пока недоступны.'}</p>}</>}
function studio(v:Voice){let name=v.label.toLowerCase().replace(/[^a-zа-яё0-9]/g,'');if(['anilibriatv','anilibria','aniliberty'].includes(name))name='anilibria';if(['studioband','студийнаябанда'].includes(name))name='studioband';return name+':'+(v.kind||'voice')+':'+languageCode(v.language)}
function VoiceFetch({version,episode,season,onResult}:{version:Anime;episode:number;season:number;onResult:(id:string,voices:Voice[],error?:string)=>void}){
 useEffect(()=>{const ctrl=new AbortController();api<{players:Voice[]}>(`/anime/${version.id}/players?episode=${episode}&season=${season}`,ctrl.signal).then(d=>{if(!ctrl.signal.aborted)onResult(version.id,d.players.map(v=>({...v,sourceId:version.id}))) }).catch(e=>{if(!ctrl.signal.aborted)onResult(version.id,[],e.message)});return()=>ctrl.abort()},[version.id,episode,season]);return null
}
type PlayerOptions={preferences:PlayerPreferences;updatePreferences:(update:Partial<PlayerPreferences>)=>void;fullscreen:boolean;fullscreenHint:string;toggleFullscreen:()=>void;playFullscreen:()=>void;playOnLoad:boolean;onPlaybackStarted:()=>void};
function PlaybackPanel({anime,versions,episode,season,demo,token,next,...options}:{anime:Anime;versions:Anime[];episode:number;season:number;demo:boolean;token:string|null;next?:()=>void}&PlayerOptions){
 const [results,setResults]=useState<Record<string,Voice[]>>({});const [failures,setFailures]=useState<Record<string,string>>({});const [choice,setChoice]=useState<string|null>(null);const [retry,setRetry]=useState(0);const [query,setQuery]=useState('');
 const [language,setLanguage]=useState(()=>read('delta-language','all'));const [kind,setKind]=useState(()=>read('delta-translation-kind','all'));
 const voices=versions.flatMap(v=>results[v.id]||[]);const loading=!demo&&!token&&versions.some(v=>!(v.id in results));
 const selected=voices.find(v=>v.id===choice);const preferred=read('delta-voice','');const preferredPlayer=read('delta-player','');const preferredVoice=voices.find(v=>studio(v)===preferred&&v.player===preferredPlayer)||voices.find(v=>studio(v)===preferred);
 const voice=selected||preferredVoice||((preferred&&loading)?undefined:voices.find(v=>(v.kind||'voice')==='voice'&&languageCode(v.language)==='ru')||voices.find(v=>(v.kind||'voice')==='voice')||voices[0]);
 useEffect(()=>{if(voice&&!selected)setChoice(voice.id)},[voice?.id,selected?.id]);
 const grouped=new Map<string,Voice[]>();for(const v of voices){const key=studio(v);grouped.set(key,[...(grouped.get(key)||[]),v])}
 const groups=[...grouped.entries()].sort((a,b)=>a[1][0].label.localeCompare(b[1][0].label,'ru'));
 const filters=translationFilters(groups.map(([,vs])=>vs[0]),language,kind);
 const visible=groups.filter(([,vs])=>(filters.language==='all'||languageCode(vs[0].language)===filters.language)&&(filters.kind==='all'||(vs[0].kind||'voice')===filters.kind)&&vs[0].label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 const alternatives=voice?grouped.get(studio(voice))||[]:[];
 const refreshedVoices=useRef(new Set<string>());const recoveredPlayback=useRef<{id:string;resume:boolean}|null>(null);const activeVoice=useRef(voice);activeVoice.current=voice;
 async function refreshSource(force=false,resume=false){
   const current=activeVoice.current;if(!current?.sourceId)return false;
   const key=current.sourceId+':'+studio(current)+':'+current.player;
   if(!force&&refreshedVoices.current.has(key))return false;
   refreshedVoices.current.add(key);
   const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),15000);
   try{
     const data=await api<{players:Voice[]}>(`/anime/${current.sourceId}/players?episode=${episode}&season=${season}`,ctrl.signal);
     if(activeVoice.current?.id!==current.id)return false;
     const items=data.players.map(v=>({...v,sourceId:current.sourceId}));
     const replacement=items.find(v=>studio(v)===studio(current)&&v.player===current.player)||items.find(v=>v.label===current.label&&(v.kind||'voice')===(current.kind||'voice')&&v.player===current.player);
     if(!replacement)return false;
     recoveredPlayback.current={id:replacement.id,resume};setResults(old=>({...old,[current.sourceId!]:items}));setChoice(replacement.id);return true;
   }catch{return false}finally{clearTimeout(timer)}
 }
 function receive(id:string,items:Voice[],error?:string){setResults(old=>({...old,[id]:items}));setFailures(old=>({...old,[id]:error||''}))}
 function select(v:Voice){setChoice(v.id);write('delta-voice',studio(v));write('delta-player',v.player)}
 function chooseLanguage(value:string){setLanguage(value);write('delta-language',value)}
 function chooseKind(value:string){setKind(value);write('delta-translation-kind',value)}
 function clearFilters(){setQuery('');chooseLanguage('all');chooseKind('all')}
 return <div className="watch-layout">
   {!demo&&!token&&versions.map(v=><VoiceFetch key={v.id+':'+retry} version={v} episode={episode} season={season} onResult={receive}/>)}
   <div className="screen-column">
     {(demo||token||voice)?<Video key={voice?.id||token||'demo'} anime={anime} episode={episode} season={season} path={demo?'/demo':'/resolve/'+(token||voice?.id)} next={next} refreshSource={!demo&&!token?refreshSource:undefined} {...options} playOnLoad={recoveredPlayback.current&&recoveredPlayback.current.id===voice?.id?recoveredPlayback.current.resume:options.playOnLoad}/>:<div className="video-placeholder">{loading?<><LoaderCircle className="spin"/> Получаем озвучки…</>:<><Play/> Для этой серии пока нет доступных озвучек.</>}</div>}
     {voice&&<div className="voice-current"><div><strong>{voice.label}</strong><span>{(voice.kind||'voice')==='sub'?'Субтитры':'Озвучка'} · {languageLabel(languageCode(voice.language))}</span></div><label>Плеер <select aria-label="Источник выбранной озвучки" value={voice.id} onChange={e=>{const v=voices.find(x=>x.id===e.target.value);if(v)select(v)}}>{alternatives.map(v=><option key={v.id} value={v.id}>{v.player}{v.note?' · подписка':''}</option>)}</select></label></div>}
     {voice?.note&&<p className="subtle">{voice.note}</p>}
     {Object.values(failures).some(Boolean)&&<details className="source-failures"><summary>Некоторые источники не вернули эту серию</summary>{versions.filter(v=>failures[v.id]).map(v=><p key={v.id}>{v.provider}: {failures[v.id]}</p>)}<button onClick={()=>setRetry(n=>n+1)}>Повторить загрузку</button></details>}
   </div>
   {!demo&&!token&&<aside className="voice-panel translation-panel" aria-label="Выбор языка и перевода">
     <div className="voice-title"><h2>Язык и перевод</h2><span aria-label={`Доступно переводов: ${groups.length}`}>{groups.length}</span></div>
     <div className="translation-languages" role="group" aria-label="Язык перевода">
       {['all',...filters.languages].map(lang=><button key={lang} aria-pressed={filters.language===lang} onClick={()=>chooseLanguage(lang)}>{languageLabel(lang)}{lang!=='all'&&<span>{groups.filter(([,vs])=>languageCode(vs[0].language)===lang).length}</span>}</button>)}
     </div>
     <div className="translation-kind" role="group" aria-label="Тип перевода">
       {([{value:'all',label:'Все'},{value:'voice',label:'Озвучка'},{value:'sub',label:'Субтитры'}] as const).map(item=><button key={item.value} aria-pressed={filters.kind===item.value} disabled={item.value!=='all'&&!filters.counts[item.value]} onClick={()=>chooseKind(item.value)}>{item.value==='voice'?<AudioLines size={14}/>:item.value==='sub'?<Captions size={14}/>:null}{item.label}<span>{filters.counts[item.value]}</span></button>)}
     </div>
     <label className="voice-search"><Search size={15}/><input aria-label="Найти студию перевода" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Найти студию"/>{query&&<button type="button" aria-label="Очистить поиск студии" onClick={()=>setQuery('')}><X size={14}/></button>}</label>
     {!loading&&(language!==filters.language||kind!==filters.kind)&&groups.length>0&&<p className="translation-fallback">Сохранённого перевода здесь нет — показаны доступные варианты.</p>}
     <div className="voice-options">
       {visible.map(([key,vs])=><button key={key} className={voice&&studio(voice)===key?'current':''} aria-pressed={!!voice&&studio(voice)===key} onClick={()=>select(vs.find(v=>studio(v)===read('delta-voice','')&&v.player===read('delta-player',''))||vs.find(v=>!v.note)||vs[0])}><span>{vs[0].label}<small>{vs[0].kind==='sub'?'Субтитры · ':''}{filters.language==='all'&&filters.languages.length>1?languageLabel(languageCode(vs[0].language))+' · ':''}{vs.length>1?vs.length+' плеера':vs[0].player+(vs[0].note?' · подписка':'')}</small></span>{voice&&studio(voice)===key&&<Check className="translation-selected" size={15}/>}</button>)}
     </div>
     {loading&&<p className="subtle translation-loading"><LoaderCircle size={12} className="spin"/> Добавляем переводы…</p>}
     {!visible.length&&!loading&&<div className="translation-empty"><p>{query?'Студия не найдена':'Для этой серии пока нет переводов'}</p>{groups.length>0?<button onClick={clearFilters}>Показать все переводы</button>:<button onClick={()=>setRetry(n=>n+1)}>Попробовать снова</button>}</div>}
     <p className="subtle translation-memory">Выбранная студия сохранится для следующих серий.</p>
   </aside>}
 </div>
}
function Video({anime,episode,season,path,next,preferences,updatePreferences,fullscreen,fullscreenHint,toggleFullscreen,playFullscreen,playOnLoad,onPlaybackStarted,refreshSource}:{anime:Anime;episode:number;season:number;path:string;next?:()=>void;refreshSource?:(force?:boolean,resume?:boolean)=>Promise<boolean>}&PlayerOptions){
 const result=useApi<Playback>(path);
 const [index,setIndex]=useState<number|null>(null);const [error,setError]=useState('');const [playing,setPlaying]=useState(false);const [buffering,setBuffering]=useState(false);
 const [position,setPosition]=useState(0);const [duration,setDuration]=useState(0);const [muted,setMuted]=useState(preferences.muted);const [actualVolume,setActualVolume]=useState(preferences.volume);const [volumeOpen,setVolumeOpen]=useState(false);const [settings,setSettings]=useState(false);const [controls,setControls]=useState(true);
 const [notice,setNotice]=useState('');const [recovering,setRecovering]=useState(false);const [countdown,setCountdown]=useState<number|null>(null);
 const video=useRef<HTMLVideoElement>(null);const stage=useRef<HTMLDivElement>(null);const latestPreferences=useRef(preferences);latestPreferences.current=preferences;const desired=useRef(0);const lastSaved=useRef(0);const playOnReady=useRef(playOnLoad);
 const hideTimer=useRef<ReturnType<typeof setTimeout>|null>(null);const noticeTimer=useRef<ReturnType<typeof setTimeout>|null>(null);const skipped=useRef(new Set<string>());const transitioned=useRef(false);const failedStreams=useRef(new Set<string>());const sourceRecoveryAttempted=useRef(false);const alive=useRef(true);const latestPlaying=useRef(playing);latestPlaying.current=playing;const audioState=useRef({volume:preferences.volume,muted:preferences.muted,lastAudibleVolume:preferences.lastAudibleVolume});const volumeControl=useRef<HTMLDivElement>(null);
 const streams=[...(result.data?.streams||[])].sort((a,b)=>(b.quality??9999)-(a.quality??9999)||Number(b.kind==='hls')-Number(a.kind==='hls'));
 const stream=streams[index??preferredStreamIndex(streams,preferences.quality)];const external=!!result.data?.iframe;
 const segments=validSegments(result.data?.skip_segments||[],duration);const active=currentSegment(segments,position);
 const opening=segments.some(s=>s.kind==='opening'),ending=segments.some(s=>s.kind==='ending');
 function flash(message:string){setNotice(message);if(noticeTimer.current)clearTimeout(noticeTimer.current);noticeTimer.current=setTimeout(()=>setNotice(''),2400)}
 function reveal(){setControls(true);if(hideTimer.current)clearTimeout(hideTimer.current);hideTimer.current=setTimeout(()=>setControls(false),3000)}
 function saveProgress(force=false){const el=video.current;if(!el||el.currentTime<1||(!force&&Date.now()-lastSaved.current<5000)||['demo','direct'].includes(anime.id))return;lastSaved.current=Date.now();const map=read<Record<string,Progress>>('delta-progress',{});map[anime.id]={anime,episode,season,time:el.currentTime,updated:Date.now()};write('delta-progress',Object.fromEntries(Object.entries(map).sort((a,b)=>b[1].updated-a[1].updated).slice(0,100)))}
 useEffect(()=>{const saved=read<Record<string,Progress>>('delta-progress',{})[anime.id];desired.current=saved?.episode===episode&&saved?.season===season?saved.time:0;return()=>{if(hideTimer.current)clearTimeout(hideTimer.current);if(noticeTimer.current)clearTimeout(noticeTimer.current)}},[]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 async function recoverSource(force=false){
   if(!refreshSource||(!force&&sourceRecoveryAttempted.current))return false;
   sourceRecoveryAttempted.current=true;setRecovering(true);setError('');
   const refreshed=await refreshSource(force,playOnReady.current);
   if(alive.current)setRecovering(false);
   return refreshed;
 }
 useEffect(()=>{if(result.error&&expiredPlaybackError(result.error))void recoverSource()},[result.error]);
 useEffect(()=>{
   const el=video.current;if(!el||!stream)return;
   let dead=false,handlingFailure=false;let hls:HlsType|undefined;let probe:AbortController|undefined;
   setError('');setPlaying(false);setBuffering(true);
   const ready=()=>{el.playbackRate=latestPreferences.current.speed;el.muted=latestPreferences.current.muted;el.volume=latestPreferences.current.volume;setDuration(Number.isFinite(el.duration)?el.duration:0);if(desired.current&&Number.isFinite(el.duration)){el.currentTime=Math.min(desired.current,Math.max(0,el.duration-2));setPosition(el.currentTime);desired.current=0}if(playOnReady.current)el.play().catch(()=>{if(!dead){setBuffering(false);setControls(true)}})};
   const failed=async(message:string,status?:number)=>{
     if(dead||handlingFailure)return;handlingFailure=true;
     const resume=latestPlaying.current||!el.paused;desired.current=el.currentTime||desired.current;playOnReady.current=resume;failedStreams.current.add(stream.url);
     saveProgress(true);setPlaying(false);setBuffering(true);
     if(status===undefined){
       probe=new AbortController();const timer=setTimeout(()=>probe?.abort(),5000);
       try{const response=await fetch(stream.url,{headers:{Range:'bytes=0-0'},signal:probe.signal});status=response.status;void response.body?.cancel().catch(()=>{})}catch{}finally{clearTimeout(timer)}
     }
     if(dead)return;
     if(status===410){
       if(await recoverSource())return;
       if(dead)return;setError('Ссылка на видео устарела. Нажмите «Попробовать снова», чтобы обновить озвучку.');setBuffering(false);return;
     }
     const alternate=alternateStreamIndex(streams,stream,failedStreams.current);
     if(alternate>=0){flash(`Пробуем ${streams[alternate].kind.toUpperCase()} · та же озвучка`);setIndex(alternate);return}
     setError(message);setBuffering(false);
   };
   const mediaError=()=>{if(el.error&&el.error.code!==1)void failed('Видео не загрузилось. Обновите ссылку или выберите другой плеер.')};
   el.addEventListener('loadedmetadata',ready);el.addEventListener('error',mediaError);
   if(stream.kind==='hls'&&!el.canPlayType('application/vnd.apple.mpegurl')){
     import('hls.js').then(({default:Hls})=>{if(dead)return;if(!Hls.isSupported()){void failed('HLS недоступен в этом браузере. Выберите MP4 в настройках качества.',200);return}hls=new Hls();hls.loadSource(stream.url);hls.attachMedia(el);hls.on(Hls.Events.ERROR,(_,d)=>{if(d.fatal)void failed('Поток не загрузился. Обновите ссылку или выберите другой плеер.',d.response?.code)})}).catch(()=>{if(!dead)void failed('Не удалось загрузить видеоплеер.',200)});
   }else{el.src=stream.url;el.load()}
   return()=>{saveProgress(true);dead=true;probe?.abort();el.removeEventListener('loadedmetadata',ready);el.removeEventListener('error',mediaError);hls?.destroy();el.pause();el.removeAttribute('src');el.load()};
 },[stream?.url]);
 useEffect(()=>{audioState.current={volume:preferences.volume,muted:preferences.muted,lastAudibleVolume:preferences.lastAudibleVolume};if(video.current){video.current.playbackRate=preferences.speed;video.current.muted=preferences.muted;video.current.volume=preferences.volume;setActualVolume(video.current.volume);setMuted(video.current.muted)}},[preferences.speed,preferences.volume,preferences.muted,preferences.lastAudibleVolume]);
 useEffect(()=>{if(!volumeOpen)return;const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!volumeControl.current?.contains(event.target))setVolumeOpen(false)};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside)},[volumeOpen]);
 useEffect(()=>{if(countdown===null)return;const timer=setInterval(()=>setCountdown(n=>n===null?null:Math.max(0,n-1)),1000);return()=>clearInterval(timer)},[countdown!==null]);
 useEffect(()=>{if(countdown===0&&!transitioned.current&&next){transitioned.current=true;next()}},[countdown,next]);
 useEffect(()=>{if(!preferences.autoNext)setCountdown(null)},[preferences.autoNext]);
 function togglePlay(){setVolumeOpen(false);const el=video.current;if(!el||!stream)return;setCountdown(null);transitioned.current=false;reveal();if(el.paused){playFullscreen();el.play().catch(()=>flash('Нажмите ещё раз, чтобы начать просмотр.'))}else el.pause()}
 function seek(to:number){const el=video.current;if(!el||!Number.isFinite(el.duration))return;el.currentTime=Math.min(Math.max(to,0),el.duration);setPosition(el.currentTime);setCountdown(null);saveProgress(true);reveal()}
 function skip(end:number,kind:string){const el=video.current;if(!el)return;seek(end);flash(kind==='ending'?'Эндинг пропущен':'Опенинг пропущен')}
 function tick(){const el=video.current;if(!el)return;setPosition(el.currentTime);saveProgress();if(el.paused)return;const segment=currentSegment(validSegments(result.data?.skip_segments||[],el.duration),el.currentTime);if(segment&&shouldAutoSkip(segment,preferences)){const key=`${segment.kind}:${segment.start}:${segment.end}`;if(!skipped.current.has(key)){skipped.current.add(key);skip(segment.end,segment.kind)}}}
 function applyAudio(action:VolumeAction){
   const el=video.current;const next=changeVolume({...audioState.current,volume:el?.volume??actualVolume,muted:el?.muted??muted},action);
   if(next.volume===audioState.current.volume&&next.muted===audioState.current.muted&&next.lastAudibleVolume===audioState.current.lastAudibleVolume&&(!el||(el.volume===next.volume&&el.muted===next.muted)))return;
   audioState.current=next;
   if(el){el.muted=next.muted;el.volume=next.volume;setActualVolume(el.volume);setMuted(el.muted)}else{setActualVolume(next.volume);setMuted(next.muted)}
   updatePreferences(next);reveal();
 }
 function volumeInput(e:React.FormEvent<HTMLInputElement>){applyAudio({type:'set',value:Number(e.currentTarget.value)})}
 function syncAudio(){const el=video.current;if(!el)return;setActualVolume(el.volume);setMuted(el.muted);audioState.current={...audioState.current,volume:el.volume,muted:el.muted}}
 function toggleSettings(){setVolumeOpen(false);setSettings(v=>!v)}
 async function reload(){desired.current=video.current?.currentTime||position;playOnReady.current=latestPlaying.current||!!video.current&&!video.current.paused;saveProgress(true);failedStreams.current.clear();setError('');if(await recoverSource(true))return;if(alive.current){setIndex(null);result.reload()}}
 function keydown(e:React.KeyboardEvent<HTMLDivElement>){if(e.key==='Escape'&&(settings||volumeOpen)){setSettings(false);setVolumeOpen(false);return}if(e.target instanceof HTMLElement&&(/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName)||e.target.isContentEditable))return;if(e.metaKey||e.ctrlKey||e.altKey)return;const key=e.key.toLowerCase();if([' ','k','arrowleft','arrowright','arrowup','arrowdown','f','m','n'].includes(key))e.preventDefault();if(key===' '||key==='k')togglePlay();if(key==='arrowleft')seek(position-10);if(key==='arrowright')seek(position+10);if(key==='m')applyAudio({type:'toggle'});if(key==='arrowup')applyAudio({type:'adjust',value:.05});if(key==='arrowdown')applyAudio({type:'adjust',value:-.05});if(key==='f')toggleFullscreen();if(key==='n'&&next)next();reveal()}
 const visible=controls||!playing||settings||volumeOpen||countdown!==null;const silent=muted||actualVolume===0;const volumePercent=Math.round(actualVolume*100);
 return <div className="cinema-video">
   <div className={'player-stage'+(visible?' controls-visible':'')+(external?' external-stage':'')} ref={stage} tabIndex={0} aria-label="Видеоплеер. Пробел — пауза, влево и вправо — перемотка, вверх и вниз — громкость, F — полный экран" onKeyDown={keydown} onPointerMove={reveal} onFocus={reveal}>
     {external?<iframe title="Внешний плеер источника" src={result.data!.iframe} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen sandbox="allow-scripts allow-same-origin allow-presentation" referrerPolicy="strict-origin-when-cross-origin"/>:<video ref={video} playsInline onClick={togglePlay} onDoubleClick={toggleFullscreen} onPlaying={()=>{onPlaybackStarted();setError('');setPlaying(true);setBuffering(false);reveal()}} onPause={()=>{setPlaying(false);saveProgress(true)}} onCanPlay={()=>{if(!video.current?.error)setError('');setBuffering(false)}} onWaiting={()=>setBuffering(true)} onTimeUpdate={tick} onDurationChange={()=>setDuration(Number.isFinite(video.current?.duration)?video.current!.duration:0)} onEnded={()=>{setPlaying(false);saveProgress(true);if(preferences.autoNext&&next){setCountdown(8);transitioned.current=false}}} onVolumeChange={syncAudio}/>}
     {(result.error||error)&&!recovering&&<div className="player-error" role="alert"><strong>Не удалось начать просмотр</strong><p>{result.error||error}</p><button onClick={reload}><RotateCw size={15}/> Попробовать снова</button></div>}
     {!external&&(!result.error||recovering)&&!error&&(result.loading||buffering||recovering)&&<div className="player-loading" role="status"><LoaderCircle size={28} className="spin"/><span>{recovering?'Обновляем ссылку':result.loading?'Открываем серию':'Загружаем видео'}</span></div>}
     {!external&&!playing&&!result.loading&&!buffering&&!recovering&&!error&&stream&&countdown===null&&<button className="player-center-play" aria-label="Начать просмотр" onClick={togglePlay}><Play fill="currentColor" size={30}/></button>}
     {notice&&<div className="player-toast" role="status"><Check size={15}/>{notice}</div>}
     {!external&&active&&countdown===null&&<button className="player-skip" onClick={()=>skip(active.end,active.kind)}><SkipForward size={16}/>Пропустить {active.kind==='ending'?'эндинг':'опенинг'}</button>}
     {countdown!==null&&next&&<div className="player-next-card" role="status"><span>История продолжается</span><strong>Следующая серия через {countdown} с</strong><div><button className="player-next-play" onClick={()=>{transitioned.current=true;next()}}><Play size={15} fill="currentColor"/> Смотреть сейчас</button><button onClick={()=>setCountdown(null)}>Остаться</button></div><div className="player-countdown-track"><i style={{width:countdown/8*100+'%'}}/></div></div>}
     {!external&&<div className="movie-controls" onPointerDown={e=>e.stopPropagation()}>
       <div className="movie-progress"><input aria-label="Позиция воспроизведения" type="range" min="0" max={duration||1} step="0.1" value={Math.min(position,duration||1)} disabled={!duration} onChange={e=>seek(Number(e.target.value))} style={{'--progress':(duration?position/duration*100:0)+'%'} as React.CSSProperties}/></div>
       <div className="movie-control-row"><button onClick={togglePlay} disabled={!stream} aria-label={playing?'Приостановить':'Воспроизвести'} title="Пробел / K">{playing?<Pause size={21} fill="currentColor"/>:<Play size={21} fill="currentColor"/>}</button><button onClick={()=>seek(position-10)} disabled={!duration} aria-label="Назад на 10 секунд" title="← 10 секунд"><Rewind size={19}/></button><button onClick={()=>seek(position+10)} disabled={!duration} aria-label="Вперёд на 10 секунд" title="→ 10 секунд"><FastForward size={19}/></button><div className={'movie-volume'+(volumeOpen?' is-open':'')} ref={volumeControl}>
         <button onClick={()=>applyAudio({type:'toggle'})} aria-label={silent?'Включить звук':'Выключить звук'} title="M">{silent?<VolumeX size={20}/>:actualVolume<.5?<Volume1 size={20}/>:<Volume2 size={20}/>}</button>
         <input className="movie-volume-inline" aria-label="Громкость" aria-valuetext={`${volumePercent}%${muted?', звук выключен':''}`} type="range" min="0" max="1" step="0.05" value={actualVolume} onInput={volumeInput} onChange={volumeInput}/>
         <button className="movie-volume-expand" onClick={()=>{setSettings(false);setVolumeOpen(v=>!v)}} aria-label="Настроить громкость" aria-expanded={volumeOpen} aria-controls="volume-settings" title={`Громкость ${volumePercent}%`}><ChevronUp size={13}/></button>
         {volumeOpen&&<div className="movie-volume-panel" id="volume-settings" role="dialog" aria-label="Настройка громкости"><div><strong>Громкость</strong><output>{silent?'Выкл.':volumePercent+'%'}</output></div><div className="movie-volume-adjust"><button aria-label="Уменьшить громкость на 5%" onClick={()=>applyAudio({type:'adjust',value:-.05})} disabled={actualVolume===0}><Minus size={17}/></button><input aria-label="Уровень громкости" aria-valuetext={`${volumePercent}%${muted?', звук выключен':''}`} type="range" min="0" max="1" step="0.05" value={actualVolume} onInput={volumeInput} onChange={volumeInput}/><button aria-label="Увеличить громкость на 5%" onClick={()=>applyAudio({type:'adjust',value:.05})} disabled={actualVolume===1&&!muted}><Plus size={17}/></button></div><small>{silent?'Нажмите значок звука, чтобы включить':'↑ ↓ — изменить громкость'}</small></div>}
       </div><span className="movie-time">{timeLabel(position)} <span>/ {timeLabel(duration)}</span></span><div className="movie-controls-spacer"/><button className="movie-speed" onClick={toggleSettings} aria-label="Скорость воспроизведения">{preferences.speed}×</button>{next&&<button onClick={next} aria-label="Следующая серия в плеере" title="N"><SkipForward size={21}/></button>}<button className={settings?'active':''} onClick={toggleSettings} aria-label="Настройки плеера" aria-expanded={settings}><Settings2 size={20}/></button><button className="movie-theatre" onClick={()=>updatePreferences({theatre:!preferences.theatre})} aria-label="Режим кинотеатра" aria-pressed={preferences.theatre}><Monitor size={20}/></button><button onClick={toggleFullscreen} aria-label={fullscreen?'Выйти из полного экрана':'Полный экран'} title="F">{fullscreen?<Minimize size={20}/>:<Maximize size={20}/>}</button></div>
     </div>}
     {settings&&<div className="movie-settings" role="dialog" aria-label="Настройки плеера"><div className="movie-settings-heading"><div><span>ВАШ ПРОСМОТР</span><h3>Настройки плеера</h3></div><button aria-label="Закрыть настройки плеера" onClick={()=>setSettings(false)}><X size={19}/></button></div><div className="movie-settings-scroll">
       <Setting checked={preferences.skipOpening} onChange={v=>updatePreferences({skipOpening:v})} title="Пропускать опенинг" note={opening?'По таймкодам этой серии':'Включится в сериях с таймкодами'} disabled={external}/>
       <Setting checked={preferences.skipEnding} onChange={v=>updatePreferences({skipEnding:v})} title="Пропускать эндинг" note={ending?'Сцены после эндинга сохранятся':'Включится в сериях с таймкодами'} disabled={external}/>
       <Setting checked={preferences.autoNext} onChange={v=>updatePreferences({autoNext:v})} title="Следующая серия" note="Автоматически, с отсчётом 8 секунд" disabled={external}/>
       <Setting checked={preferences.autoFullscreen} onChange={v=>updatePreferences({autoFullscreen:v})} title="Автоматически на весь экран" note="После нажатия кнопки воспроизведения" disabled={external}/>
       <label className="movie-setting-select"><span>Скорость</span><select aria-label="Скорость видео" value={preferences.speed} disabled={external} onChange={e=>updatePreferences({speed:Number(e.target.value)})}>{[.5,.75,1,1.25,1.5,1.75,2].map(speed=><option key={speed} value={speed}>{speed}×{speed===1?' · обычная':''}</option>)}</select></label>
       <label className="movie-setting-select"><span>Качество</span><select aria-label="Качество видео" value={index??preferredStreamIndex(streams,preferences.quality)} disabled={!streams.length} onChange={e=>{const selected=Number(e.target.value);desired.current=video.current?.currentTime||position;playOnReady.current=!!video.current&&!video.current.paused;setIndex(selected);updatePreferences({quality:streams[selected]?.quality||0})}}>{streams.map((s,i)=><option value={i} key={i}>{s.quality?s.quality+'p':'Авто'} · {s.kind.toUpperCase()}</option>)}</select></label>
       <div className="movie-keyboard"><span>Горячие клавиши</span><p><kbd>Пробел</kbd> пауза <kbd>←</kbd><kbd>→</kbd> 10 сек. <kbd>↑</kbd><kbd>↓</kbd> звук <kbd>F</kbd> полный экран</p></div><p className="movie-settings-footnote">Настройки сохраняются в этом браузере.{external?' Автоматизация недоступна во внешнем плеере.':''}</p>
     </div></div>}
   </div>
   <div className="cinema-status"><span><i className={playing?'on':''}/>{result.error||error?'Поток недоступен':external?'Внешний плеер':playing?'Воспроизводится':stream?'Готово к просмотру':'Открываем видео'}{stream?.quality&&<b>{stream.quality}p</b>}</span><div><button onClick={toggleSettings} aria-label="Открыть настройки плеера"><Settings2 size={15}/> Настройки</button>{external&&<button onClick={toggleFullscreen} aria-label="Полный экран внешнего плеера"><Maximize size={16}/></button>}<button aria-label="Обновить ссылку на поток" title="Обновить ссылку" onClick={reload}><RotateCw size={15}/></button></div></div>
   {fullscreenHint&&<p className="player-hint" role="status">{fullscreenHint}</p>}{external&&<p className="player-hint">Перемотка, прогресс и автопереход управляются внешним плеером. Следующую серию можно выбрать вручную.</p>}
 </div>
}
function Setting({checked,onChange,title,note,disabled}:{checked:boolean;onChange:(v:boolean)=>void;title:string;note:string;disabled?:boolean}){return <label className={'movie-setting-toggle'+(disabled?' disabled':'')}><span><strong>{title}</strong><small>{note}</small></span><input type="checkbox" role="switch" aria-label={title} checked={checked} disabled={disabled} onChange={e=>onChange(e.target.checked)}/><i aria-hidden="true"/></label>}
