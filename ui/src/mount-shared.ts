// Monta componentes compartidos (packages/ui) desde los módulos JS que todavía dibujan con `el()`: les da el `Api` del desktop por contexto.
import { mount, unmount, type ComponentProps } from 'svelte';
import { apiContext } from '../../packages/ui/src/context.ts';
import MagnetView from '../../packages/ui/src/magnet/MagnetView.svelte';
import LangToggle from '../../packages/ui/src/components/LangToggle.svelte';
import SubsStep from './SubsStep.svelte';
import { langs, setLangs, t } from './i18n.ts';
import type { Api } from '../../packages/ui/src/api.ts';

let context: Map<unknown, unknown> | null = null;

/** `main.ts` fija el único `Api` del desktop antes de que el JS viejo monte nada compartido. */
export const provideApi = (api: Api): void => void (context = apiContext(api));

const missing = (): never => { throw new Error('Falta provideApi(): main.ts tiene que fijar el Api antes.'); };

/** ES / EN chico de la barra de arriba, antes de `before`. Cada cambio recarga la ventana en el idioma nuevo (no hace falta desmontarlo). */
export function mountLangToggle(before: HTMLElement): void {
	mount(LangToggle, { target: before.parentElement as HTMLElement, anchor: before, props: { id: 'top-lang', value: langs.app, label: t('Idioma'), height: 26, onpick: (v) => v !== langs.app && setLangs({ app: v }) } });
}

/** Paso "Subtítulos" de una opción en `target`; devuelve la función que lo desmonta. */
export function mountSubsStep(target: HTMLElement, props: ComponentProps<typeof SubsStep>): () => void {
	const inst = mount(SubsStep, { target, props, context: context ?? missing() });
	return () => void unmount(inst);
}

/** Vista del magnet pegado en `target`; devuelve la función que la desmonta. */
export function mountMagnet(target: HTMLElement, props: ComponentProps<typeof MagnetView>): () => void {
	const inst = mount(MagnetView, { target, props, context: context ?? missing() });
	return () => void unmount(inst);
}
