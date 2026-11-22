// Efecto al escribir en toda la app (web y desktop): cada letra nueva entra desenfocada y sube un poco, como el apodo
// de la bienvenida. Un "espejo" encima de cada campo de texto dibuja el valor letra por letra; el texto real queda
// transparente (el cursor y la selección siguen siendo los del navegador). Se instala una vez por app y engancha
// solo los campos presentes y futuros. Afuera: contraseñas (mostraría lo oculto) y `data-typefx="off"`.

const TYPES = new Set(['text', 'search', 'url', 'email', 'tel', '']);
const COPY = ['font', 'letterSpacing', 'wordSpacing', 'textTransform', 'textAlign', 'textIndent', 'direction', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing'] as const;
const done = new WeakSet<HTMLInputElement>();

function attach(input: HTMLInputElement): void {
	const valueProp = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
	if (done.has(input) || !TYPES.has(input.getAttribute('type') ?? '') || input.dataset.typefx === 'off' || !valueProp?.get || !valueProp.set) return;
	done.add(input);
	const get = valueProp.get, set = valueProp.set;
	const mirror = document.createElement('span');
	mirror.className = 'typefx';
	mirror.setAttribute('aria-hidden', 'true');
	input.after(mirror);
	let shown = '';
	let color = '';

	const place = () => {
		const cs = getComputedStyle(input);
		for (const k of COPY) mirror.style[k] = cs[k];
		// El color se lee antes de volver transparente el texto real (después `cs.color` ya es transparente).
		if (!color) color = cs.color;
		mirror.style.color = color;
		mirror.style.left = `${input.offsetLeft}px`;
		mirror.style.top = `${input.offsetTop}px`;
		mirror.style.width = `${input.offsetWidth}px`;
		mirror.style.height = `${input.offsetHeight}px`;
		mirror.style.justifyContent = cs.textAlign === 'center' ? 'center' : cs.textAlign === 'right' || cs.textAlign === 'end' ? 'flex-end' : 'flex-start';
		// El texto real se vuelve transparente solo cuando el espejo ya copió su color.
		input.style.caretColor = cs.caretColor === 'auto' || cs.caretColor === 'rgba(0, 0, 0, 0)' ? color : cs.caretColor;
		input.style.color = 'transparent';
	};

	const render = (animate: boolean) => {
		const v = String(get.call(input));
		let start = 0;
		while (start < v.length && v[start] === shown[start]) start++;
		let end = 0;
		while (end < v.length - start && end < shown.length - start && v[v.length - 1 - end] === shown[shown.length - 1 - end]) end++;
		mirror.textContent = '';
		[...v].forEach((ch, n) => {
			const s = document.createElement('span');
			s.textContent = ch;
			if (animate && n >= start && n < v.length - end) s.className = 'in';
			mirror.append(s);
		});
		shown = v;
		mirror.scrollLeft = input.scrollLeft;
	};

	// Cambios por código (bind:value, limpiar el buscador) no disparan `input`: se dibujan sin animar.
	Object.defineProperty(input, 'value', { configurable: true, get: () => get.call(input), set: (v: string) => (set.call(input, v), render(false)) });
	input.addEventListener('input', () => render(true));
	input.addEventListener('scroll', () => (mirror.scrollLeft = input.scrollLeft));
	input.addEventListener('keyup', () => (mirror.scrollLeft = input.scrollLeft));
	new ResizeObserver(place).observe(input);
	place();
	render(false);
}

/** Engancha el efecto a los campos de texto de `root`, presentes y futuros. Devuelve cómo desinstalarlo. */
export function installTypeFx(root: ParentNode & Node = document.body): () => void {
	if (!document.getElementById('typefx-css')) {
		const css = document.createElement('style');
		css.id = 'typefx-css';
		css.textContent = `.typefx{position:absolute;display:flex;align-items:center;overflow:hidden;white-space:pre;pointer-events:none;border-style:solid;border-color:transparent;background:none;margin:0}
.typefx .in{display:inline-block;animation:typefx-in .35s cubic-bezier(.16,1,.3,1)}
@keyframes typefx-in{from{filter:blur(6px);transform:translateY(6px);opacity:0}}
@media (prefers-reduced-motion:reduce){.typefx .in{animation:none}}`;
		document.head.append(css);
	}
	const scan = (n: ParentNode) => n.querySelectorAll('input').forEach(attach);
	scan(root);
	const mo = new MutationObserver((list) => {
		for (const m of list) for (const n of m.addedNodes) if (n instanceof HTMLInputElement) attach(n); else if (n instanceof Element) scan(n);
	});
	mo.observe(root, { childList: true, subtree: true });
	return () => mo.disconnect();
}
