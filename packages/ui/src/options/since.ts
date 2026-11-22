// Acción: fija `prop` (`animation-delay` o una variable CSS) = `at` − ahora, en ms, al montar y cuando cambia `at`. Así una
// animación que empezó en `at` (epoch ms) sigue donde iba aunque el nodo se cree después, y no se reinicia si se redibuja.
export type Since = { prop: string; at: number };

export function since(node: HTMLElement, p: Since): { update(p: Since): void } {
	let at = Number.NaN;
	const set = (q: Since): void => {
		if (q.at === at) return;
		at = q.at;
		node.style.setProperty(q.prop, `${Math.round(q.at - Date.now())}ms`);
	};
	set(p);
	return { update: set };
}
