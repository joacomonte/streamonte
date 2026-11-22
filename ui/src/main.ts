// Entrada de Vite: el JS viejo se carga igual que antes (efectos de módulo) y se monta una isla Svelte aparte.
import './app.js';
import './catalog.js';
import { mount } from 'svelte';
import Island from './Island.svelte';

const host = document.createElement('div');
host.id = 'svelte-root';
document.body.append(host);
mount(Island, { target: host });
