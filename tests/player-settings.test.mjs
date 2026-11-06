import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../frontend/src/player-settings.ts', import.meta.url), 'utf8');
const {outputText} = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022}});
const {PLAYER_DEFAULTS, normalizePreferences, validSegments, currentSegment, shouldAutoSkip, preferredStreamIndex, timeLabel, languageCode, languageLabel, translationFilters, expiredPlaybackError, alternateStreamIndex, changeVolume} = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

test('corrupted or outdated saved preferences do not break video playback', () => {
  assert.deepEqual(normalizePreferences(null), PLAYER_DEFAULTS);
  assert.deepEqual(normalizePreferences('broken'), PLAYER_DEFAULTS);
  const settings = normalizePreferences({autoNext: false, autoFullscreen: 'yes', speed: 9, volume: Infinity, quality: '720'});
  assert.equal(settings.autoNext, false);
  assert.equal(settings.autoFullscreen, false);
  assert.equal(settings.speed, 1);
  assert.equal(settings.quality, 0);
  assert.equal(settings.volume, 1);
  assert.equal(normalizePreferences({volume: 3}).volume, 1);
  assert.equal(normalizePreferences({volume: -3}).volume, 0);
});

test('skip only valid source timestamps and preserve scenes after an ending', () => {
  const segments = validSegments([
    {kind: 'ending', start: 1200, end: 1290},
    {kind: 'opening', start: 50, end: 140},
    {kind: 'opening', start: -1, end: 90},
    {kind: 'ending', start: 1400, end: 1420},
    {kind: 'opening', start: 400, end: 390},
    {kind: 'advert', start: 450, end: 480},
    {kind: 'ending', start: NaN, end: 300},
  ], 1320);
  assert.deepEqual(segments, [
    {kind: 'opening', start: 50, end: 140},
    {kind: 'ending', start: 1200, end: 1290},
  ]);
  assert.equal(currentSegment(segments, 49.9), undefined);
  assert.equal(currentSegment(segments, 50)?.kind, 'opening');
  assert.equal(currentSegment(segments, 140), undefined);
  assert.equal(currentSegment(segments, 1295), undefined);
  assert.equal(segments[1].end, 1290); // Last 30 seconds remain playable.
  assert.equal(validSegments([{kind: 'ending', start: 1250, end: 1500}], 1320)[0].end, 1320);
  assert.deepEqual(validSegments([], 1320), []); // No heuristic 90-second skips.
});

test('opening and ending preferences act independently', () => {
  const settings = {...PLAYER_DEFAULTS, skipOpening: true};
  assert.equal(shouldAutoSkip({kind: 'opening', start: 0, end: 90}, settings), true);
  assert.equal(shouldAutoSkip({kind: 'ending', start: 0, end: 90}, settings), false);
  assert.equal(shouldAutoSkip({kind: 'other', start: 0, end: 90}, {...settings, skipEnding: true}), false);
});

test('saved quality follows available streams when switching episodes', () => {
  const streams = [
    {quality: 1080, kind: 'hls'}, {quality: 720, kind: 'mp4'},
    {quality: 720, kind: 'hls'}, {quality: 480, kind: 'mp4'},
  ];
  assert.equal(preferredStreamIndex(streams, 720), 2);
  assert.equal(preferredStreamIndex(streams, 480), 3);
  assert.equal(preferredStreamIndex(streams, 0), 0);
  assert.equal(preferredStreamIndex(streams, 900), 1);
  assert.equal(preferredStreamIndex(streams, 360), 3);
  assert.equal(preferredStreamIndex([], 720), 0);
});

test('time labels handle unloaded metadata and movies longer than an hour', () => {
  assert.equal(timeLabel(NaN), '0:00');
  assert.equal(timeLabel(Infinity), '0:00');
  assert.equal(timeLabel(-1), '0:00');
  assert.equal(timeLabel(89.9), '1:29');
  assert.equal(timeLabel(7203), '2:00:03');
});


test('language labels use actual metadata and never label unknown tracks as Russian', () => {
  assert.equal(languageCode(undefined), 'und');
  assert.equal(languageCode(''), 'und');
  assert.equal(languageLabel('und'), 'Язык не указан');
  assert.equal(languageCode('EN_us'), 'en');
  assert.equal(languageCode('RUS'), 'ru');
  assert.equal(languageCode('jpn'), 'ja');
  assert.equal(languageLabel('ja'), 'Японский');
});

