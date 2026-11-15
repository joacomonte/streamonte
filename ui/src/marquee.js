// Textos largos de las filas: título cortado → tooltip con el texto entero; nombre crudo largo →
// marquesina al pasar por la fila (con movimiento reducido, tooltip con el nombre entero).
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function markOverflow() {
  requestAnimationFrame(() => {
    document.querySelectorAll('.row .tn').forEach((n) => {
      if (n.scrollWidth > n.clientWidth + 1) { n.dataset.tip = n.textContent; n.tabIndex = 0; } else { delete n.dataset.tip; n.removeAttribute('tabindex'); }
    });
    document.querySelectorAll('.row .raw').forEach((n) => {
      const ov = n.firstElementChild.scrollWidth > n.clientWidth + 1;
      n.classList.toggle('ov', ov);
      if (ov && reduceMotion) { n.dataset.tip = `Nombre del torrent: ${n.textContent}`; n.tabIndex = 0; } else { delete n.dataset.tip; n.removeAttribute('tabindex'); }
    });
  });
}
window.addEventListener('resize', markOverflow);

const MQ = new Map();
const MQ_PX_S = 32;
export function mqStart(row) {
  const raw = row.querySelector('.raw');
  const t = raw?.firstElementChild;
  if (!t || reduceMotion || MQ.has(row)) return;
  const d = t.scrollWidth - raw.clientWidth;
  if (d <= 1) return;
  const st = {};
  const dur = Math.max(1.5, d / MQ_PX_S);
  MQ.set(row, st);
  const go = (x, next) => {
    t.style.transition = `transform ${dur}s linear`;
    t.style.transform = `translateX(${x}px)`;
    raw.classList.toggle('end', x !== 0);
    st.t = setTimeout(next, dur * 1000 + 1400);
  };
  const fwd = () => go(-d, back);
  const back = () => go(0, fwd);
  st.t = setTimeout(fwd, 700);
}
export function mqStop(row) {
  const st = MQ.get(row);
  if (!st) return;
  clearTimeout(st.t);
  MQ.delete(row);
  const raw = row.querySelector('.raw');
  const t = raw.firstElementChild;
  t.style.transition = 'transform .5s var(--out)';
  t.style.transform = '';
  raw.classList.remove('end');
}
