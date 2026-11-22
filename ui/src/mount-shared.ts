// Monta componentes compartidos (packages/ui) desde los módulos JS que todavía dibujan con `el()`: les da el `Api` del desktop por contexto.
import { mount, unmount, type ComponentProps } from 'svelte';
import { apiContext } from '../../packages/ui/src/context.ts';
import MagnetView from '../../packages/ui/src/magnet/MagnetView.svelte';
import { langs } from './i18n.js';
import SubsStep from './SubsStep.svelte';
import { createDesktopApi } from './tauriApi.ts';

const context = apiContext(await createDesktopApi(() => langs.titles));

/** Paso "Subtítulos" de una opción en `target`; devuelve la función que lo desmonta. */
export function mountSubsStep(target: HTMLElement, props: ComponentProps<typeof SubsStep>): () => void {
	const inst = mount(SubsStep, { target, props, context });
	return () => void unmount(inst);
}

/** Vista del magnet pegado en `target`; devuelve la función que la desmonta. */
export function mountMagnet(target: HTMLElement, props: ComponentProps<typeof MagnetView>): () => void {
	const inst = mount(MagnetView, { target, props, context });
	return () => void unmount(inst);
}
