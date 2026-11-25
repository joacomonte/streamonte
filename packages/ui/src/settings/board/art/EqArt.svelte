<script lang="ts">
	// Curva del ecualizador de mpv sobre barras de nivel: cambia con el tipo (cine/voices/flat) y la intensidad (0–150).
	let { eq, intensity }: { eq: string; intensity: number } = $props();

	const f1 = (n: number) => Math.round(n * 10) / 10;
	const bump = (x: number, c: number, w: number, a: number) => a * Math.exp(-((x - c) ** 2) / (2 * w * w));
	const gain = (x: number) =>
		eq === 'cine' ? bump(x, 0.1, 0.09, 1) + bump(x, 0.55, 0.12, 0.45) + bump(x, 0.92, 0.08, 0.25)
		: eq === 'voices' ? bump(x, 0.05, 0.06, -0.35) + bump(x, 0.5, 0.13, 1)
		: 0;

	/** Spline por 25 puntos (Catmull-Rom a Bézier). */
	const line = $derived.by(() => {
		const k = (40 * intensity) / 100;
		const pts = Array.from({ length: 25 }, (_, i) => [i * 12.5, 62 - gain(i / 24) * k]);
		let d = `M${pts[0][0]} ${f1(pts[0][1])}`;
		for (let i = 0; i < pts.length - 1; i++) {
			const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
			d += ` C${f1(p1[0] + (p2[0] - p0[0]) / 6)} ${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)} ${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])} ${f1(p2[1])}`;
		}
		return d;
	});
	const bars = Array.from({ length: 20 }, (_, i) => ({ x: 4 + i * 14.8, delay: f1((i * 0.53) % 1.4) }));
</script>

<svg class="art art-eq" class:flat={eq === 'flat'} viewBox="0 0 300 110" preserveAspectRatio="none" aria-hidden="true">
	{#each bars as b (b.x)}<rect class="bar" x={b.x} y="22" width="8" height="88" rx="3" style:animation-delay="-{b.delay}s" />{/each}
	<line class="zero" x1="0" y1="62" x2="300" y2="62" />
	<!-- Atributo `d` para WebKit (Tauri en macOS no soporta la propiedad CSS `d`); el estilo anima el cambio en Chromium. -->
	<path class="eq-fill" d="{line} L300 110 L0 110 Z" style:d={`path("${line} L300 110 L0 110 Z")`} />
	<path class="eq-line" d={line} style:d={`path("${line}")`} />
</svg>
