// =====================================================================
//  Página 404 (site e painel): buraco negro ao fundo, letras que entram
//  "escapando" dele e depois são puxadas pelo cursor, como no hero.
// =====================================================================
import { injectLogo } from './logo.js';
import { createBlackHole } from '../assets/blackhole.js';
import { gravity, isWhiteHole } from './gravity.js';
import { toggleTheme } from './theme.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

injectLogo();

// O mesmo 404 serve o site e o painel: em /admin/... só o título e os botões mudam
if (location.pathname.startsWith('/admin')) {
  document.title = 'Página não encontrada — Painel';
  document.querySelector('.nf__actions').innerHTML = `
    <a class="btn btn--primary" href="/admin/">Voltar ao painel</a>
    <a class="btn btn--ghost" href="/">Ver o portfólio</a>`;
}
// O tema vem do site (script no <head>) e pode ser trocado pelo botão:
// no claro é um buraco branco, que empurra as letras em vez de puxar.
const hole = createBlackHole(document.querySelector('.space'), { reduced });

// Quebra o texto em palavras (.w) e letras (.c), com atraso de entrada e giro.
let i = 0;
let chars = [], frame = 0, mx = 0, my = 0; // gravidade (mais abaixo)
function split(el, step) {
  const text = el.textContent.trim();
  el.setAttribute('aria-label', text);
  el.innerHTML = text.split(/(\s+)/).map((w) => (/^\s+$/.test(w) ? ' '
    : `<span class="w" aria-hidden="true">${[...w].map((ch) => `<span class="c" style="--d:${Math.round(80 + i++ * step)}ms;--r:${Math.round((Math.random() - 0.5) * 70)}deg">${ch}</span>`).join('')}</span>`)).join('');
}
const nf = document.querySelector('.nf');
// o "404": os dois "4" viram letras soltas; o gato fica no meio
$$('.nf__code .d, .nf__code .nf__cat').forEach((el) => {
  const style = `--d:${Math.round(i++ * 60)}ms;--r:${Math.round((Math.random() - 0.5) * 70)}deg`;
  // o gato entra e é puxado pelo cursor junto com as letras
  if (el.classList.contains('nf__cat')) { el.classList.add('c'); el.setAttribute('style', style); return; }
  el.outerHTML = `<span class="c" style="${style}">${el.textContent}</span>`;
});
// Texto de cada buraco: no negro a página caiu; no branco foi arremessada
const title = document.querySelector('.nf__title'), text = document.querySelector('.nf__text');
const COPY = {
  dark: [title.textContent.trim(), text.textContent.trim()],
  light: ['Essa página foi expelida por um buraco branco.', 'O endereço pode ter mudado ou nunca ter existido. Mas o resto continua aqui, a salvo.'],
};
const start = i; // as letras do texto vêm depois das do "404"
let settle = 0;
function writeCopy() {
  const [t, p] = COPY[isWhiteHole() ? 'light' : 'dark'];
  i = start;
  title.textContent = t;
  text.textContent = p;
  split(title, 24);
  split(text, 8);
  chars = [];
  clearTimeout(settle);
  settle = setTimeout(() => nf.classList.add('is-settled'), reduced ? 0 : 80 + i * 8 + 1200);
}
writeCopy();
requestAnimationFrame(() => document.body.classList.add('is-ready'));

// Trocar o tema: o buraco muda aos poucos e as letras "escapam" dele de novo
document.querySelector('#theme-toggle').addEventListener('click', () => {
  toggleTheme();
  nf.classList.remove('is-settled');
  $$('.c', nf).forEach((c) => { c.style.transform = ''; c.style.setProperty('--f', 0); });
  // some de uma vez (sem transição) e entra de novo com a animação normal
  nf.classList.add('is-reset');
  document.body.classList.remove('is-ready');
  writeCopy();
  void nf.offsetWidth;
  nf.classList.remove('is-reset');
  requestAnimationFrame(() => document.body.classList.add('is-ready'));
});

// Gravidade: as letras perto do cursor são puxadas até ele (ou empurradas).
const measure = () => {
  chars = $$('.c', nf).map((el) => {
    const r = el.getBoundingClientRect();
    return { el, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
};
const apply = () => {
  frame = 0;
  const RANGE = 260, white = isWhiteHole();
  chars.forEach((c) => {
    const dx = mx - c.x, dy = my - c.y;
    gravity(c.el, dx, dy, Math.max(0, 1 - Math.hypot(dx, dy) / RANGE), RANGE, white);
  });
};
addEventListener('resize', () => { chars = []; });
addEventListener('pointermove', (e) => {
  hole.setPointer(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5);
  if (reduced || e.pointerType !== 'mouse' || !nf.classList.contains('is-settled')) return;
  if (!chars.length) measure();
  mx = e.clientX; my = e.clientY;
  frame ||= requestAnimationFrame(apply);
});
document.addEventListener('pointerleave', () => {
  hole.setPointer(0, 0);
  chars.forEach((c) => { c.el.style.transform = ''; c.el.style.setProperty('--f', 0); });
});
