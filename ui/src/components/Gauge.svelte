<!-- Medidor con aguja (escala logarítmica de 1 a 1000 Mbps). -->
<script lang="ts">
  import { gaugeArc } from '../speed-model.ts';

  let { v, size = 22 }: { v: number; size?: number } = $props();
  const g = $derived(gaugeArc(v));
</script>

<svg class="speed-gauge" viewBox="0 0 22 13" width={size} height={Math.round((size * 13) / 22)} aria-hidden="true">
  <path class="track" d="M3 11a8 8 0 0 1 16 0" />
  <path class="fill" d="M3 11a8 8 0 0 1 16 0" stroke-dasharray="{g.fill} {g.len}" />
  <line class="needle" x1="11" y1="11" x2="11" y2="4.5" style="transform: rotate({g.angle}deg)" />
  <circle class="hub" cx="11" cy="11" r="1.4" />
</svg>
