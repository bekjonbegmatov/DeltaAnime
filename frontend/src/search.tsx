import {useEffect,useMemo,useRef,useState} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {ArrowDown,ArrowRight,ArrowUp,ArrowUpDown,Check,ChevronDown,Clock3,LayoutGrid,LoaderCircle,Play,RotateCw,Search,SlidersHorizontal,Table2,X} from 'lucide-react';
import {Anime,Source,SearchResult,api,merge,read,useApi,write} from './api';
import {Grid,ErrorBox,Poster} from './components';
import {FORMAT_NAMES,SEARCH_SORT_LABELS,SearchSort,SearchSortKey,SearchView,episodeCount,formatOf,numberValue,searchHistory,searchQuery,searchSort,searchView,sortSearchResults,sourceNames,titleCount} from './search-utils';
import './search.css';

const HISTORY_KEY='delta-search-history',VIEW_KEY='delta-search-view';
const EMPTY_OUTCOMES:Record<string,SearchResult>={};
type SearchState={key:string;outcomes:Record<string,SearchResult>;pending:string[];waiting:boolean};
const metadataSource=(source:Source)=>/метадан|информац|metadata/i.test(source.type)||['anilist','jikan','kitsu','shikimori'].includes(source.id);

export function useFederated(query:string,sources:Source[],composing=false){
 const ids=sources.map(s=>s.id).join(','),key=query+'\u0000'+ids;
 const [state,setState]=useState<SearchState>({key:'',outcomes:{},pending:[],waiting:false});
 const generation=useRef(0),controllers=useRef(new Map<string,{controller:AbortController;timeout:number}>());
 const queued=useRef<{query:string;start:()=>void}|null>(null),immediate=useRef<string|null>(null);
 function abortAll(){controllers.current.forEach(({controller,timeout})=>{controller.abort();window.clearTimeout(timeout)});controllers.current.clear()}
 function run(source:Source,q:string,version:number){
  const previous=controllers.current.get(source.id);if(previous){previous.controller.abort();window.clearTimeout(previous.timeout)}
  const controller=new AbortController();
  const current=()=>!controller.signal.aborted&&generation.current===version;
  const failure=(message:string)=>setState(old=>({...old,outcomes:{...old.outcomes,[source.id]:{source:source.id,status:'error',items:[],message}},pending:old.pending.filter(id=>id!==source.id)}));
  const timeout=window.setTimeout(()=>{if(current()){failure('Источник отвечает слишком долго. Попробуйте ещё раз.');controller.abort();controllers.current.delete(source.id)}},30000);
  controllers.current.set(source.id,{controller,timeout});
  setState(old=>({...old,pending:old.pending.includes(source.id)?old.pending:[...old.pending,source.id]}));
  api<SearchResult>('/search?provider='+encodeURIComponent(source.id)+'&q='+encodeURIComponent(q),controller.signal)
   .then(result=>{if(!current())return;if(!result||!Array.isArray(result.items))throw new Error('Источник вернул неполный ответ.');setState(old=>({...old,outcomes:{...old.outcomes,[source.id]:{...result,source:source.id}}}))})
   .catch(error=>{if(current())failure(error instanceof Error?error.message:'Источник временно недоступен.')})
   .finally(()=>{window.clearTimeout(timeout);if(current()){controllers.current.delete(source.id);setState(old=>({...old,pending:old.pending.filter(id=>id!==source.id)}))}});
 }
 useEffect(()=>{
  const version=++generation.current;abortAll();queued.current=null;
  const valid=query.length>=2&&sources.length>0&&!composing;
  setState({key,outcomes:{},pending:[],waiting:valid});
  let timer:number|undefined;
  if(valid){
   const start=()=>{window.clearTimeout(timer);queued.current=null;if(generation.current!==version)return;setState({key,outcomes:{},pending:sources.map(s=>s.id),waiting:false});sources.forEach(source=>run(source,query,version))};
   queued.current={query,start};
   if(immediate.current===query){immediate.current=null;start()}else timer=window.setTimeout(start,300);
  }
  return()=>{window.clearTimeout(timer);queued.current=null;abortAll()};
 },[key,composing]);
 function flush(q:string){if(queued.current?.query===q){queued.current.start();immediate.current=null}else if(q!==query)immediate.current=q}
 function retry(){if(query.length<2||state.key!==key)return;const failed=Object.entries(state.outcomes).filter(([,r])=>r.status!=='ok').map(([id])=>id);sources.filter(s=>failed.includes(s.id)).forEach(s=>run(s,query,generation.current))}
 return {outcomes:state.key===key&&!composing?state.outcomes:EMPTY_OUTCOMES,pending:state.key===key&&!composing?state.pending:[],waiting:query.length>=2&&(state.key!==key||state.waiting||composing),retry,flush};
}

