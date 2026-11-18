<script>
	/** @type {{name: keyof typeof PATHS, size?: number}} */
	let { name, size = 20 } = $props();
</script>

<script module>
	const PATHS = {
		search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4.3-4.3',
		back: 'M15 5l-7 7 7 7',
		gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm7.4 3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
		copy: 'M9 9h10v10H9zM5 15V5h10',
		check: 'M5 12.5l4.5 4.5L19 7.5',
		subs: 'M3 6h18v12H3zM7 14h4m3 0h3M7 10h2m3 0h5',
		download: 'M12 4v11m-5-5 5 5 5-5M5 20h14',
		close: 'M6 6l12 12M18 6 6 18',
		chev: 'M6 9l6 6 6-6',
		star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
		sliders: 'M4 7h9m4 0h3M4 17h3m4 0h9M15 5v4M9 15v4',
		monitor: 'M3 5h18v11H3zM8 20h8M12 16v4',
		flag: 'M5 21V4h11l-1.5 4L16 12H5',
		ban: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM5.6 5.6l12.8 12.8',
		'trend-up': 'M3 17l6-6 4 4 8-8M14 7h7v7',
		'trend-down': 'M3 7l6 6 4-4 8 8M14 17h7v-7',
		'trend-flat': 'M3 12h18M16 7l5 5-5 5',
		next: 'M9 5l7 7-7 7',
		lock: 'M7 10.5h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Zm1.5 0V8a3.5 3.5 0 0 1 7 0v2.5',
		help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-2.4 6.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.7m0 3h.01',
		link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'
	};
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
	<path d={PATHS[name]} />
</svg>
