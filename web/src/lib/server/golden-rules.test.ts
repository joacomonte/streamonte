// Vectores compartidos con el núcleo Rust (/packages/golden/*.json), de las reglas alineadas en U-C:
// calce y orden de subtítulos, qué archivo y audio de TorBox, lista de addons. Rust manda; mismo formato que
// golden.test.ts ("diverge" = diferencia conocida: se salta). Los tests no corren en Vercel.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MatchableSub } from '../../../../packages/ui/src/sub-match.ts';

// torrents.ts / keys.ts guardan en `.data` relativo al cwd: se trabaja en un tmp.
const work = mkdtempSync(join(tmpdir(), 'streamonte-golden-rules-'));
const cwd = process.cwd();
process.chdir(work);
process.env.TMDB_KEY = 'x';
delete process.env.VERCEL;
const { ADDONS } = await import('./torrents.ts');
const { pick } = await import('./torbox/client.ts');
const { Fail } = await import('./http-route.ts');
const { pickAudio } = await import('./torbox/link.ts');
const { rank } = await import('../../../../packages/ui/src/sub-match.ts');
after(() => {
	process.chdir(cwd);
	rmSync(work, { recursive: true, force: true });
});

type Case = { in: any; out: any; nota?: string; diverge?: string };
const load = (name: string): Case[] => JSON.parse(readFileSync(join(import.meta.dirname, '../../../../packages/golden', `${name}.json`), 'utf8'));

function golden(name: string, run: (input: any) => unknown) {
	for (const [i, c] of load(name).entries()) {
		const label = `${name} #${i + 1} ${c.nota ?? JSON.stringify(c.in).slice(0, 60)}`;
		if (c.diverge) test(label, { skip: c.diverge }, () => {});
		else test(label, () => assert.deepEqual(run(c.in), c.out));
	}
}

const subOf = (s: any): MatchableSub & { id?: string } => ({ ...s, native: s.provider === 'torrent', com: s.provider === 'opensubtitles' });
golden('sub_match', ({ video, sub, subs }) => {
	const match = { release: video.file, video: { fps: video.fps, duration: video.duration } };
	if (subs) return rank(subs.map(subOf), match).map((s: any) => s.id);
	return rank([subOf({ latino: false, downloads: 0, ...sub })], match)[0].level;
});

golden('torbox_pick', ({ files, season, episode, file, audios, orig, release }) => {
	if (files) {
		const t = { file: file ?? null, s: season ? String(season) : null, e: episode ? String(episode) : null };
		try {
			const f = pick(files.map((x: any, id: number) => ({ id, ...x })), t);
			return f ? f.name.split('/').pop() : null;
		} catch (e) {
			if (e instanceof Fail) return { error: 'episode' };
			throw e;
		}
	}
	const { main, lat } = pickAudio(audios, orig, release);
	return { main, lat: lat !== main ? lat : null };
});

test('addons: la lista copiada de la web es la de fábrica del desktop (golden addons.json)', () => {
	assert.deepEqual(ADDONS, load('addons')[0].out);
});