function ResultTable({items,sort,onSort}:{items:Anime[];sort:SearchSort;onSort:(key:SearchSortKey)=>void}){
 const columns:{key:SearchSortKey;title:string}[]=[{key:'title',title:'Название'},{key:'year',title:'Год'},{key:'rating',title:'Рейтинг'},{key:'episodes',title:'Серии'},{key:'source',title:'Источник'}];
 return <>
  <p className="search-table-hint">Прокрутите таблицу, чтобы увидеть все данные <ArrowRight size={12}/></p>
  <div className="search-table-scroll" role="region" aria-label="Результаты поиска в таблице" tabIndex={0}>
   <table className="search-table"><caption className="search-visually-hidden">Аниме и доступные источники. Нажмите заголовок столбца для сортировки.</caption>
    <thead><tr>{columns.map(column=>{const active=sort.key===column.key,nextDirection=active&&sort.direction==='asc'?'desc':active?'asc':searchSort(column.key).direction;return <th key={column.key} scope="col" aria-sort={active?(sort.direction==='asc'?'ascending':'descending'):'none'}><button onClick={()=>onSort(column.key)} aria-label={`${column.title}: сортировать по ${nextDirection==='asc'?'возрастанию':'убыванию'}`}>{column.title}{active?(sort.direction==='asc'?<ArrowUp size={12}/>:<ArrowDown size={12}/>):<ArrowUpDown size={12}/>}</button></th>})}<th scope="col"><span className="search-visually-hidden">Открыть</span></th></tr></thead>
    <tbody>{items.map(anime=>{const providers=sourceNames(anime),rating=numberValue(anime.rating),year=numberValue(anime.year),episodes=episodeCount(anime),available=numberValue(anime.available_episodes,true);return <tr key={anime.id}>
     <td className="search-table-title"><Link to={'/anime/'+anime.id}><span className="search-table-poster" aria-hidden="true"><Poster anime={anime}/></span><span className="search-table-name"><strong>{anime.title}</strong>{anime.original_title&&anime.original_title!==anime.title&&<span className="search-table-original">{anime.original_title}</span>}<span className="search-table-format">{FORMAT_NAMES[formatOf(anime)]}</span></span></Link></td>
     <td className="search-table-number">{year??<span className="search-missing">—</span>}</td>
     <td className="search-table-number">{rating===null?<span className="search-missing">—</span>:<><span className="search-table-rating">{rating.toFixed(1)}</span><small>{anime.rating_source||anime.provider}</small></>}</td>
     <td className="search-table-number">{episodes??<span className="search-missing">—</span>}{available!==null&&numberValue(anime.episodes_total)!==null&&available!==episodes&&<small>{available} доступно</small>}</td>
     <td className="search-table-provider"><span title={providers.join(', ')}>{anime.provider}{providers.length>1&&<b>+{providers.length-1}</b>}</span><small className="search-available"><Play size={10}/> Есть просмотр</small></td>
     <td className="search-table-action"><Link to={'/watch/'+anime.id} aria-label={'Смотреть: '+anime.title} title="Смотреть"><Play size={16}/></Link></td>
    </tr>})}</tbody>
   </table>
  </div>
 </>;
}
function ResultSkeleton({view}:{view:SearchView}){
 return view==='table'?<div className="search-table-skeleton" role="status" aria-label="Ищем аниме">{Array.from({length:5},(_,i)=><div key={i}><span/><span/><span/><span/></div>)}</div>:<div className="search-skeletons" role="status" aria-label="Ищем аниме">{Array.from({length:6},(_,i)=><div key={i}><div/><span/><span/></div>)}</div>;
}

