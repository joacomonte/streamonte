// El mapa de estado de serie del desktop (`tauri-adapt.ts STATES`) contra los vectores de Rust
// (packages/golden/show_status.json = TMDB, show_status_cinemeta.json = Cinemeta). Rust manda.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STATES } from './tauri-adapt.ts';

type Case = { in: any; out: any; nota?: string };
const load = (name: string): Case[] => JSON.parse(readFileSync(new URL(`../../packages/golden/${name}.json`, import.meta.url), 'utf8'));

test('show_status (TMDB): estado por la palabra de TMDB', () => {
	for (const c of load('show_status')) {
		const status: string | null = c.in.status;
		assert.equal((status != null ? STATES[status] : undefined) ?? null, c.out.state, JSON.stringify(c.in));
	}
});

test('show_status_cinemeta: Continuing / Ended', () => {
	for (const c of load('show_status_cinemeta')) assert.equal((c.in != null ? STATES[c.in] : undefined) ?? null, c.out, c.nota);
});
