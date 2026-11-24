// Alias de `node scripts/scenes.mjs --shots`: regresión visual (escenas con `shot` en tests/scenes/). Mismos flags que antes:
// [--update] [--only TEXTO] [--threshold PCT] [--tol CANAL] [--out DIR] [--record] [--ui-url URL] [--web-url URL] [--changed] [--changed-apps]
import { spawnSync } from 'node:child_process';
const runner = new URL('./scenes.mjs', import.meta.url).pathname;
const r = spawnSync(process.execPath, [runner, '--shots', ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
