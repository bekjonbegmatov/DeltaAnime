import {useEffect,useMemo,useRef,useState} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {ArrowRight,Check,ChevronDown,Clock3,LoaderCircle,RotateCw,Search,SlidersHorizontal,X} from 'lucide-react';
import {Anime,Source,SearchResult,api,merge,read,relevance,useApi,write} from './api';
import {Grid,ErrorBox} from './components';
import './search.css';

const HISTORY_KEY='delta-search-history';
const titleCount=(count:number)=>{const lastTwo=count%100,last=count%10;return lastTwo>=11&&lastTwo<=14?'тайтлов':last===1?'тайтл':last>=2&&last<=4?'тайтла':'тайтлов'};
const historyList=()=>{const saved=read<unknown>(HISTORY_KEY,[]);return Array.isArray(saved)?saved.filter((q):q is string=>typeof q==='string'&&q.trim().length>1).map(q=>q.slice(0,100)).slice(0,8):[]};
const formatOf=(anime:Anime)=>{const f=(anime.format||'').toLowerCase();if(/movie|фильм|полнометраж/.test(f))return 'movie';if(/special|спец/.test(f))return 'special';if(/ova|ona|oad|web/.test(f))return 'other';if(/tv|тв|сериал/.test(f))return 'tv';return 'unknown'};
const formatNames:Record<string,string>={tv:'Сериалы',movie:'Фильмы',special:'Спецвыпуски',other:'OVA / ONA',unknown:'Не указан'};

function useFederated(query:string,sources:Source[]){
 const [outcomes,setOutcomes]=useState<Record<string,SearchResult>>({});
 const [pending,setPending]=useState<string[]>([]);const [resultQuery,setResultQuery]=useState('');
 const generation=useRef(0);const controllers=useRef(new Map<string,AbortController>());
 const ids=sources.map(s=>s.id).join(',');
 function run(source:Source,q:string,version:number){
  controllers.current.get(source.id)?.abort();const controller=new AbortController();controllers.current.set(source.id,controller);
  setPending(old=>old.includes(source.id)?old:[...old,source.id]);
  api<SearchResult>('/search?provider='+source.id+'&q='+encodeURIComponent(q),controller.signal)
   .then(result=>{if(!controller.signal.aborted&&generation.current===version)setOutcomes(old=>({...old,[source.id]:result}))})
   .catch(error=>{if(!controller.signal.aborted&&generation.current===version)setOutcomes(old=>({...old,[source.id]:{source:source.id,status:'error',items:[],message:error.message}}))})
   .finally(()=>{if(!controller.signal.aborted&&generation.current===version)setPending(old=>old.filter(id=>id!==source.id))});
 }
 useEffect(()=>{
  const version=++generation.current;controllers.current.forEach(c=>c.abort());controllers.current.clear();
  setOutcomes({});setPending([]);setResultQuery(query);
  if(query.length>=2)sources.forEach(source=>run(source,query,version));
  return()=>controllers.current.forEach(c=>c.abort());
 },[query,ids]);
 function retry(ids?:string[]){if(query.length<2)return;const failed=ids||Object.entries(outcomes).filter(([,r])=>r.status!=='ok').map(([id])=>id);sources.filter(s=>failed.includes(s.id)).forEach(s=>run(s,query,generation.current))}
 return {outcomes:resultQuery===query?outcomes:{},pending:resultQuery===query?pending:query.length>=2?sources.map(s=>s.id):[],retry};
}

