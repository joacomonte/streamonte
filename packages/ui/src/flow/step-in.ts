// Entrada de cada paso (la de la web): sube un poco y aparece; sin movimiento si el sistema lo pide.
const still = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const stepIn = (_: Element) => ({
	duration: still() ? 0 : 320,
	css: (x: number) => `transform: translateY(${(1 - x) * 10}px); opacity: ${x};`
});
