import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { SpanishVariant } from '../latino.ts';
import { isForced, isSdh, nativeRank, type RankSub } from './native-rank.ts';

type Case = { in: { lang: string | null; variant: 'latino' | 'spain' | null; subs: RankSub[] }; out: { order: number[]; recommended: number | null }; nota?: string };
const cases: Case[] = JSON.parse(readFileSync(new URL('../../../golden/native_rank.json', import.meta.url), 'utf8'));
const VARIANT: Record<string, SpanishVariant> = { latino: 'lat', spain: 'spain' };

test('native_rank: golden (misma salida que Rust)', () => {
	assert.ok(cases.length >= 10);
	for (const c of cases) assert.deepEqual(nativeRank(c.in.subs, c.in.lang, VARIANT[c.in.variant ?? ''] ?? 'unknown'), c.out, c.nota);
});

test('el nombre marca sordos y forzados', () => {
	const sub = (title: string): RankSub => ({ lang: 'spa', title, codec: null, forced: false, sdh: false, default: false });
	for (const t of ['Español SDH', 'Spanish [CC]', 'Para sordos', 'Closed Captions', 'HI']) assert.equal(isSdh(sub(t)), true, t);
	for (const t of ['Español', 'Chicago', 'Hindi']) assert.equal(isSdh(sub(t)), false, t);
	for (const t of ['Forzados', 'Signs & Songs', 'Carteles']) assert.equal(isForced(sub(t)), true, t);
	assert.equal(isForced(sub('Español')), false);
});
