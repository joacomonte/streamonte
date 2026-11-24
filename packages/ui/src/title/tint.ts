// Fondo de la ficha teñido con el color predominante del póster (2026-11-24), igual en web y desktop: se lee una versión
// chica del póster en un canvas. La imagen legible la da `api.catalog.readableImage` (web: TMDB manda CORS; desktop: la
// baja el núcleo). Si no carga, no hay tinte y queda el fondo de siempre.

/** El color que más pesa entre los píxeles con color (fuera casi negros, casi blancos y grises), como `r g b`. */
export function dominant(px: Uint8ClampedArray): [number, number, number] | null {
	const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
	for (let i = 0; i < px.length; i += 4) {
		const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		if (max < 40 || min > 225 || max - min < 28) continue;
		const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
		const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
		// Pesa más lo saturado: el color que se recuerda del póster, no el del fondo apagado.
		const w = 1 + (max - min) / 64;
		bin.n += w;
		bin.r += r * w;
		bin.g += g * w;
		bin.b += b * w;
		bins.set(key, bin);
	}
	let best: { n: number; r: number; g: number; b: number } | null = null;
	for (const x of bins.values()) if (!best || x.n > best.n) best = x;
	return best ? [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)] : null;
}

/** El matiz de `rgb` con saturación y luz fijas: un póster oscuro o apagado tiñe igual de visible que uno vivo. */
export function tone([r, g, b]: [number, number, number]): [number, number, number] {
	const max = Math.max(r, g, b) / 255;
	const min = Math.min(r, g, b) / 255;
	const d = max - min;
	const raw = !d ? 0 : max === r / 255 ? ((g - b) / 255 / d) % 6 : max === g / 255 ? (b - r) / 255 / d + 2 : (r - g) / 255 / d + 4;
	const h = raw < 0 ? raw + 6 : raw;
	const [s, l] = [0.5, 0.3];
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs((h % 2) - 1));
	const [r1, g1, b1] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
	const m = l - c / 2;
	return [r1, g1, b1].map((v) => Math.round((v + m) * 255)) as [number, number, number];
}

/** La versión chica del póster (alcanza para el color y baja en un instante): TMDB 92 px, metahub `small`. */
export const smallPoster = (url: string) => url.replace(/\/t\/p\/w\d+\//, '/t/p/w92/').replace(/\/poster\/(medium|large)\//, '/poster/small/');

/** El tinte (`tone` del color predominante) de la imagen `url`, ya legible (null si no carga o no deja leer sus píxeles). */
export function posterTint(url: string): Promise<[number, number, number] | null> {
	return new Promise((resolve) => {
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => {
			try {
				const c = document.createElement('canvas');
				c.width = 24;
				c.height = 36;
				const ctx = c.getContext('2d', { willReadFrequently: true });
				if (!ctx) return resolve(null);
				ctx.drawImage(img, 0, 0, c.width, c.height);
				const rgb = dominant(ctx.getImageData(0, 0, c.width, c.height).data);
				resolve(rgb && tone(rgb));
			} catch {
				resolve(null);
			}
		};
		img.onerror = () => resolve(null);
		img.src = url;
	});
}
