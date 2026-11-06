import {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter,Link,NavLink,Route,Routes,useLocation,useNavigate} from 'react-router-dom';
import {Bookmark,Search} from 'lucide-react';
import {Anime,read,write} from './api';
import {SavedContext} from './components';
import {Home} from './home';
import {CatalogPage,SearchPage,Detail,Saved,Sources} from './pages';
import {WatchPage} from './watch';
import './style.css';
function App(){
 const [saved,setSaved]=useState<Anime[]>(()=>read<Anime[]>('delta-saved',[]).filter(a=>!a.id.startsWith('a365-')));const [query,setQuery]=useState('');const search=useRef<HTMLInputElement>(null);const nav=useNavigate();const location=useLocation();
 useEffect(()=>{window.scrollTo(0,0);document.title='DeltaAnime — смотреть и открывать аниме'},[location.pathname]);
 useEffect(()=>{function shortcut(e:KeyboardEvent){const target=e.target as HTMLElement;const typing=target.matches('input,textarea,select')||target.isContentEditable;if((e.key==='k'&&(e.metaKey||e.ctrlKey))||(e.key==='/'&&!typing)){e.preventDefault();search.current?.focus()}}document.addEventListener('keydown',shortcut);return()=>document.removeEventListener('keydown',shortcut)},[]);
 useEffect(()=>{if(location.pathname==='/search')setQuery(new URLSearchParams(location.search).get('q')||'')},[location.pathname,location.search]);
 function toggle(a:Anime){setSaved(old=>{const next=old.some(x=>x.id===a.id)?old.filter(x=>x.id!==a.id):[...old,a];write('delta-saved',next);return next})}
 return <SavedContext.Provider value={{saved,toggle}}><a className="skip-link" href="#content">К содержимому</a><header className={'app-header '+(location.pathname==='/'?'over-hero':'')}><Link className="brand" to="/" aria-label="DeltaAnime — главная"><span className="mark" aria-hidden="true">Δ</span><span>delta<span className="brand-light">anime</span></span></Link><nav aria-label="Основная навигация"><NavLink to="/" end>Главная</NavLink><NavLink to="/catalog">Каталог</NavLink><NavLink to="/top">Топ аниме</NavLink></nav><form className="header-search" role="search" onSubmit={e=>{e.preventDefault();nav(query.trim().length>=2?'/search?q='+encodeURIComponent(query.trim()):'/search');search.current?.blur()}}><Search size={17}/><input ref={search} aria-label="Поиск аниме" placeholder="Найти аниме" value={query} onChange={e=>setQuery(e.target.value)}/><kbd>/</kbd><button className="header-search-submit" aria-label="Искать по всем источникам"><Search size={19}/></button></form><NavLink className="saved-nav" to="/saved" aria-label={"Мой список"+(saved.length?" · "+saved.length:"")}><Bookmark size={18}/><span>Мой список</span>{saved.length>0&&<b>{saved.length}</b>}</NavLink></header><main id="content"><Routes><Route path="/" element={<Home/>}/><Route path="/catalog" element={<CatalogPage/>}/><Route path="/top" element={<CatalogPage top/>}/><Route path="/search" element={<SearchPage/>}/><Route path="/anime/:id" element={<Detail key={location.pathname}/>}/><Route path="/watch/:id" element={<WatchPage key={location.pathname}/>}/><Route path="/saved" element={<Saved/>}/><Route path="/sources" element={<Sources/>}/><Route path="*" element={<section className="empty"><h1>Страница не найдена</h1><Link className="text-link" to="/">На главную →</Link></section>}/></Routes><footer><Link className="footer-brand" to="/"><span>Δ</span> deltaanime</Link><p>Для историй, в которые хочется вернуться.</p><div><Link to="/catalog">Каталог</Link><Link to="/sources">Источники</Link><Link to="/saved">Мой список</Link></div><small>Собрано для любителей аниме</small></footer></main></SavedContext.Provider>
}
createRoot(document.getElementById('root')!).render(<BrowserRouter><App/></BrowserRouter>);
