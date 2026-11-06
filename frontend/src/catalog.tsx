import {useEffect, useState} from 'react';
import {Link, useSearchParams} from 'react-router-dom';
import {ArrowRight, ChevronLeft, ChevronRight, SlidersHorizontal, X} from 'lucide-react';
import {Catalog, useApi} from './api';
import {Empty, ErrorBox, Grid, Loading} from './components';
import './catalog.css';

const formats = [['TV', 'Сериал'], ['MOVIE', 'Фильм'], ['ONA', 'ONA'], ['OVA', 'OVA'], ['SPECIAL', 'Спецвыпуск']];

export function CatalogPage({top = false}: {top?: boolean}) {
  const [params, setParams] = useSearchParams();
  const genres = useApi<{id: number; name: string}[]>(top ? null : '/genres');
  const rawPage = Number(params.get('page'));
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const [year, setYear] = useState(params.get('year') || '');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const result = useApi<Catalog>(top ? '/top?page=' + page : '/catalog?' + params.toString());
  const activeFilters = ['genre', 'year', 'kind', 'status'].filter(key => params.has(key));
  useEffect(() => setYear(params.get('year') || ''), [params]);

  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    next.delete('page');
    setParams(next);
  }
  function commitYear() {
    if (!year || Number(year) >= 1900 && Number(year) <= 2100) filter('year', year);
    else setYear(params.get('year') || '');
  }
  function move(value: number) {
    const next = new URLSearchParams(params);
    next.set('page', String(value));
    setParams(next);
    window.scrollTo({top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
  }

  return <section className="catalog-page">
    <div className="catalog-heading">
      <div><div className="catalog-kicker">{top ? 'ВЫБОР ЗРИТЕЛЕЙ' : 'БОЛЬШЕ ИСТОРИЙ'}</div><h1>{top ? 'Лучшее в аниме' : 'Каталог'}</h1><p>{top ? 'Истории, которые остаются с тобой. По оценкам зрителей AniList.' : 'Выбери настроение. Найди свою следующую историю.'}</p></div>
      <Link className="catalog-search-link" to="/search">Поиск по всем источникам <ArrowRight size={17}/></Link>
    </div>

    {!top && <>
      <div className="catalog-filter-toggle"><button onClick={() => setFiltersOpen(open => !open)} aria-expanded={filtersOpen} aria-controls="catalog-filters"><SlidersHorizontal size={17}/> Фильтры{activeFilters.length > 0 && <span>{activeFilters.length}</span>}</button></div>
      <div id="catalog-filters" className={'catalog-filters' + (filtersOpen ? ' is-open' : '')}>
        <label>Жанр<select aria-label="Жанр" value={params.get('genre') || ''} onChange={event => filter('genre', event.target.value)}><option value="">Все жанры</option>{genres.data?.map(genre => <option key={genre.id} value={genre.id}>{genre.name}</option>)}</select></label>
        <label>Год<input aria-label="Год выхода" type="number" min="1900" max="2100" placeholder="Любой" value={year} onChange={event => setYear(event.target.value)} onBlur={commitYear} onKeyDown={event => {if (event.key === 'Enter') event.currentTarget.blur();}}/></label>
        <label>Формат<select aria-label="Формат" value={params.get('kind') || ''} onChange={event => filter('kind', event.target.value)}><option value="">Любой</option>{formats.map(([value, title]) => <option value={value} key={value}>{title}</option>)}</select></label>
        <label>Статус<select aria-label="Статус" value={params.get('status') || ''} onChange={event => filter('status', event.target.value)}><option value="">Любой</option><option value="ongoing">Сейчас выходит</option><option value="finished">Завершён</option></select></label>
        <label className="catalog-sort">Сортировка<select aria-label="Сортировка" value={params.get('sort') || 'fresh'} onChange={event => filter('sort', event.target.value)}><option value="fresh">По обновлению</option><option value="rating">По рейтингу AniLibria.TV</option><option value="year">Сначала новые</option></select></label>
      </div>
      {genres.error && <p className="subtle">Жанры временно не загрузились. Остальные фильтры доступны.</p>}
    </>}

    <div className="catalog-results-bar"><div>{result.loading ? 'Загружаем каталог…' : result.data?.total ? <><strong>{result.data.total.toLocaleString('ru')}</strong> тайтлов</> : top ? 'Рейтинг AniList' : 'Релизы AniLibria.TV'}{!top && <span className="catalog-source-label">AniLibria.TV</span>}</div><div>{activeFilters.length > 0 && !top && <button className="catalog-reset" onClick={() => {setParams({}); setYear('');}}><X size={14}/> Сбросить фильтры</button>}<span>Страница {page}</span></div></div>
    {result.loading ? <Loading/> : result.error ? <ErrorBox error={result.error} retry={result.reload}/> : result.data?.items.length ? <Grid items={result.data.items} rank={top} page={page}/> : <Empty><h2>Пока ничего не нашлось</h2><p>Попробуй другой жанр или год выпуска.</p><button className="secondary" onClick={() => {setParams({}); setYear('');}}>Сбросить фильтры</button></Empty>}
    <nav className="catalog-pagination" aria-label="Страницы каталога"><button disabled={page <= 1 || result.loading} onClick={() => move(page - 1)}><ChevronLeft size={17}/><span>Назад</span></button><span><strong>{page}</strong>{result.data?.total_pages ? ' / ' + result.data.total_pages : ''}</span><button disabled={result.loading || !!result.error || !(top ? result.data?.has_next : page < (result.data?.total_pages || 1))} onClick={() => move(page + 1)}><span>Дальше</span><ChevronRight size={17}/></button></nav>
    {top && <p className="catalog-footnote">Оценки и информация — AniList. Доступные озвучки можно найти со страницы аниме.</p>}
  </section>;
}
