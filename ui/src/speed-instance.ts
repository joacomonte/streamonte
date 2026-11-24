// El medidor de esta app: lo comparten `speed.js` (eventos, arranque) y los componentes.
import * as core from './core.ts';
import { setLinkMbps } from './health-store.ts';
import { createSpeedStore } from './speed-store.ts';

export const speedStore = createSpeedStore({ speedTest: (force) => core.speedTest(force), setLinkMbps });