export function SearchPage(){
 const [params,setParams]=useSearchParams();const query=(params.get('q')||'').trim();
 const [input,setInput]=useState(query);const [history,setHistory]=useState(historyList);const inputRef=useRef<HTMLInputElement>(null);
 const [showFilters,setShowFilters]=useState(false);const sourceData=useApi<{sources:Source[]}>('/sources');
 const sources=sourceData.data?.sources.filter(s=>s.search)||[];const search=useFederated(query,sources);
 const source=params.get('source')||'all',year=params.get('year')||'',format=params.get('format')||'',playable=params.get('playable')==='1',sort=params.get('sort')||'relevance';
 const editing=input.trim()!==query;
 useEffect(()=>setInput(query),[query]);
 useEffect(()=>{const nextQuery=input.trim();if(nextQuery===query||nextQuery.length===1)return;const timer=window.setTimeout(()=>{const next=new URLSearchParams(params);if(nextQuery)next.set('q',nextQuery);else next.delete('q');setParams(next,{replace:true})},450);return()=>window.clearTimeout(timer)},[input,query,params]);
 function remember(q:string){if(q.length<2)return;const next=[q,...history.filter(old=>old.toLowerCase()!==q.toLowerCase())].slice(0,8);setHistory(next);write(HISTORY_KEY,next)}
 function submit(q:string){const value=q.trim();setInput(value);if(value.length<2)return;remember(value);const next=new URLSearchParams(params);next.set('q',value);setParams(next);inputRef.current?.focus()}
 function filter(name:string,value:string){const next=new URLSearchParams(params);if(value)next.set(name,value);else next.delete(name);setParams(next,{replace:true})}
 function clearQuery(){setInput('');const next=new URLSearchParams(params);next.delete('q');setParams(next,{replace:true});inputRef.current?.focus()}
 function clearFilters(){const next=new URLSearchParams();if(query)next.set('q',query);setParams(next,{replace:true})}
 function forget(q:string){const next=history.filter(old=>old!==q);setHistory(next);write(HISTORY_KEY,next)}
 const all=useMemo(()=>merge(Object.values(search.outcomes).flatMap(r=>r.items)),[search.outcomes]);
 const selected=source==='all'?all:merge(search.outcomes[source]?.items||[]);
 const years=[...new Set(all.map(a=>a.year).filter((y):y is number=>!!y))].sort((a,b)=>Number(b)-Number(a));
 const formats=[...new Set(all.map(formatOf))].filter(f=>f!=='unknown');
 const items=selected.filter(a=>(!year||String(a.year)===year)&&(!format||formatOf(a)===format)&&(!playable||a.playable));
 items.sort((a,b)=>{const primary=sort==='rating'?Number(b.rating||0)-Number(a.rating||0):sort==='year'?Number(b.year||0)-Number(a.year||0):relevance(b,query)-relevance(a,query);return primary||Number(!!b.playable)-Number(!!a.playable)||a.title.localeCompare(b.title,'ru',{sensitivity:'base'})||a.id.localeCompare(b.id)});
 const failures=Object.values(search.outcomes).filter(r=>r.status!=='ok');const searched=query.length>=2;
 const filtersCount=Number(source!=='all')+Number(!!year)+Number(!!format)+Number(playable);
 const fetching=search.pending.length>0||sourceData.loading;const chosenSource=sources.find(s=>s.id===source);const allFailed=!fetching&&sources.length>0&&failures.length===sources.length;
 const waitingChosen=source!=='all'&&search.pending.includes(source);const failedChosen=source!=='all'&&search.outcomes[source]?.status!=='ok'&&!!search.outcomes[source];
 return <section className="cinema-search" onClickCapture={event=>{if((event.target as HTMLElement).closest('a[href^="/anime/"]'))remember(query)}}>
  <div className="search-page-title"><div><span className="search-kicker">Поиск аниме</span><h1>Что будем смотреть?</h1></div><Link to="/catalog">Открыть каталог <ArrowRight size={16}/></Link></div>
  <form className="cinema-search-field" role="search" onSubmit={event=>{event.preventDefault();submit(input)}}>
   <Search size={25} aria-hidden="true"/><input ref={inputRef} type="search" name="q" value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')clearQuery()}} aria-label="Название аниме" placeholder="Название на русском, английском или японском" autoComplete="off" maxLength={100}/>
   {input&&<button className="search-clear" type="button" aria-label="Очистить поиск" onClick={clearQuery}><X size={19}/></button>}
   <button className="search-submit" type="submit" disabled={input.trim().length<2}>Найти <ArrowRight size={17}/></button>
  </form>
  <div className="search-field-meta"><span>{input.trim().length===1?'Введите ещё хотя бы один символ':searched?'Результаты из всех подключённых источников':'Русское или оригинальное название — поиск по подключённым источникам'}</span><span className="search-key-hint"><kbd>↵</kbd> поиск <kbd>esc</kbd> очистить</span></div>
  {!searched&&!input.trim()&&<div className="search-start">
   {history.length>0&&<section className="search-history"><div className="search-minor-heading"><h2><Clock3 size={16}/> Недавно искали</h2><button onClick={()=>{setHistory([]);write(HISTORY_KEY,[])}}>Очистить</button></div><div className="search-history-list">{history.map(q=><div key={q}><button onClick={()=>submit(q)}>{q}<ArrowRight size={15}/></button><button aria-label={'Удалить запрос '+q} onClick={()=>forget(q)}><X size={13}/></button></div>)}</div></section>}
   <div className="search-explore"><div><span className="search-kicker">Если ещё не выбрали</span><h2>Можно начать отсюда</h2><p>Текущий сезон, лучшие по рейтингу или фильм на один вечер.</p></div><div className="search-destinations"><Link to="/catalog?status=ongoing"><span>Новые эпизоды</span><strong>Сейчас выходит</strong><ArrowRight size={22}/></Link><Link to="/top"><span>Выбор зрителей</span><strong>Лучшее аниме</strong><ArrowRight size={22}/></Link><Link to="/catalog?kind=MOVIE"><span>На один вечер</span><strong>Полнометражные</strong><ArrowRight size={22}/></Link></div></div>
  </div>}
  {sourceData.error&&<ErrorBox error={sourceData.error} retry={sourceData.reload}/>}
  {searched&&<>
   <div className="search-results-toolbar"><div className="search-provider-tabs" role="group" aria-label="Источники поиска"><button aria-pressed={source==='all'} onClick={()=>filter('source','')}>Все источники <span>{all.length}</span></button>{sources.map(s=>{const outcome=search.outcomes[s.id],pending=search.pending.includes(s.id);return <button key={s.id} aria-pressed={source===s.id} className={outcome?.status!=='ok'&&outcome?'search-provider-unavailable':''} onClick={()=>filter('source',s.id)} title={outcome?.message||s.name}>{s.name}{pending?<LoaderCircle size={12} className="search-spinner"/>:outcome?.status==='ok'?<span>{merge(outcome.items).length}</span>:outcome?<span className="provider-offline" aria-label="Источник недоступен">!</span>:null}</button>})}</div><button className="search-filters-toggle" aria-expanded={showFilters} aria-controls="search-filter-panel" onClick={()=>setShowFilters(v=>!v)}><SlidersHorizontal size={16}/> Фильтры {filtersCount>0&&<b>{filtersCount}</b>}<ChevronDown size={13}/></button></div>
   {showFilters&&<div className="search-filter-panel" id="search-filter-panel"><label>Год<select aria-label="Год аниме" value={year} onChange={e=>filter('year',e.target.value)}><option value="">Все годы</option>{year&&!years.map(String).includes(year)&&<option value={year}>{year}</option>}{years.map(y=><option key={y} value={y}>{y}</option>)}</select></label><label>Формат<select aria-label="Формат аниме" value={format} onChange={e=>filter('format',e.target.value)}><option value="">Все форматы</option>{[...new Set([...formats,...(format?[format]:[])])].map(f=><option key={f} value={f}>{formatNames[f]||f}</option>)}</select></label><label className="search-playable"><input type="checkbox" checked={playable} onChange={e=>filter('playable',e.target.checked?'1':'')}/><span>С источником просмотра</span></label>{filtersCount>0&&<button className="search-reset" onClick={clearFilters}>Сбросить фильтры <X size={13}/></button>}<p>Фильтры применяются к найденным результатам. Доступность конкретной озвучки проверяется в плеере.</p></div>}
   <div className="search-results-heading"><div><h2>{editing?'Обновляем запрос…':`Результаты для «${query}»`}</h2><span role="status" aria-live="polite">{fetching?<><LoaderCircle className="search-spinner" size={12}/>{sourceData.loading?'Подключаем источники…':`${items.length?items.length+' найдено · ':''}Проверяем источники ${sources.length-search.pending.length}/${sources.length}`}</>:`${items.length} ${titleCount(items.length)}${chosenSource?' · '+chosenSource.name:''}`}</span></div><label className="search-sort">Сначала<select aria-label="Сортировка результатов" value={sort} onChange={e=>filter('sort',e.target.value==='relevance'?'':e.target.value)}><option value="relevance">Точные совпадения</option><option value="rating">Высокий рейтинг</option><option value="year">Новые</option></select></label></div>
   {failures.length>0&&<div className="search-partial"><span>{failures.length===sources.length?'Источники пока не ответили.':`Не удалось проверить: ${failures.map(f=>sources.find(s=>s.id===f.source)?.name||f.source).join(', ')}.`}{failures.length!==sources.length&&' Остальные результаты доступны.'}</span><button onClick={()=>search.retry()} disabled={failures.some(f=>search.pending.includes(f.source))}><RotateCw size={13}/> Повторить</button></div>}
   <div className={'search-result-body'+(editing?' is-updating':'')} aria-busy={fetching}>
    {sourceData.error?null:items.length>0?<Grid items={items}/>:fetching&&(source==='all'||waitingChosen)?<div className="search-skeletons" aria-label="Ищем аниме">{Array.from({length:6},(_,i)=><div key={i}><div/><span/><span/></div>)}</div>:<div className="search-empty"><Search size={31}/><h2>{allFailed?'Источники временно недоступны':failedChosen?'Источник временно недоступен':all.length&&filtersCount?'Ничего под эти фильтры':'Не нашли такое аниме'}</h2><p>{allFailed?'Не удалось проверить наличие аниме. Повторите поиск через некоторое время.':failedChosen?'Попробуйте другие источники или повторите запрос.':all.length&&filtersCount?'Расширьте условия — возможно, нужная история уже в результатах.':'Попробуйте оригинальное название, уберите номер сезона или проверьте написание.'}</p>{allFailed?<button onClick={()=>search.retry()}>Повторить поиск <RotateCw size={16}/></button>:filtersCount>0?<button onClick={clearFilters}>Показать все результаты <ArrowRight size={16}/></button>:<button onClick={()=>{inputRef.current?.focus();inputRef.current?.select()}}>Изменить запрос <ArrowRight size={16}/></button>}</div>}
   </div>
   {!!items.length&&!fetching&&<div className="search-complete"><Check size={13}/><span>{failures.length?`${sources.length-failures.length} из ${sources.length} источников ответили.`:'Поиск завершён.'} У источников могут быть разные названия и версии релиза.</span><Link to="/sources">Об источниках <ArrowRight size={13}/></Link></div>}
  </>}
 </section>
}
