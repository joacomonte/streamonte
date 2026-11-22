// Flujo de la lista de subtítulos de UNA opción: buscar afuera, Premium (cuota), usar y marcar probados.
// Clase simple (sin runas) para probarla con `node --test`; el componente copia `view` a un `$state.raw` en `onChange`.
import type { Api, SubsFileId, SubsOption, SubtitleFile } from '../api.ts';
import type { OptionRef, PremiumQuota, SubtitleOption } from '../types.ts';
import { pickKey, keyOf } from './subs-logic.ts';

export type PremState = { open: boolean; status: 'idle' | 'loading' | 'ready' | 'empty' | 'error'; results: SubtitleOption[]; busy: string | null };
export type SubsView = {
	status: 'idle' | 'searching' | 'ready' | 'error';
	list: SubtitleOption[];
	error: string;
	prem: PremState;
	quota: PremiumQuota | null;
	picked: string | null;
	tried: string[];
	/** Bajando subtítulos (desktop, evento del núcleo). */
	progress: { done: number; total: number } | null;
};

/** Lo que reciben `lead` y `actions` de `SubsPicker` para actuar sobre la lista. */
export type SubsCtx = { use: (sub: SubtitleOption) => Promise<SubtitleFile | null>; pick: (key: string) => void; picked: string | null; tried: string[] };

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class SubsFlow {
	view: SubsView = { status: 'idle', list: [], error: '', prem: { open: false, status: 'idle', results: [], busy: null }, quota: null, picked: null, tried: [], progress: null };
	private dead = false;

	private api: Api;
	private ref: OptionRef;
	private option: SubsOption;
	private file: SubsFileId | null;
	private onChange: () => void;

	constructor(api: Api, ref: OptionRef, option: SubsOption, file: SubsFileId | null, onChange: () => void) {
		this.api = api;
		this.ref = ref;
		this.option = option;
		this.file = file;
		this.onChange = onChange;
	}

	private set(patch: Partial<SubsView>): void {
		if (this.dead) return;
		this.view = { ...this.view, ...patch };
		this.onChange();
	}
	private setPrem(patch: Partial<PremState>): void {
		this.set({ prem: { ...this.view.prem, ...patch } });
	}
	/** El resultado de un pedido que llegó tarde (se cerró o cambió la opción) se descarta. */
	dispose(): void {
		this.dead = true;
	}

	/** Afuera: gratis. Con el hash del archivo (web) suma los hechos para ese archivo exacto. */
	async search(): Promise<void> {
		if (this.view.status === 'searching') return;
		this.set({ status: 'searching', error: '' });
		try {
			const list = await this.api.subs.find(this.ref, this.option, { file: this.file });
			const chosen = list.find((s) => s.chosen);
			this.set({ status: 'ready', list, picked: chosen ? keyOf(chosen) : this.view.picked, tried: list.filter((s) => s.tried).map(keyOf) });
		} catch (e) {
			this.set({ status: 'error', error: msg(e) });
		}
	}

	async loadQuota(): Promise<void> {
		try {
			this.set({ quota: (await this.api.premium?.quota()) ?? this.view.quota });
		} catch {
			/* se queda con la anterior */
		}
	}

	async premiumSearch(): Promise<void> {
		if (!this.api.premium) return;
		this.setPrem({ status: 'loading' });
		try {
			const results = await this.api.premium.search(this.ref, this.option);
			this.setPrem({ results, status: results.length ? 'ready' : 'empty' });
			void this.loadQuota();
		} catch {
			this.setPrem({ status: 'error' });
		}
	}

	/** El candado: abre/cierra; buscar es gratis y corre al abrir. */
	async togglePremium(): Promise<void> {
		if (!this.view.quota) await this.loadQuota();
		this.setPrem({ open: !this.view.prem.open });
		if (this.view.prem.open && this.view.quota?.hasKey && this.view.prem.status === 'idle') await this.premiumSearch();
	}

	pick(key: string): void {
		this.set(pickKey(this.view, key));
	}

	/** Baja/elige ese subtítulo (Premium gasta 1 de la cuota: solo con este toque). null si no se pudo. */
	async use(sub: SubtitleOption): Promise<SubtitleFile | null> {
		if (sub.premium && (this.view.prem.busy || this.view.quota?.remaining === 0)) return null;
		if (sub.premium) this.setPrem({ busy: sub.id });
		try {
			const file = await this.api.subs.get(this.ref, this.option, sub);
			this.pick(keyOf(sub));
			return file;
		} catch (e) {
			this.set({ error: msg(e) });
			return null;
		} finally {
			if (sub.premium) {
				this.setPrem({ busy: null });
				void this.loadQuota();
			}
		}
	}

	setProgress(p: { done: number; total: number } | null): void {
		this.set({ progress: p });
	}
}
