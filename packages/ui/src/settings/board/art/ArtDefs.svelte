<script lang="ts">
	// Sin props: solo dibujo.
</script>

<!-- Gradientes y brillo que comparten las ilustraciones del tablero (se referencian por url(#bd-…) desde css/board.css y los SVG). -->
<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
	<defs>
		<linearGradient id="bd-key-on" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bff7d2" /><stop offset="1" stop-color="#2fbf6a" /></linearGradient>
		<filter id="bd-glow" x="-60%" y="-40%" width="220%" height="180%"><feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b" /><feColorMatrix in="b" values="0 0 0 0 0.29  0 0 0 0 0.87  0 0 0 0 0.5  0 0 0 0.7 0" /><feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge></filter>
		<linearGradient id="bd-eq" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b7bf5" stop-opacity="0.45" /><stop offset="1" stop-color="#3b7bf5" stop-opacity="0" /></linearGradient>
		<linearGradient id="bd-liquid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8bbaff" /><stop offset="1" stop-color="#2563eb" /></linearGradient>
		<linearGradient id="bd-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2a4a" /><stop offset="1" stop-color="#2c3f66" /></linearGradient>
		<clipPath id="bd-can" clipPathUnits="userSpaceOnUse"><path d="M14 22 C14 12 66 12 66 22 V88 C66 98 14 98 14 88 Z" /></clipPath>
	</defs>
</svg>
