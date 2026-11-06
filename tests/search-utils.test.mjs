import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const source=await readFile(new URL('../frontend/src/search-utils.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}});
const {searchQuery,searchHistory,searchView,searchSort,searchScore,sortSearchResults,numberValue,episodeCount,sourceNames,titleCount}=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
const anime=(id,values={})=>({id,title:'Аниме '+id,provider:'Kodik',...values});

test('the exact original title outranks a playable but partial match',()=>{
 const items=[anime('related',{title:'Blue Lock movie',playable:true}),anime('exact',{title:'Синяя тюрьма',original_title:'Blue Lock',playable:false})];
 assert.deepEqual(sortSearchResults(items,searchSort('relevance'),'blue lock').map(a=>a.id),['exact','related']);
 assert.equal(searchScore(anime('ru',{title:'Ёлка: история'}),'елка история'),100);
 assert.equal(searchScore(anime('jp',{title:'ＢＬＵＥ　ＬＯＣＫ'}),'blue lock'),100);
 assert.equal(searchScore(items[0],'   '),0);
});

test('provider completion order cannot shuffle equally relevant results',()=>{
 const items=[anime('meta',{title:'Blue Lock',playable:false}),anime('play-b',{title:'Blue Lock',playable:true}),anime('play-a',{title:'Blue Lock',playable:true})];
 const original=[...items];
 const forward=sortSearchResults(items,searchSort('relevance'),'blue lock');
 const reverse=sortSearchResults([...items].reverse(),searchSort('relevance'),'blue lock');
 assert.deepEqual(forward.map(a=>a.id),['play-a','play-b','meta']);
 assert.deepEqual(reverse,forward);
 assert.deepEqual(items,original,'sorting must not mutate cached provider data');
});

test('missing and invalid ratings stay last in both sort directions',()=>{
 const items=[anime('missing'),anime('high',{rating:'9.4'}),anime('invalid',{rating:Infinity}),anime('low',{rating:6.5}),anime('zero',{rating:0})];
 const ascending=sortSearchResults(items,searchSort('rating','asc'),'');
 const descending=sortSearchResults(items,searchSort('rating','desc'),'');
 assert.deepEqual(ascending.slice(0,2).map(a=>a.id),['low','high']);
 assert.deepEqual(descending.slice(0,2).map(a=>a.id),['high','low']);
 for(const value of [null,undefined,'',true,-5,NaN,Infinity])assert.equal(numberValue(value),null);
});

test('table columns sort numeric years, episode totals, names, and sources',()=>{
 const items=[anime('a',{title:'Сезон 10',year:'2024',episodes_total:12,available_episodes:4,provider:'Kodik'}),anime('b',{title:'Сезон 2',year:2022,available_episodes:24,provider:'AniList'}),anime('c',{title:'Сезон 1',provider:'Kitsu'})];
 assert.deepEqual(sortSearchResults(items,searchSort('year','asc'),'').map(a=>a.id),['b','a','c']);
 assert.deepEqual(sortSearchResults(items,searchSort('episodes'),'').map(a=>a.id),['b','a','c']);
 assert.deepEqual(sortSearchResults(items,searchSort('title'),'').map(a=>a.id),['c','b','a']);
 assert.deepEqual(sortSearchResults(items,searchSort('title','desc'),'').map(a=>a.id),['a','b','c']);
 assert.deepEqual(sortSearchResults(items,searchSort('source'),'').map(a=>a.id),['b','c','a']);
 assert.equal(episodeCount(items[0]),12);
 assert.equal(episodeCount(anime('new',{episodes_total:0,available_episodes:0})),0);
 assert.equal(episodeCount(items[2]),null);
 const mixed=anime('mixed',{provider:'Kodik',variants:[{provider:'AniList'},{provider:'Kodik'},{provider:'AniList'}]});
 assert.deepEqual(sourceNames(mixed),['AniList','Kodik']);
 assert.deepEqual(sortSearchResults([mixed,anime('kitsu',{provider:'Kitsu'})],searchSort('source'),'').map(a=>a.id),['kitsu','mixed'],'source sort follows the visible primary provider');
});

test('malformed saved preferences and shared URL values fall back safely',()=>{
 assert.equal(searchView('table'),'table');
 assert.equal(searchView({view:'table'}),'grid');
 assert.equal(searchView(null,'table'),'table');
 assert.deepEqual(searchSort('__proto__'),{key:'relevance',direction:'desc'});
 assert.deepEqual(searchSort('year','sideways'),{key:'year',direction:'desc'});
 assert.equal(searchQuery('  Blue   Lock\n '),'Blue Lock');
 assert.equal(searchQuery(null),'');
 assert.equal(searchQuery('x'.repeat(150)).length,100);
 assert.deepEqual(searchHistory({broken:true}),[]);
 assert.deepEqual(searchHistory([' Blue Lock ','blue lock',null,'x','Наруто']),['Blue Lock','Наруто']);
 assert.deepEqual([1,2,5,11,14,21,23,111].map(titleCount),['тайтл','тайтла','тайтлов','тайтлов','тайтлов','тайтл','тайтла','тайтлов']);
});


test('Резе ranks as a whole word above презерватив and irrelevant description hits',()=>{
 const reze=anime('reze',{title:'Человек-бензопила. Фильм: История Резе',original_title:'Chainsaw Man Movie: Reze Arc',playable:true});
 const internal=anime('unrelated',{title:'Боец-презерватив Горо',playable:true});
 const descriptionHit=anime('description',{title:'Evil or Live',playable:true});
 assert.deepEqual(sortSearchResults([internal,descriptionHit,reze],searchSort('relevance'),'Резе').map(a=>a.id),['reze','unrelated','description']);
 assert.ok(searchScore(reze,'Рез')>searchScore(internal,'Рез'),'partial typing also prefers the start of a word');
 const englishInternal=anime('internal-en',{title:'The Preze Story'});
 assert.ok(searchScore(reze,'Reze')>searchScore(englishInternal,'Reze'));
 assert.ok(searchScore(reze,'reze man')>searchScore(englishInternal,'reze man'),'unordered exact tokens retain strong relevance');
 assert.equal(searchScore(descriptionHit,'Резе'),0);
 // Do not drop source matches solely for a missing visible alias: servers may search translations.
 assert.equal(sortSearchResults([descriptionHit],searchSort('relevance'),'Резе').length,1);
});
