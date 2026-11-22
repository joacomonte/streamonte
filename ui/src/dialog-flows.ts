// Flujos con diálogos que llama el resto de la app (por `dialogs.js`): cierre de mpv, limpieza, cierre de la ventana, log.
import { humanBytes } from '$ui/format.ts';
import { confirmDialog } from './confirm-queue.ts';
import { desktop } from './desktopApi.ts';
import { setStatus, showError } from './dom.js';
import { t } from './i18n.js';
import { state, titleOf } from './state.js';
import { host } from './ui-host.ts';
import type * as Raw from './types.js';

/** Se cerró mpv sin terminar de bajar: detener y borrar (por defecto), pausar guardando lo bajado, o seguir bajando de fondo. */
export async function askAfterClose(row: Raw.PlaybackRow): Promise<void> {
	const pct = Math.floor((row.progress ?? 0) * 100);
	const choice = await confirmDialog<Raw.PlaybackAction>(t('Cerraste el reproductor'), { name: titleOf(row.key), pct }, [
		{ id: 'close-keep', label: t('Seguir bajando'), value: 'keep-downloading' },
		{ id: 'close-pause', label: t('Pausar'), value: 'stop' },
		{ id: 'close-delete', label: t('Detener y borrar'), value: 'stop-and-delete', primary: true }
	]);
	// Cerrar el diálogo sin elegir (Esc) = pausar: nunca se borra sin un clic. Si ya se resolvió solo, no importa.
	desktop.playbackAction(row.id, choice ?? 'stop').catch(() => {});
}

export async function openLog(row: Raw.PlaybackRow): Promise<void> {
	state.logOpenFor = row.id;
	const lines = await desktop.playbackLog(row.id).catch(() => state.logs.get(row.id) ?? []);
	state.logs.set(row.id, lines);
	host.openLog?.(t('Detalle — {name}', { name: row.name }), lines);
}

export async function cleanTemp(): Promise<void> {
	try {
		const usage = await desktop.tempUsage();
		if (usage.bytes === 0) {
			setStatus(t('La caché está vacía.'));
			return;
		}
		const ok = await confirmDialog(
			t('Borrar caché'),
			t('Se van a borrar {a}: lo analizado y restos que no están en uso. No se tocan lo que se está reproduciendo ni las descargas guardadas.', { a: humanBytes(usage.bytes) }),
			[{ label: t('Cancelar'), value: false }, { label: t('Borrar {a}', { a: humanBytes(usage.bytes) }), value: true, primary: true }]
		);
		if (!ok) return;
		const r = await desktop.cleanTemp();
		setStatus(t('Caché borrada: {dirs_removed} carpeta(s), {a} liberados{b}.', { dirs_removed: r.dirs_removed, a: humanBytes(r.bytes_freed), b: r.failures.length ? t(' · {n} no se pudieron borrar (se reintenta al abrir)', { n: r.failures.length }) : '' }));
	} catch (e) {
		showError(e);
	}
}

/** "Borrar datos guardados": la caché de datos es útil, así que se explica antes. */
export async function clearDataCache(): Promise<void> {
	try {
		const bytes = await desktop.dataCacheSize();
		if (!bytes) { setStatus(t('No hay datos guardados.')); return; }
		const ok = await confirmDialog(
			t('Borrar datos guardados'),
			t('Son {a} de fichas, portadas, puntajes por temporada y los datos de IMDb. Sirven para que el catálogo y las series abran al instante y no haya que volver a bajarlos (los de IMDb tardan unos segundos). No son videos.\n\nSi los borrás no se pierde nada: se vuelven a bajar cuando hagan falta.', { a: humanBytes(bytes) }),
			[{ id: 'data-clear-cancel', label: t('Cancelar'), value: false }, { id: 'data-clear-ok', label: t('Borrar {a}', { a: humanBytes(bytes) }), value: true, primary: true }]
		);
		if (!ok) return;
		setStatus(t('Datos guardados borrados: {a} liberados.', { a: humanBytes(await desktop.clearDataCache()) }));
	} catch (e) {
		showError(e);
	}
}

export async function stopAllAndClean(): Promise<void> {
	const ok = await confirmDialog(
		t('Borrar todo'),
		t('Se detienen todas las reproducciones y se borra TODO lo descargado, también lo pausado. Tu lista de magnets no se toca.'),
		[{ label: t('Cancelar'), value: false }, { label: t('Borrar todo'), value: true, primary: true }]
	);
	if (!ok) return;
	try {
		const r = await desktop.stopAllAndClean();
		setStatus(t('Todo borrado.{a}', { a: r.dirs_removed ? t(' Restos limpiados: {a}.', { a: humanBytes(r.bytes_freed) }) : '' }));
	} catch (e) {
		showError(e);
	}
}

/** Cada clic en la X re-emite el evento `confirm-close`: uno solo a la vez. */
let closeAsking = false;
export async function onConfirmClose(count: number): Promise<void> {
	if (closeAsking) return;
	closeAsking = true;
	const choice = await confirmDialog<'stop-all' | 'leave-running' | null>(
		t('Cerrar Streamonte'),
		t('Hay {count} reproducción(es) activa(s). En los dos casos la descarga queda pausada y guardada para retomarla al volver a abrir la app.', { count }),
		[
			{ label: t('Cancelar'), value: null },
			{ label: t('Dejar el reproductor abierto'), value: 'leave-running' },
			{ label: t('Cerrar el reproductor y salir'), value: 'stop-all', primary: true }
		]
	);
	closeAsking = false;
	if (choice) {
		setStatus(t('Cerrando…'));
		await desktop.onClose(choice).catch(showError);
	}
}
