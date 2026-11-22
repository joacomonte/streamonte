// Flujo del magnet pegado: pregunta a TorBox (con quién es, solo la primera vez), avance cada `pollMs` mientras se baja, y "Bajarlo".
// Clase simple (sin runas) para probarla con `node --test`; el componente copia `view` a un `$state.raw` en `onChange`.
import type { Api } from '../api.ts';
import { t } from '../i18n/runtime.ts';
import type { Identified, MagnetStatus } from '../types.ts';

export type MagnetFlowView = { status: MagnetStatus | null; ident: Identified | null; error: string; adding: boolean };

export class MagnetFlow {
	view: MagnetFlowView = { status: null, ident: null, error: '', adding: false };
	private timer: ReturnType<typeof setInterval> | undefined;
	private dead = false;
	private api: Api;
	private hash: string;
	private name: string;
	private onChange: () => void;
	private pollMs: number;

	constructor(api: Api, hash: string, name: string, onChange: () => void, pollMs = 4000) {
		this.api = api;
		this.hash = hash;
		this.name = name;
		this.onChange = onChange;
		this.pollMs = pollMs;
	}

	private set(patch: Partial<MagnetFlowView>): void {
		if (this.dead) return;
		this.view = { ...this.view, ...patch };
		this.onChange();
		// Bajándose en TorBox: se pregunta el avance mientras siga así.
		clearInterval(this.timer);
		this.timer = this.view.status?.state === 'downloading' ? setInterval(() => void this.load(false), this.pollMs) : undefined;
	}
	private fail(e: unknown): void {
		this.set({ error: t(e instanceof Error ? e.message : String(e)) });
	}

	/** `who`: también qué película o serie es (solo la primera vez). */
	async load(who: boolean): Promise<void> {
		try {
			const r = await this.api.magnet.status(this.hash, this.name, who);
			this.set({ status: r.status, ...(who ? { ident: r.ident } : {}) });
		} catch (e) {
			// Una consulta de avance que falla no tapa lo que ya se ve.
			if (who || !this.view.status) this.fail(e);
		}
	}

	async download(): Promise<void> {
		this.set({ adding: true, error: '' });
		try {
			this.set({ status: await this.api.magnet.download(this.hash, this.name), adding: false });
		} catch (e) {
			this.set({ adding: false });
			this.fail(e);
		}
	}

	dispose(): void {
		this.dead = true;
		clearInterval(this.timer);
	}
}
