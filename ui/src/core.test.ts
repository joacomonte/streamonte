// Abrir un título pide ficha y detalles una sola vez aunque los pidan el panel y la ficha compartida a la vez.
import './test-stub.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as core from './core.ts';

test('catalogMeta/catalogDetails: una invocación por título; otra key de TMDB la vuelve a pedir', async () => {
  const calls: string[] = [];
  window.__TAURI__.core.invoke = <T>(cmd: string) => { calls.push(cmd); return Promise.resolve({} as T); };
  await Promise.all([core.catalogMeta('movie', 'tt1'), core.catalogMeta('movie', 'tt1'), core.catalogDetails('movie', 'tt1'), core.catalogDetails('movie', 'tt1')]);
  await core.catalogMeta('movie', 'tt1');
  assert.deepEqual(calls, ['catalog_meta', 'catalog_details']);
  await core.catalogMeta('movie', 'tt2');
  assert.equal(calls.length, 3); // otro título: se pide
  core.forgetTitles();
  await core.catalogDetails('movie', 'tt1');
  assert.equal(calls.length, 4);
});
