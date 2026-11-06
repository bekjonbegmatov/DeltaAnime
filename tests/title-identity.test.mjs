import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../frontend/src/title-identity.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}});
const {sameTitle,merge}=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
const anime=(id,extra={})=>({id,title:'Blue Lock',provider:id,playable:true,...extra});

test('confirmed Shikimori IDs group video providers without inventing MAL IDs',()=>{
 const items=[anime('kd',{shikimori_id:'90'}),anime('aml',{shikimori_id:90})];
 const result=merge(items);assert.equal(result.length,1);assert.equal(result[0].mal_id,undefined);
 assert.deepEqual(result[0].variants.map(v=>v.id),['kd','aml']);assert.equal(items[0].variants,undefined);
});
test('cross-namespace equal numbers and conflicting season IDs stay separate',()=>{
 assert.equal(sameTitle(anime('a',{mal_id:90}),anime('b',{shikimori_id:90})),false);
 assert.equal(sameTitle(anime('a',{mal_id:125,shikimori_id:90}),anime('b',{mal_id:126,shikimori_id:90})),false);
 assert.equal(merge([anime('season-1'),anime('season-2')]).length,2);
});
test('verified identity enrichment preserves all variants and prefers viewing',()=>{
 const result=merge([anime('meta',{mal_id:125,playable:false}),anime('kd',{mal_id:125,shikimori_id:90}),anime('aml',{shikimori_id:90})]);
 assert.equal(result.length,1);assert.equal(result[0].id,'kd');assert.equal(result[0].playable,true);
 assert.equal(result[0].variants.length,3);assert.equal(result[0].mal_id,125);
});
