import {useContext,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {ArrowRight,Bookmark,Check,ChevronLeft,ChevronRight,Info,Play,X} from 'lucide-react';
import {Anime,Catalog,Progress,read,useApi,write} from './api';
import {Card,Empty,ErrorBox,Loading,Poster,SavedContext,SectionHead} from './components';

const editorial:Record<string,{title:string;description:string}>={
 'al-154587':{title:'Провожающая в последний путь Фрирен',description:'Король демонов повержен. Но для эльфийской волшебницы настоящее путешествие только начинается — навстречу воспоминаниям, новым друзьям и ценности каждого мгновения.'},
 'al-171627':{title:'Человек-бензопила: История Резе',description:'Случайная встреча под дождём меняет жизнь Дэндзи. История о первой любви, опасных секретах и сердце, которое всё ещё умеет мечтать.'},
 'al-114129':{title:'Гинтама: Финал',description:'Последняя работа Ёродзуи. Старые друзья снова собираются вместе, чтобы защитить Эдо — с мечами, безумными шутками и всем, что делает их семьёй.'}
};
function FilmShelf({title,subtitle,items,link,rank=false}:{title:string;subtitle?:string;items:Anime[];link:string;rank?:boolean}){
 const rail=useRef<HTMLDivElement>(null);const [edges,setEdges]=useState({left:true,right:false});
 function measure(){const e=rail.current;if(e)setEdges({left:e.scrollLeft<4,right:e.scrollLeft+e.clientWidth>=e.scrollWidth-4})}
 function scroll(direction:number){const e=rail.current;if(e)e.scrollBy({left:direction*e.clientWidth*.85,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})}
 return <section className="shelf"><div className="shelf-heading"><SectionHead title={title} subtitle={subtitle} link={link}/><div className="rail-controls"><button aria-label={'Назад: '+title} disabled={edges.left} onClick={()=>scroll(-1)}><ChevronLeft size={18}/></button><button aria-label={'Дальше: '+title} disabled={edges.right} onClick={()=>scroll(1)}><ChevronRight size={18}/></button></div></div><div className="film-rail" ref={rail} onScroll={measure}>{items.map((a,i)=><Card key={a.id} anime={a} rank={rank?i+1:undefined}/>)}</div></section>
}
export function Home(){
 const fresh=useApi<Catalog>('/catalog');const top=useApi<Catalog>('/top');const ongoing=useApi<Catalog>('/catalog?status=ongoing');const movies=useApi<Catalog>('/catalog?kind=MOVIE');const {saved,toggle}=useContext(SavedContext);
 const [index,setIndex]=useState(0);const [recent,setRecent]=useState(()=>Object.values(read<Record<string,Progress>>('delta-progress',{})).filter(p=>p.time>10&&!p.anime.id.startsWith('a365-')).sort((a,b)=>b.updated-a.updated).slice(0,6));
 const picks=(top.data?.items.filter(a=>editorial[a.id]&&a.banner)||[]).slice(0,3);
 const features=picks.length?picks:(fresh.data?.items.filter(a=>a.poster).slice(0,3)||[]);const hero=features[index%Math.max(features.length,1)];const copy=hero&&editorial[hero.id];const inList=hero&&saved.some(a=>a.id===hero.id);
 function removeRecent(id:string){const stored=read<Record<string,Progress>>('delta-progress',{});delete stored[id];write('delta-progress',stored);setRecent(old=>old.filter(p=>p.anime.id!==id))}
 return <div className="home-page">
 {hero?<section className={'cinema-hero '+(!hero.banner?'poster-backdrop':'')} aria-label="В центре внимания">
 <div key={hero.id} className="hero-art" style={{backgroundImage:`url("${hero.banner||hero.poster}")`}}/>
 <div className="hero-content" key={'content-'+hero.id}><div className="hero-kicker"><span className="mini-mark">Δ</span> В центре внимания</div><h1>{copy?.title||hero.title}</h1><div className="hero-metadata">{hero.rating&&<strong>★ {Number(hero.rating).toFixed(1)} <small>{hero.rating_source}</small></strong>}<span>{hero.year}</span><span>{hero.format==='MOVIE'?'Фильм':hero.format==='TV'?'Сериал':hero.format}</span>{hero.episodes_total&&<span>{hero.episodes_total} серий</span>}</div><p>{copy?.description||hero.description||'Открой новую историю. Выбирай озвучку, сохраняй любимое и возвращайся к просмотру в любой момент.'}</p><div className="actions"><Link className="primary" to={'/anime/'+hero.id}>{hero.playable?<Play size={19} fill="currentColor"/>:<Info size={19}/>} {hero.playable?'Смотреть':'Подробнее'}</Link><button className={'hero-save secondary '+(inList?'is-saved':'')} onClick={()=>toggle(hero)}>{inList?<Check size={19}/>:<Bookmark size={19}/>} {inList?'В моём списке':'В мой список'}</button></div></div>
 <div className="hero-bottom"><Link to="/top" className="hero-discover">Высокие оценки зрителей AniList <ArrowRight size={16}/></Link><div className="hero-pagination" aria-label="Выбрать аниме в центре внимания">{features.map((a,i)=><button key={a.id} className={i===index%features.length?'active':''} aria-label={editorial[a.id]?.title||a.title} aria-pressed={i===index%features.length} onClick={()=>setIndex(i)}><span>{String(i+1).padStart(2,'0')}</span><i/></button>)}</div></div>
 </section>:fresh.loading||top.loading?<div className="cinema-hero hero-loading skeleton"/>:<ErrorBox error={fresh.error||top.error||'Не удалось загрузить подборки'} retry={()=>{fresh.reload();top.reload()}}/>}
 <div className="browse-strip"><span>Что посмотрим?</span><Link to="/catalog?status=ongoing">Сейчас выходит</Link><Link to="/top">Лучшее за всё время</Link><Link to="/catalog?kind=MOVIE">На один вечер</Link><Link to="/catalog">Весь каталог <ArrowRight size={15}/></Link></div>
 {recent.length>0&&<section className="shelf continue-shelf"><SectionHead title="Продолжить просмотр"/><div className="continue-grid">{recent.map(p=><article className="continue-card" key={p.anime.id}><Link to={`/watch/${p.anime.id}?episode=${p.episode}&season=${p.season}`}><div className="continue-art"><Poster anime={p.anime}/><span className="continue-play"><Play size={21} fill="currentColor"/></span></div><div className="continue-copy"><strong>{p.anime.title}</strong><p>Серия {p.episode}<span>·</span>{Math.floor(p.time/60)} мин.</p>{!!p.anime.duration&&<div className="continue-track" aria-label="Прогресс серии"><span style={{width:Math.min(100,p.time/(p.anime.duration*60)*100)+'%'}}/></div>}</div></Link><button className="continue-dismiss" aria-label={'Убрать из продолжения: '+p.anime.title} onClick={()=>removeRecent(p.anime.id)}><X size={13}/></button></article>)}</div></section>}
 {fresh.loading?<section className="shelf"><SectionHead title="Новые серии"/><Loading/></section>:fresh.error?<ErrorBox error={fresh.error} retry={fresh.reload}/>:<FilmShelf title="Новые серии" subtitle="Вернись к любимой истории" link="/catalog" items={fresh.data?.items.slice(0,12)||[]}/>}
 {top.loading?<section className="shelf"><SectionHead title="Стоит увидеть"/><Loading/></section>:top.error?<ErrorBox error={top.error} retry={top.reload}/>:<FilmShelf title="Стоит увидеть" subtitle="Высоко оценено зрителями AniList" link="/top" rank items={top.data?.items.slice(0,12)||[]}/>}

 {ongoing.loading?<Loading/>:ongoing.error?<ErrorBox error={ongoing.error} retry={ongoing.reload}/>:ongoing.data?.items.length?<FilmShelf title="Сейчас выходит" subtitle="Следи за новыми сериями" link="/catalog?status=ongoing" items={ongoing.data.items.slice(0,12)}/>:<Empty>Новые онгоинги скоро появятся здесь.</Empty>}
 {movies.loading?<Loading/>:movies.error?<ErrorBox error={movies.error} retry={movies.reload}/>:<FilmShelf title="На один вечер" subtitle="Полнометражные истории" link="/catalog?kind=MOVIE" items={movies.data?.items.slice(0,12)||[]}/>}
 </div>
}
