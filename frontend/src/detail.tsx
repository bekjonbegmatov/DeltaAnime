import {useContext} from 'react';
import {Link, useParams} from 'react-router-dom';
import {ArrowLeft, ArrowRight, Bookmark, Check, ExternalLink, Play, Search, Star} from 'lucide-react';
import {Anime, Progress, read, useApi} from './api';
import {Card, ErrorBox, Loading, Poster, SavedContext, SectionHead} from './components';
import './catalog.css';

const relationNames: Record<string, string> = {SEQUEL: 'Продолжение', PREQUEL: 'Предыстория', SIDE_STORY: 'Ответвление', ALTERNATIVE: 'Другая версия', SPIN_OFF: 'Спин-офф', PARENT: 'Основная история', SUMMARY: 'Краткий пересказ', ADAPTATION: 'Адаптация', CHARACTER: 'Общие персонажи', OTHER: 'Связанный тайтл'};
const formatNames: Record<string, string> = {TV: 'Сериал', MOVIE: 'Фильм', OVA: 'OVA', ONA: 'ONA', SPECIAL: 'Спецвыпуск', TV_SHORT: 'Короткий сериал', MUSIC: 'Музыкальное видео'};
const statusNames: Record<string, string> = {released: 'Завершён', finished: 'Завершён', completed: 'Завершён', ongoing: 'Сейчас выходит', releasing: 'Сейчас выходит', anons: 'Анонс', announced: 'Анонс', not_yet_released: 'Анонс', cancelled: 'Отменён', canceled: 'Отменён', hiatus: 'На паузе', paused: 'На паузе'};
const genreNames: Record<string, string> = {action: 'Экшен', adventure: 'Приключения', comedy: 'Комедия', drama: 'Драма', ecchi: 'Этти', fantasy: 'Фэнтези', hentai: 'Хентай', horror: 'Ужасы', 'mahou shoujo': 'Махо-сёдзё', mecha: 'Меха', music: 'Музыка', mystery: 'Детектив', psychological: 'Психологическое', romance: 'Романтика', 'sci-fi': 'Фантастика', 'slice of life': 'Повседневность', sports: 'Спорт', supernatural: 'Сверхъестественное', thriller: 'Триллер'};
function genreLabel(genre: string) {return genreNames[genre.trim().toLowerCase()] || genre;}

export function Detail() {
  const {id} = useParams();
  const result = useApi<Anime>('/titles/' + id);
  const {saved, toggle} = useContext(SavedContext);
  if (result.loading) return <section className="detail-loading"><Loading/></section>;
  if (result.error) return <section className="detail-loading"><ErrorBox error={result.error} retry={result.reload}/></section>;
  const anime = result.data;
  if (!anime) return null;
  const progress = read<Record<string, Progress>>('delta-progress', {})[anime.id];
  const isSaved = saved.some(item => item.id === anime.id);
  const watchUrl = `/watch/${anime.id}${progress ? `?episode=${progress.episode}&season=${progress.season}` : ''}`;
  const searchUrl = '/search?q=' + encodeURIComponent(anime.original_title || anime.title);

  return <article className="cinema-detail">
    <section className={'detail-stage' + (anime.banner ? ' has-banner' : '')}>
      {(anime.banner || anime.poster) && <div className="detail-backdrop" aria-hidden="true" style={{backgroundImage: `url("${anime.banner || anime.poster}")`}}/>}
      <Link className="detail-back" to="/catalog"><ArrowLeft size={17}/> В каталог</Link>
      <div className="detail-stage-content">
        <div className="detail-cover"><Poster anime={anime}/></div>
        <div className="detail-copy">
          <div className="detail-topline">{anime.year && <span>{anime.year}</span>}<span>{formatNames[(anime.format || '').toUpperCase()] || anime.format || 'Аниме'}</span>{anime.age && <span className="detail-age">{anime.age}</span>}</div>
          <h1>{anime.title}</h1>
          {anime.original_title && anime.original_title !== anime.title && <p className="detail-original-title">{anime.original_title}</p>}
          <div className="detail-rating-row">{!!anime.rating && <span className="detail-rating"><Star size={16} fill="currentColor"/><strong>{Number(anime.rating).toFixed(1)}</strong><span>{anime.rating_source || 'Рейтинг'}</span></span>}{anime.status && <span>{statusNames[anime.status.trim().toLowerCase().replace(/[ -]+/g, '_')] || anime.status}</span>}{!!anime.episodes_total && <span>{anime.episodes_total} сер.</span>}{!!anime.duration && <span>{anime.duration} мин.</span>}</div>
          {!!anime.genres?.length && <p className="detail-genre-line">{anime.genres.slice(0, 5).map(genreLabel).join(' · ')}</p>}
          <div className="detail-main-actions">{anime.playable ? <Link className="primary" to={watchUrl}><Play size={19} fill="currentColor"/>{progress ? 'Продолжить' : 'Смотреть'}{progress && <span className="detail-resume-episode">Серия {progress.episode}</span>}</Link> : <Link className="primary" to={searchUrl}><Search size={19}/> Найти озвучки</Link>}<button className={'secondary detail-save' + (isSaved ? ' is-saved' : '')} onClick={() => toggle(anime)} aria-pressed={isSaved}>{isSaved ? <Check size={19}/> : <Bookmark size={19}/>}<span>{isSaved ? 'В моём списке' : 'Смотреть позже'}</span></button></div>
          {progress && anime.playable && <p className="detail-progress-note">Сезон {progress.season} · серия {progress.episode}{progress.time > 0 ? ' · остановились на ' + Math.floor(progress.time / 60) + ':' + String(Math.floor(progress.time % 60)).padStart(2, '0') : ''}</p>}
          {!anime.playable && <p className="detail-progress-note">Выбери доступную озвучку в общем поиске.</p>}
        </div>
      </div>
    </section>

    <div className="detail-body">
      <section className="detail-synopsis"><h2>Об аниме</h2><p>{anime.description || 'Описание этого аниме пока не появилось у источника.'}</p>{anime.notification && <div className="notice">{anime.notification}</div>}<Link className="detail-other-voices" to={searchUrl}>Все озвучки и источники <ArrowRight size={17}/></Link></section>
      <aside className="detail-information" aria-label="Информация об аниме"><h2>Подробности</h2><dl>{anime.studios?.length ? <div><dt>{anime.source === 'aniliberty' ? 'Озвучка' : 'Студия'}</dt><dd>{anime.studios.join(', ')}</dd></div> : null}{!!anime.episodes_total && <div><dt>Количество серий</dt><dd>{anime.episodes_total}</dd></div>}{anime.available_episodes != null && <div><dt>Доступно серий</dt><dd>{anime.available_episodes}</dd></div>}{!!anime.duration && <div><dt>Длительность</dt><dd>{anime.duration} мин.</dd></div>}{anime.genres?.length ? <div><dt>Жанры</dt><dd>{anime.genres.map(genreLabel).join(', ')}</dd></div> : null}<div><dt>Источник</dt><dd>{anime.provider}</dd></div></dl>{anime.url && /^https?:/.test(anime.url) && <a className="detail-source-link" href={anime.url} target="_blank" rel="noreferrer">Открыть у источника <ExternalLink size={13}/></a>}</aside>
    </div>

    {!!anime.relations?.length && <section className="shelf detail-related"><SectionHead title="Связанные истории"/><div className="cards">{anime.relations.map(relation => <Card key={relation.id + relation.relation} anime={{...relation, provider: relationNames[relation.relation] || relation.relation.replaceAll('_', ' '), playable: false}}/>)}</div></section>}
  </article>;
}
