// @ts-check
// Fachada de los diálogos para el resto de la app (los componentes viven en components/, la lógica en dialog-flows.ts).
export { confirmDialog } from './confirm-queue.ts';
export { askAfterClose, cleanTemp, clearDataCache, onConfirmClose, openLog, stopAllAndClean } from './dialog-flows.ts';
import { host } from './ui-host.ts';

/** Abre Ajustes (carga lo guardado y muestra el diálogo). */
export const openSettings = () => host.openSettings?.() ?? Promise.resolve();
