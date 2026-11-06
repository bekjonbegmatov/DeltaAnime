import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../frontend/src/player-settings.ts', import.meta.url), 'utf8');
const {outputText} = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022}});
const {PLAYER_DEFAULTS, normalizePreferences, validSegments, currentSegment, shouldAutoSkip, preferredStreamIndex, timeLabel} = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

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
