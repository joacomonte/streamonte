// Entrada de Vite: el JS viejo se carga igual que antes (efectos de módulo) y se monta una isla Svelte aparte.
import { mount } from 'svelte';

// El mock (solo sin Tauri) tiene que estar antes que app.js; los import estáticos se evalúan primero, por eso son dinámicos.
if (!('__TAURI__' in window)) await import('./mock-tauri');
// @ts-ignore: JS sin tipos de módulo; solo importa por sus efectos
await import('./app.js');
// @ts-ignore: ídem
await import('./catalog.js');
const { default: Island } = await import('./Island.svelte'); // mismo orden de evaluación que antes (evita ciclos)

const host = document.createElement('div');
host.id = 'svelte-root';
document.body.append(host);
mount(Island, { target: host });
