// @ts-check
// Abrir un título pide ficha y detalles una sola vez aunque los pidan el panel y la ficha compartida a la vez.
import './test-stub.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api, forgetTitles } from './api.js';

test('catalogMeta/catalogDetails: una invocación por título; otra key de TMDB la vuelve a pedir', async () => {
  /** @type {string[]} */
  const calls = [];
  const { core } = /** @type {{ __TAURI__: { core: { invoke: (cmd: string) => Promise<unknown> } } }} */ (/** @type {unknown} */ (globalThis)).__TAURI__;
  core.invoke = (cmd) => { calls.push(cmd); return Promise.resolve({}); };
  await Promise.all([api.catalogMeta('movie', 'tt1'), api.catalogMeta('movie', 'tt1'), api.catalogDetails('movie', 'tt1'), api.catalogDetails('movie', 'tt1')]);
  await api.catalogMeta('movie', 'tt1');
  assert.deepEqual(calls, ['catalog_meta', 'catalog_details']);
  await api.catalogMeta('movie', 'tt2');
  assert.equal(calls.length, 3); // otro título: se pide
  forgetTitles();
  await api.catalogDetails('movie', 'tt1');
  assert.equal(calls.length, 4);
});