test('missing preferred language cannot hide all translations in another episode', () => {
  const filters = translationFilters([
    {language:'ru',kind:'voice'}, {language:'ru',kind:'sub'},
    {language:undefined,kind:'voice'},
  ], 'en', 'voice');
  assert.equal(filters.language, 'all');
  assert.equal(filters.kind, 'voice');
  assert.deepEqual(filters.languages, ['ru','und']);
  assert.deepEqual(filters.counts, {all:3,voice:2,sub:1});
});

test('missing subtitle type falls back to available voice tracks', () => {
  const tracks = [{language:'ru',kind:'voice'}, {language:'en',kind:'sub'}];
  const fallback = translationFilters(tracks, 'ru', 'sub');
  assert.equal(fallback.language, 'ru');
  assert.equal(fallback.kind, 'all');
  assert.equal(fallback.counts.sub, 0);
  const matching = translationFilters(tracks, 'en', 'sub');
  assert.equal(matching.language, 'en');
  assert.equal(matching.kind, 'sub');
  assert.deepEqual(translationFilters([], 'ru', 'sub'), {languages:[],language:'all',kind:'all',counts:{all:0,voice:0,sub:0}});
});


test('expired playback handles are distinct from unavailable-provider errors', () => {
  assert.equal(expiredPlaybackError('Ссылка устарела. Выберите серию заново.'), true);
  assert.equal(expiredPlaybackError('Источник сейчас не вернул данные (NotFound).'), false);
  assert.equal(expiredPlaybackError('Не удалось подключиться к CDN'), false);
});

test('format fallback is bounded and keeps the selected quality', () => {
  const streams = [
    {url:'/hls-720',kind:'hls',quality:720}, {url:'/mp4-720',kind:'mp4',quality:720},
    {url:'/hls-480',kind:'hls',quality:480}, {url:'/mp4-480',kind:'mp4',quality:480},
  ];
  const failed = new Set(['/hls-720']);
  assert.equal(alternateStreamIndex(streams, streams[0], failed), 1);
  failed.add('/mp4-720');
  assert.equal(alternateStreamIndex(streams, streams[1], failed), -1);
  assert.equal(alternateStreamIndex([streams[0]], streams[0], new Set()), -1);
});


test('muting restores the last audible volume even after dragging to zero', () => {
  const original = {volume:.6,muted:false,lastAudibleVolume:.6};
  const silent = changeVolume(original,{type:'set',value:0});
  assert.deepEqual(silent,{volume:0,muted:true,lastAudibleVolume:.6});
  assert.deepEqual(changeVolume(silent,{type:'toggle'}),original);
  const muted = changeVolume(original,{type:'toggle'});
  assert.deepEqual(muted,{volume:.6,muted:true,lastAudibleVolume:.6});
  assert.deepEqual(changeVolume(muted,{type:'toggle'}),original);
});

test('volume increments clamp cleanly and slider input unmutes immediately', () => {
  const original = {volume:.95,muted:false,lastAudibleVolume:.95};
  assert.equal(changeVolume(original,{type:'adjust',value:.1}).volume,1);
  assert.equal(changeVolume({...original,volume:.02},{type:'adjust',value:-.05}).volume,0);
  assert.equal(changeVolume({...original,volume:.1},{type:'adjust',value:.05}).volume,.15);
  assert.deepEqual(changeVolume({...original,muted:true},{type:'set',value:.35}),{volume:.35,muted:false,lastAudibleVolume:.35});
  assert.deepEqual(changeVolume(original,{type:'set',value:NaN}),original);
});

test('saved zero volume cannot leave the unmute control permanently silent', () => {
  const saved=normalizePreferences({volume:0});
  assert.equal(saved.lastAudibleVolume,1);
  assert.equal(changeVolume(saved,{type:'toggle'}).volume,1);
  const restored=normalizePreferences({volume:0,muted:true,lastAudibleVolume:.45});
  assert.deepEqual(changeVolume(restored,{type:'toggle'}),{volume:.45,muted:false,lastAudibleVolume:.45});
  assert.equal(normalizePreferences({volume:.3,lastAudibleVolume:NaN}).lastAudibleVolume,.3);
});
