import {useEffect,useMemo,useRef,useState} from 'react';
import {Link,useLocation,useNavigate} from 'react-router-dom';
import {ArrowRight,LoaderCircle,Search,X} from 'lucide-react';
import {Anime,Source,merge,useApi} from './api';
import {Poster} from './components';
import {useFederated} from './search';
import {searchSort,sortSearchResults} from './search-utils';
const identity=(anime:Anime)=>anime.shikimori_id?'shiki:'+anime.shikimori_id:anime.mal_id?'mal:'+anime.mal_id:anime.id;
import './quick-search.css';

export function QuickSearch(){
 const [input,setInput]=useState('');const [open,setOpen]=useState(false);const [activeKey,setActiveKey]=useState<string|null>(null);const [composing,setComposing]=useState(false);
 const field=useRef<HTMLInputElement>(null);const location=useLocation();const navigate=useNavigate();
 const query=input.trim();const sourceData=useApi<{sources:Source[]}>(open?'/sources':null);
 const sources=sourceData.data?.sources.filter(s=>s.search&&s.playback!==false&&!/метадан|информац|metadata/i.test(s.type))||[];
 const search=useFederated(open?query:'',sources,composing);
 const items=useMemo(()=>sortSearchResults(merge(sources.flatMap(source=>search.outcomes[source.id]?.items||[])).filter(anime=>anime.playable),searchSort('relevance'),query).slice(0,5),[search.outcomes,query,sourceData.data]);
 const active=items.findIndex(anime=>identity(anime)===activeKey);
 useEffect(()=>{if(activeKey&&active<0)setActiveKey(null)},[activeKey,active]);
 const loading=search.waiting||search.pending.length>0||sourceData.loading;
 useEffect(()=>{setOpen(false);setActiveKey(null)},[location.pathname]);
 useEffect(()=>{if(open)field.current?.focus()},[open]);
 useEffect(()=>{if(location.pathname==='/search'&&!open)setInput(new URLSearchParams(location.search).get('q')||'')},[location.search,location.pathname,open]);
 useEffect(()=>{function shortcut(e:KeyboardEvent){const target=e.target as HTMLElement;const typing=target.matches('input,textarea,select')||target.isContentEditable;if((e.key==='k'&&(e.metaKey||e.ctrlKey))||(e.key==='/'&&!typing)){e.preventDefault();setOpen(true);field.current?.focus()}}document.addEventListener('keydown',shortcut);return()=>document.removeEventListener('keydown',shortcut)},[]);
 function close(){setOpen(false);setActiveKey(null)}
 function fullSearch(){close();navigate(query.length>=2?'/search?q='+encodeURIComponent(query):'/search');field.current?.blur()}
 return <form className={'header-search quick-search'+(open?' is-open':'')} role="search" onBlur={e=>{const form=e.currentTarget;window.requestAnimationFrame(()=>{if(!form.contains(document.activeElement))close()})}} onSubmit={e=>{e.preventDefault();if(composing)return;if(active>=0&&items[active]){close();navigate('/anime/'+items[active].id);field.current?.blur()}else fullSearch()}}>
  <Search size={17}/><input ref={field} aria-label="Поиск аниме" placeholder="Найти свою историю" value={input} maxLength={100} autoComplete="off" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls="quick-search-results" aria-activedescendant={open&&active>=0&&items[active]?'quick-result-'+items[active].id:undefined} onFocus={()=>setOpen(true)} onCompositionStart={()=>setComposing(true)} onCompositionEnd={()=>setComposing(false)} onChange={e=>{setInput(e.target.value);setActiveKey(null);setOpen(true)}} onKeyDown={e=>{if(composing||e.nativeEvent.isComposing)return;if(e.key==='Escape'){e.preventDefault();close();field.current?.blur()}if(e.key==='ArrowDown'&&items.length){e.preventDefault();setActiveKey(identity(items[Math.min(active+1,items.length-1)]))}if(e.key==='ArrowUp'){e.preventDefault();setActiveKey(active>0?identity(items[active-1]):null)}}}/>
  {open&&input?<button className="quick-clear" type="button" aria-label="Очистить быстрый поиск" onClick={()=>{setInput('');setActiveKey(null);field.current?.focus()}}><X size={14}/></button>:<kbd>/</kbd>}
  <button type="button" className="header-search-submit" aria-label="Открыть поиск" onClick={()=>{setOpen(true);field.current?.focus()}}><Search size={19}/></button>
  {open&&<div className="quick-search-popover"><div className="quick-search-heading"><span>{query.length<2?'НАЙДИ СЛЕДУЮЩУЮ ИСТОРИЮ':'БЫСТРЫЕ РЕЗУЛЬТАТЫ'}</span>{query.length>=2&&loading?<LoaderCircle size={13} className="search-spinner"/>:<kbd>esc</kbd>}</div>
   <div id="quick-search-results" role="listbox" aria-label="Найденное аниме">{query.length>=2&&items.map((anime,index)=><Link id={'quick-result-'+anime.id} key={anime.id} to={'/anime/'+anime.id} role="option" aria-selected={index===active} className="quick-search-item" onClick={close}><div className="quick-search-poster"><Poster anime={anime}/></div><span><strong>{anime.title}</strong><small>{[anime.year,anime.provider,!anime.playable?'Информация':null].filter(Boolean).join(' · ')}</small></span><ArrowRight size={14}/></Link>)}</div>
   {query.length<2?<p className="quick-search-hint">Начни вводить название — результаты появятся здесь.</p>:!items.length?<p className="quick-search-hint" role="status">{loading?'Ищем по подключённым источникам…':sourceData.error?'Не удалось подключить источники. Открой полный поиск, чтобы повторить.':'Пока нет совпадений. Попробуй другое название.'}</p>:null}
   <button type="button" className="quick-search-all" onClick={fullSearch}><span>{query.length>=2?'Все результаты и фильтры':'Открыть поиск'}<small>Карточки или таблица · все источники</small></span><ArrowRight size={17}/></button>
  </div>}
 </form>
}
