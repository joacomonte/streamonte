// Menú desplegable de la barra superior que todavía usa speed.js (Velocidad). El magnet copiado y Descargas ya son
// Svelte (components/CopiedMagnet.svelte, components/Downloads.svelte); se borra cuando speed.js migre.
import { dismiss } from '$ui/components/dismiss.ts';

const pop = document.createElement('div');
pop.id = 'top-pop';
pop.className = 'top-pop';
pop.setAttribute('role', 'dialog');
pop.hidden = true;
document.body.append(pop);
/** Menú abierto, o `null`. */
let open: { btn: HTMLElement; render: () => unknown } | null = null;

export function closePop(): void {
	if (!open) return;
	open.btn.setAttribute('aria-expanded', 'false');
	open.btn.classList.remove('active');
	open = null;
	pop.hidden = true;
	pop.replaceChildren();
}

/** Abre (o cierra, si ya estaba) el menú de `btn`; `render` llena `pop`. También lo usa `speed.js`. */
export async function togglePop(btn: HTMLElement, render: () => unknown): Promise<void> {
	if (open?.btn === btn) { closePop(); return; }
	closePop();
	open = { btn, render };
	btn.setAttribute('aria-expanded', 'true');
	btn.classList.add('active');
	pop.setAttribute('aria-label', (btn.textContent ?? '').trim());
	const r = btn.getBoundingClientRect();
	pop.style.top = `${r.bottom + 8}px`;
	pop.style.right = `${Math.max(12, window.innerWidth - r.right)}px`;
	pop.hidden = false;
	await render();
}

dismiss(pop, { onDismiss: closePop, active: () => !!open, ignore: (target) => !!open?.btn.contains(target), dialogGuard: true });
window.addEventListener('resize', closePop);

/** El elemento del menú abierto si es el de `btnId` (para redibujarlo), o null. */
export const popFor = (btnId: string): HTMLElement | null => (open?.btn.id === btnId ? pop : null);
