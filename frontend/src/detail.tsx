import {useContext,useState} from 'react';
import {Link, useParams} from 'react-router-dom';
import {ArrowLeft, ArrowRight, Bookmark, Check, ChevronDown, Clock3, ExternalLink, Film, Play, Search, Star} from 'lucide-react';
import {Anime, Progress, read, useApi} from './api';
import {ErrorBox, Loading, Poster, SavedContext} from './components';
import './catalog.css';

const formatNames: Record<string, string> = {TV: 'Сериал', MOVIE: 'Фильм', OVA: 'OVA', ONA: 'ONA', SPECIAL: 'Спецвыпуск', TV_SHORT: 'Короткий сериал', MUSIC: 'Музыкальное видео'};
const statusNames: Record<string, string> = {released: 'Завершён', finished: 'Завершён', completed: 'Завершён', ongoing: 'Сейчас выходит', releasing: 'Сейчас выходит', anons: 'Анонс', announced: 'Анонс', not_yet_released: 'Анонс', cancelled: 'Отменён', canceled: 'Отменён', hiatus: 'На паузе', paused: 'На паузе'};
const genreNames: Record<string, string> = {action: 'Экшен', adventure: 'Приключения', comedy: 'Комедия', drama: 'Драма', ecchi: 'Этти', fantasy: 'Фэнтези', hentai: 'Хентай', horror: 'Ужасы', 'mahou shoujo': 'Махо-сёдзё', mecha: 'Меха', music: 'Музыка', mystery: 'Детектив', psychological: 'Психологическое', romance: 'Романтика', 'sci-fi': 'Фантастика', 'slice of life': 'Повседневность', sports: 'Спорт', supernatural: 'Сверхъестественное', thriller: 'Триллер'};
function genreLabel(genre: string) {return genreNames[genre.trim().toLowerCase()] || genre;}

