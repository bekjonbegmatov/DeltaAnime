import {createContext,useContext} from 'react';
import {Link} from 'react-router-dom';
import {Bookmark,Play,ArrowRight,ArrowUpRight,Check,RotateCw,Layers3} from 'lucide-react';
import {Anime} from './api';
export const SavedContext=createContext<{saved:Anime[];toggle:(a:Anime)=>void}>({saved:[],toggle:()=>{}});
export function Poster({anime}:{anime:Pick<Anime,'title'|'poster'>}){return <div className="poster-inner"><span className="poster-placeholder" aria-hidden="true">Δ</span>{anime.poster&&<img key={anime.poster} src={anime.poster} alt={anime.title} loading="lazy" decoding="async" onError={e=>e.currentTarget.style.visibility='hidden'}/>}</div>}
export function Card({anime,rank}:{anime:Anime;rank?:number}){
 const {saved,toggle}=useContext(SavedContext);const marked=saved.some(x=>x.id===anime.id);const formats:Record<string,string>={TV:'Сериал',MOVIE:'Фильм',OVA:'OVA',ONA:'ONA',SPECIAL:'Спешл',TV_SHORT:'Короткий сериал'};
 const providers=[...new Set(anime.variants?.map(v=>v.provider)||[anime.provider])];
 const ongoing=/ongoing|releasing|сейчас выходит|онгоинг/i.test(anime.status||'');
 return <article className={'card '+(rank?'ranked-card':'')}>
  <Link className="poster" to={'/anime/'+anime.id} aria-label={'Открыть: '+anime.title}>
   <Poster anime={anime}/>
   <span className="card-play">{anime.playable?<Play size={24} fill="currentColor"/>:<ArrowUpRight size={26}/>}</span>
   {!!anime.rating&&<span className="rating" title={'Оценка '+(anime.rating_source||anime.provider)}>★ {Number(anime.rating).toFixed(1)}</span>}
   {rank&&<span className="rank">{String(rank).padStart(2,'0')}</span>}
   {!rank&&ongoing&&<span className="card-airing"><i/> Сейчас выходит</span>}
   <span className="card-preview">{anime.description&&<span className="card-preview-description">{anime.description}</span>}<span className="poster-caption">Открыть аниме <ArrowRight size={14}/></span></span>
  </Link>
  <button className={'save '+(marked?'is-saved':'')} aria-label={(marked?'Убрать из списка: ':'Смотреть позже: ')+anime.title} aria-pressed={marked} onClick={()=>toggle(anime)}>{marked?<Check size={17}/>:<Bookmark size={17}/>}</button>
  <Link className="card-title" title={anime.title} to={'/anime/'+anime.id}>{anime.title}</Link>
  <p>{[anime.year,formats[(anime.format||'').toUpperCase()]||anime.format,anime.episodes_total?anime.episodes_total+' сер.':null].filter(Boolean).join(' · ')||anime.original_title||'Аниме'}</p>
  <div className="card-provenance"><span className={'card-availability '+(anime.playable?'has-video':'')} title={anime.playable?'Есть источник просмотра':'Карточка с информацией об аниме'}>{anime.playable?<Play size={10}/>:<Layers3 size={11}/>}</span><span className="card-source" title={providers.join(', ')}>{providers[0]}{providers.length>1&&<b>+{providers.length-1}</b>}</span></div>
 </article>
}
export function Grid({items,rank=false,page=1}:{items:Anime[];rank?:boolean;page?:number}){return <div className="cards">{items.filter(a=>a.playable).map((a,i)=><Card key={a.id} anime={a} rank={rank?(page-1)*24+i+1:undefined}/>)}</div>}
export function Loading(){return <div className="cards" role="status" aria-label="Загрузка аниме">{Array.from({length:6},(_,i)=><div className="skeleton" key={i}/>)}</div>}
export function ErrorBox({error,retry}:{error:string;retry?:()=>void}){return <div className="notice" role="alert"><p>{error}</p>{retry&&<button onClick={retry}><RotateCw size={14}/> Повторить</button>}</div>}
export function Empty({children}:{children:React.ReactNode}){return <div className="empty">{children}</div>}
export function SectionHead({title,subtitle,link}:{title:string;subtitle?:string;link?:string}){return <div className="section-title"><div><h2>{title}</h2>{subtitle&&<p className="section-subtitle">{subtitle}</p>}</div>{link&&<Link className="text-link" to={link}>Все <ArrowRight size={16}/></Link>}</div>}