export function SearchPage(){
 const [params,setParams]=useSearchParams(),query=searchQuery(params.get('q'));
 const [input,setInput]=useState(query),[composing,setComposing]=useState(false),[history,setHistory]=useState(()=>searchHistory(read(HISTORY_KEY,[])));
 const [savedView,setSavedView]=useState(()=>searchView(read(VIEW_KEY,'grid'))),[showFilters,setShowFilters]=useState(false);
 const inputRef=useRef<HTMLInputElement>(null),sourceData=useApi<{sources:Source[]}>('/sources');
 const sources=sourceData.data?.sources.filter(s=>s.search&&s.playback!==false&&(s.playback===true||!metadataSource(s)))||[],search=useFederated(query,sources,composing);
 const requestedSource=params.get('source')||'all',source=sources.some(s=>s.id===requestedSource)?requestedSource:'all',year=params.get('year')||'',format=params.get('format')||'';
 const view=searchView(params.get('view'),savedView),sort=searchSort(params.get('sort'),params.get('order'));
 useEffect(()=>setInput(current=>searchQuery(current)===query?current:query),[query]);
 useEffect(()=>{if(params.has('view')){setSavedView(view);write(VIEW_KEY,view)}},[view,params]);
 function updateParams(changes:Record<string,string|undefined>,replace=true){setParams(current=>{const next=new URLSearchParams(current);for(const [key,value]of Object.entries(changes)){if(value)next.set(key,value);else next.delete(key)}return next},{replace})}
 function changeInput(value:string){setInput(value);const q=searchQuery(value);updateParams({q:q||undefined})}
 function remember(q:string){const next=searchHistory([q,...history]);setHistory(next);write(HISTORY_KEY,next)}
 function submit(value:string){const q=searchQuery(value);setInput(q);if(q.length<2)return;remember(q);search.flush(q);updateParams({q},q===query);inputRef.current?.focus()}
 function clearQuery(){setInput('');updateParams({q:undefined});inputRef.current?.focus()}
 function clearFilters(){updateParams({source:undefined,year:undefined,format:undefined,playable:undefined})}
 function forget(q:string){const next=history.filter(old=>old!==q);setHistory(next);write(HISTORY_KEY,next)}
 function changeView(next:SearchView){setSavedView(next);write(VIEW_KEY,next);updateParams({view:next})}
 function changeSort(key:SearchSortKey,toggle=false){const next=searchSort(key,toggle&&key===sort.key?(sort.direction==='asc'?'desc':'asc'):undefined);updateParams({sort:next.key==='relevance'?undefined:next.key,order:next.direction})}
 // Source order is stable, so the representative of a merged title does not depend on response timing.
 const all=useMemo(()=>merge(sources.flatMap(s=>search.outcomes[s.id]?.items||[]).filter(a=>a.playable===true)),[sources.map(s=>s.id).join(','),search.outcomes]);
 const selected=source==='all'?all:merge((search.outcomes[source]?.items||[]).filter(a=>a.playable===true));
 const years=[...new Set(all.map(a=>numberValue(a.year)).filter((y):y is number=>y!==null))].sort((a,b)=>b-a);
 const formats=[...new Set(all.map(formatOf))].filter(f=>f!=='unknown');
 const items=sortSearchResults(selected.filter(a=>(!year||String(a.year)===year)&&(!format||formatOf(a)===format)&&a.playable===true),sort,query);
 const failures=Object.values(search.outcomes).filter(r=>r.status!=='ok'),searched=query.length>=2;
 const filtersCount=Number(source!=='all')+Number(!!year)+Number(!!format),chosenSource=sources.find(s=>s.id===source);
 const fetching=searched&&(search.waiting||search.pending.length>0||sourceData.loading),noSources=!sourceData.loading&&!sourceData.error&&!sources.length;
 const allFailed=!fetching&&sources.length>0&&failures.length===sources.length,waitingChosen=source!=='all'&&search.pending.includes(source);
 const failedChosen=source!=='all'&&search.outcomes[source]?.status!=='ok'&&!!search.outcomes[source];
 const completed=sources.length-search.pending.length,waitingForResults=fetching&&(search.waiting||sourceData.loading||source==='all'||waitingChosen);
 return <section className="cinema-search" onClickCapture={event=>{if((event.target as HTMLElement).closest('a[href^="/anime/"],a[href^="/watch/"]'))remember(query)}}>
  <div className="search-page-title"><div><span className="search-kicker">Поиск аниме</span><h1>Что будем смотреть?</h1></div><Link to="/catalog">Открыть каталог <ArrowRight size={16}/></Link></div>
  <form className="cinema-search-field" role="search" aria-label="Поиск по всем источникам" onSubmit={event=>{event.preventDefault();if(!composing)submit(input)}}>
   <Search size={25} aria-hidden="true"/><input ref={inputRef} type="search" name="q" value={input} onChange={e=>changeInput(e.target.value)} onCompositionStart={()=>setComposing(true)} onCompositionEnd={()=>setComposing(false)} onKeyDown={e=>{if(e.key==='Escape'&&!composing)clearQuery()}} aria-label="Название аниме" aria-describedby="search-input-help" placeholder="Название на русском, английском или японском" autoComplete="off" maxLength={100}/>
   {input&&<button className="search-clear" type="button" aria-label="Очистить поиск" onClick={clearQuery}><X size={19}/></button>}
   <button className="search-submit" type="submit" disabled={query.length<2||composing}>Найти <ArrowRight size={17}/></button>
  </form>
  <div className="search-field-meta"><span id="search-input-help" className={'search-live-status'+(fetching?' is-searching':'')}><i aria-hidden="true"/>{query.length===1?'Введите ещё хотя бы один символ':'Поиск по мере ввода · источники просмотра'}</span><span className="search-key-hint"><kbd>↵</kbd> искать сейчас <kbd>esc</kbd> очистить</span></div>
  {!query&&<div className="search-start">
   {history.length>0&&<section className="search-history"><div className="search-minor-heading"><h2><Clock3 size={16}/> Недавно искали</h2><button onClick={()=>{setHistory([]);write(HISTORY_KEY,[])}}>Очистить</button></div><div className="search-history-list">{history.map(q=><div key={q}><button onClick={()=>submit(q)}>{q}<ArrowRight size={15}/></button><button aria-label={'Удалить запрос '+q} onClick={()=>forget(q)}><X size={13}/></button></div>)}</div></section>}
   <div className="search-explore"><div><span className="search-kicker">Если ещё не выбрали</span><h2>Можно начать отсюда</h2><p>Текущий сезон, лучшие по рейтингу или фильм на один вечер.</p></div><div className="search-destinations"><Link to="/catalog?status=ongoing"><span>Новые эпизоды</span><strong>Сейчас выходит</strong><ArrowRight size={22}/></Link><Link to="/top"><span>Выбор зрителей</span><strong>Лучшее аниме</strong><ArrowRight size={22}/></Link><Link to="/catalog?kind=MOVIE"><span>На один вечер</span><strong>Полнометражные</strong><ArrowRight size={22}/></Link></div></div>
  </div>}
  {sourceData.error&&<ErrorBox error={sourceData.error} retry={sourceData.reload}/>}
  {searched&&<>
   <div className="search-results-toolbar"><div className="search-provider-tabs" role="group" aria-label="Источники поиска"><button aria-pressed={source==='all'} onClick={()=>updateParams({source:undefined})}>Все источники <span>{all.length}</span></button>{sources.map(s=>{const outcome=search.outcomes[s.id],pending=search.pending.includes(s.id);return <button key={s.id} aria-pressed={source===s.id} className={outcome?.status!=='ok'&&outcome?'search-provider-unavailable':''} onClick={()=>updateParams({source:s.id})} title={s.name+' · Каталог и просмотр'+(outcome?.message?' · '+outcome.message:'')}><Play size={10} aria-hidden="true"/>{s.name}<span className="search-visually-hidden"> — просмотр</span>{pending?<LoaderCircle size={12} className="search-spinner" aria-label="Поиск"/>:outcome?.status==='ok'?<span>{merge(outcome.items.filter(a=>a.playable===true)).length}</span>:outcome?<span className="provider-offline" aria-label="Источник недоступен">!</span>:null}</button>})}</div><button className="search-filters-toggle" aria-expanded={showFilters} aria-controls="search-filter-panel" onClick={()=>setShowFilters(v=>!v)}><SlidersHorizontal size={16}/> Фильтры {filtersCount>0&&<b>{filtersCount}</b>}<ChevronDown size={13}/></button></div>
   {showFilters&&<div className="search-filter-panel" id="search-filter-panel"><label>Год<select aria-label="Год аниме" value={year} onChange={e=>updateParams({year:e.target.value})}><option value="">Все годы</option>{year&&!years.map(String).includes(year)&&<option value={year}>{year}</option>}{years.map(y=><option key={y} value={y}>{y}</option>)}</select></label><label>Формат<select aria-label="Формат аниме" value={format} onChange={e=>updateParams({format:e.target.value})}><option value="">Все форматы</option>{[...new Set([...formats,...(format?[format]:[])])].map(f=><option key={f} value={f}>{FORMAT_NAMES[f]||f}</option>)}</select></label>{filtersCount>0&&<button className="search-reset" onClick={clearFilters}>Сбросить фильтры <X size={13}/></button>}<p>В выдаче только версии с просмотром. Фильтры применяются к найденным результатам.</p></div>}
   <div className="search-results-heading"><div className="search-result-summary"><h2>Результаты для «{query}»</h2><span role="status" aria-live="polite" aria-atomic="true">{fetching?<><LoaderCircle className="search-spinner" size={12}/>{sourceData.loading?'Подключаем источники…':search.waiting?'Ищем аниме…':`${items.length?items.length+' найдено · ':''}Проверено ${completed} из ${sources.length} источников`}</>:`${items.length} ${titleCount(items.length)}${chosenSource?' · '+chosenSource.name:''}`}</span></div>
    <div className="search-result-controls"><div className="search-sort-controls"><label className="search-sort"><span className="search-visually-hidden">Сортировка</span><select aria-label="Сортировка результатов" value={sort.key} onChange={e=>changeSort(e.target.value as SearchSortKey)}>{Object.entries(SEARCH_SORT_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><button className="search-sort-direction" onClick={()=>updateParams({order:sort.direction==='asc'?'desc':'asc'})} aria-label={'Изменить направление: сейчас по '+(sort.direction==='asc'?'возрастанию':'убыванию')} title={sort.direction==='asc'?'По возрастанию':'По убыванию'}>{sort.direction==='asc'?<ArrowUp size={14}/>:<ArrowDown size={14}/>}</button></div><div className="search-view-switch" data-view={view} role="group" aria-label="Вид результатов"><button aria-pressed={view==='grid'} onClick={()=>changeView('grid')}><LayoutGrid size={15}/><span>Карточки</span></button><button aria-pressed={view==='table'} onClick={()=>changeView('table')}><Table2 size={15}/><span>Таблица</span></button></div></div>
   </div>
   {failures.length>0&&<div className="search-partial"><span>{failures.length===sources.length?'Источники пока не ответили.':`Не удалось проверить: ${failures.map(f=>sources.find(s=>s.id===f.source)?.name||f.source).join(', ')}.`}{failures.length!==sources.length&&' Остальные результаты доступны.'}</span><button onClick={search.retry} disabled={failures.some(f=>search.pending.includes(f.source))}><RotateCw size={13}/> Повторить</button></div>}
   <div className="search-result-body" aria-busy={fetching}>
    {sourceData.error?null:items.length>0?(view==='table'?<ResultTable items={items} sort={sort} onSort={key=>changeSort(key,true)}/>:<Grid items={items}/>):waitingForResults?<ResultSkeleton view={view}/>:<div className="search-empty"><Search size={31}/><h2>{noSources?'Нет источников просмотра':allFailed?'Источники временно недоступны':failedChosen?'Источник временно недоступен':all.length&&filtersCount?'Ничего под эти фильтры':'Не нашли доступных версий'}</h2><p>{noSources?'Не удалось получить список источников для поиска. Попробуйте обновить его.':allFailed?'Не удалось проверить наличие аниме. Повторите поиск через некоторое время.':failedChosen?'Попробуйте другие источники или повторите запрос.':all.length&&filtersCount?'Расширьте условия — возможно, нужная история уже в результатах.':'Пока нет версий с просмотром по этому запросу. Попробуйте оригинальное название или уберите номер сезона.'}</p>{noSources?<button onClick={sourceData.reload}>Обновить источники <RotateCw size={16}/></button>:allFailed?<button onClick={search.retry}>Повторить поиск <RotateCw size={16}/></button>:filtersCount>0?<button onClick={clearFilters}>Показать все результаты <ArrowRight size={16}/></button>:<button onClick={()=>{inputRef.current?.focus();inputRef.current?.select()}}>Изменить запрос <ArrowRight size={16}/></button>}</div>}
   </div>
   {!!items.length&&<div className="search-complete">{fetching?<LoaderCircle className="search-spinner" size={13}/>:<Check size={13}/>}<span>{fetching?'Результаты появляются по мере ответа источников.':failures.length?`${sources.length-failures.length} из ${sources.length} источников ответили.`:'Поиск завершён.'} Версии объединяются, когда источник подтверждает совпадение.</span><Link to="/sources">Об источниках <ArrowRight size={13}/></Link></div>}
  </>}
 </section>
}