export function Detail() {
  const {id} = useParams();
  const result = useApi<Anime>('/titles/' + id);
  const availability=useApi<{item:Anime|null;status:string}>(result.data&&!result.data.playable?'/titles/'+id+'/watchable':null);
  const {saved, toggle} = useContext(SavedContext);
  const [expanded,setExpanded]=useState(false);
  if (result.loading) return <section className="detail-loading"><Loading/></section>;
  if (result.error) return <section className="detail-loading"><ErrorBox error={result.error} retry={result.reload}/></section>;
  const anime = result.data;
  if (!anime) return null;
  const watchAnime=anime.playable?anime:availability.data?.item;
  const canWatch=!!watchAnime?.playable;
  const progress = read<Record<string, Progress>>('delta-progress', {})[watchAnime?.id||anime.id];
  const existingSaved=saved.find(item=>item.id===anime.id||item.id===watchAnime?.id);
  const isSaved = !!existingSaved;
  const saveItem=existingSaved||(canWatch?{...anime,id:watchAnime!.id,provider:watchAnime!.provider,source:watchAnime!.source,playable:true}:anime);
  const watchUrl = `/watch/${watchAnime?.id||anime.id}${progress ? `?episode=${progress.episode}&season=${progress.season}` : ''}`;
  const searchUrl = '/search?q=' + encodeURIComponent(anime.original_title || anime.title);
  const description=anime.description || 'Описание этого аниме пока не появилось у источника.';
  const status=statusNames[(anime.status||'').trim().toLowerCase().replace(/[ -]+/g, '_')] || anime.status;

  return <article className="cinema-detail">
    <section className={'detail-stage' + (anime.banner ? ' has-banner' : '')}>
      {(anime.banner || anime.poster) && <div className="detail-backdrop" aria-hidden="true" style={{backgroundImage: `url("${anime.banner || anime.poster}")`}}/>}
      <Link className="detail-back" to="/catalog"><ArrowLeft size={17}/> В каталог</Link>
      <div className="detail-stage-content">
        <div className="detail-cover"><Poster anime={anime}/><span className="detail-cover-label">DELTA / ANIME</span></div>
        <div className="detail-copy">
          <div className="detail-topline">{anime.year && <span>{anime.year}</span>}<span>{formatNames[(anime.format || '').toUpperCase()] || anime.format || 'Аниме'}</span>{anime.age && <span className="detail-age">{anime.age}</span>}</div>
          <h1>{anime.title}</h1>
          {anime.original_title && anime.original_title !== anime.title && <p className="detail-original-title">{anime.original_title}</p>}
          <div className="detail-rating-row">{!!anime.rating && <span className="detail-rating"><Star size={16} fill="currentColor"/><strong>{Number(anime.rating).toFixed(1)}</strong><span>{anime.rating_source || 'Рейтинг'}</span></span>}{anime.status && <span>{statusNames[anime.status.trim().toLowerCase().replace(/[ -]+/g, '_')] || anime.status}</span>}{!!anime.episodes_total && <span>{anime.episodes_total} сер.</span>}{!!anime.duration && <span>{anime.duration} мин.</span>}</div>
          {!!anime.genres?.length && <div className="detail-genre-tags">{anime.genres.slice(0, 5).map(genre=><span key={genre}>{genreLabel(genre)}</span>)}</div>}
          <div className="detail-main-actions">{canWatch ? <Link className="primary" to={watchUrl}><Play size={19} fill="currentColor"/>{progress ? 'Продолжить' : 'Смотреть'}{progress && <span className="detail-resume-episode">Серия {progress.episode}</span>}</Link> : availability.loading?<button className="primary" disabled>Проверяем источники…</button>:<Link className="primary" to={searchUrl}><Search size={19}/> Найти озвучки</Link>}<button className={'secondary detail-save' + (isSaved ? ' is-saved' : '')} onClick={() => toggle(saveItem)} disabled={!canWatch&&!isSaved} aria-pressed={isSaved}>{isSaved ? <Check size={19}/> : <Bookmark size={19}/>}<span>{isSaved ? 'В моём списке' : 'Смотреть позже'}</span></button></div>
          {progress && canWatch && <p className="detail-progress-note">Сезон {progress.season} · серия {progress.episode}{progress.time > 0 ? ' · остановились на ' + Math.floor(progress.time / 60) + ':' + String(Math.floor(progress.time % 60)).padStart(2, '0') : ''}</p>}
          {!canWatch && !availability.loading && <p className="detail-progress-note">Доступная версия пока не найдена. Можно проверить другие названия в поиске.</p>}
        </div>
      </div>
    </section>

    <nav className="detail-jump-nav" aria-label="Разделы страницы аниме"><a href="#overview">Об аниме</a><a href="#watch-options">Где смотреть</a><span className="detail-data-source">Данные · {anime.provider}</span></nav>
    <div className="detail-body">
      <div className="detail-editorial">
       <section className="detail-synopsis" id="overview"><span className="detail-section-kicker">ИСТОРИЯ</span><h2>Об аниме</h2><p id="anime-synopsis" className={description.length>650&&!expanded?'synopsis-collapsed':''}>{description}</p>{description.length>650&&<button className="synopsis-toggle" aria-expanded={expanded} aria-controls="anime-synopsis" onClick={()=>setExpanded(v=>!v)}>{expanded?'Свернуть':'Читать полностью'}<ChevronDown size={15}/></button>}{anime.notification && <div className="notice">{anime.notification}</div>}</section>
       <section className="detail-watch-options" id="watch-options"><div className="detail-section-heading"><div><span className="detail-section-kicker">ПРОСМОТР</span><h2>Твоя история. Твоя озвучка.</h2></div><Film size={24}/></div>
        {canWatch&&<Link className="detail-provider-option" to={watchUrl}><span className="detail-provider-icon"><Play size={18} fill="currentColor"/></span><span><strong>{watchAnime?.provider}</strong><small>{watchAnime?.available_episodes!=null?`${watchAnime?.available_episodes} серий доступно`:'Выбор серии и озвучки в плеере'}</small></span><ArrowRight size={19}/></Link>}
        <Link className="detail-find-voices" to={searchUrl}><Search size={18}/><span><strong>{canWatch?'Другие озвучки и источники':'Найти источник просмотра'}</strong><small>Поиск по всем подключённым каталогам</small></span><ArrowRight size={17}/></Link>
        {availability.error&&<ErrorBox error={availability.error} retry={availability.reload}/>}
       </section>
      </div>
      <aside className="detail-information" aria-label="Информация об аниме"><span className="detail-section-kicker">ДЕТАЛИ РЕЛИЗА</span><h2>Всё о тайтле</h2><div className="detail-facts">{!!anime.episodes_total&&<div><Film size={17}/><strong>{anime.episodes_total}</strong><span>серий</span></div>}{!!anime.duration&&<div><Clock3 size={17}/><strong>{anime.duration}</strong><span>минут / серия</span></div>}</div><dl>{status&&<div><dt>Статус</dt><dd>{status}</dd></div>}{anime.year&&<div><dt>Год выхода</dt><dd>{anime.year}</dd></div>}{anime.studios?.length ? <div><dt>{anime.source === 'aniliberty' ? 'Озвучка' : 'Студия'}</dt><dd>{anime.studios.join(', ')}</dd></div> : null}{anime.available_episodes != null && <div><dt>Доступно серий</dt><dd>{anime.available_episodes}</dd></div>}{anime.genres?.length ? <div><dt>Жанры</dt><dd>{anime.genres.map(genreLabel).join(', ')}</dd></div> : null}<div><dt>Источник</dt><dd>{anime.provider}</dd></div></dl>{anime.url && /^https?:/.test(anime.url) && <a className="detail-source-link" href={anime.url} target="_blank" rel="noreferrer">Открыть у источника <ExternalLink size={13}/></a>}</aside>
    </div>

  </article>;
}
