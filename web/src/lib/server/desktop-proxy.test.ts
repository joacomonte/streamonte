// El proxy de TorBox del desktop (`/api/desktop/torbox/*`) quedó en un stub: el desktop ≤ v2.1.4 recibe el aviso de
// que TorBox está deshabilitado, sin reenviar nada a TorBox.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GET, POST } from '../../routes/api/desktop/torbox/[...path]/+server.ts';

for (const [method, handler] of [['GET', GET], ['POST', POST]] as const) {
	test(`proxy del desktop: ${method} responde el aviso y no reenvía`, async () => {
		const r = await (handler as () => Response)();
		assert.equal(r.status, 401);
		assert.match(((await r.json()) as { error: string }).error, /TorBox deshabilitado: cargá tu API key de TorBox en Ajustes/);
	});
}
