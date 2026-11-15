// Tema claro/escuro + cores vindas do banco. Usado pelos dois sites.
const KEY = 'pf-theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

function stored() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function currentTheme() {
  return document.documentElement.dataset.theme || 'light';
}

export function setTheme(theme, persist = true) {
  document.documentElement.dataset.theme = theme;
  if (persist) try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  syncFavicon();
  document.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
}

// Ícone da aba do navegador: acompanha o tema. Com logos enviadas em Identidade,
// usa a do tema atual; sem elas, o gato padrão (favicon.svg / favicon-light.svg).
let faviconLogos = {};
export function setFaviconLogos(light, dark) {
  faviconLogos = { light, dark };
  syncFavicon();
}
function syncFavicon() {
  const link = document.querySelector('link[rel="icon"]');
  if (!link) return;
  link.dataset.base ||= link.getAttribute('href'); // o favicon.svg de cada página
  const dark = currentTheme() === 'dark';
  const { light: l, dark: d } = faviconLogos;
  const custom = /^https?:/i.test((dark ? d || l : l || d) || '') ? (dark ? d || l : l || d) : '';
  const href = custom || (dark ? link.dataset.base : link.dataset.base.replace(/favicon\.svg$/, 'favicon-light.svg'));
  if (link.getAttribute('href') === href) return;
  if (custom) link.removeAttribute('type'); else link.type = 'image/svg+xml';
  link.href = href;
}
syncFavicon(); // o script do <head> já aplicou o tema

export function toggleTheme() {
  setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

// Tema inicial: escolha do visitante > padrão do painel > sistema.
// Seguindo o sistema (sem escolha salva), acompanha quando o sistema muda.
let followSystem = false;
export function initTheme(defaultTheme = 'system') {
  followSystem = !stored() && defaultTheme === 'system';
  const pick = stored() || (defaultTheme === 'system' ? (media.matches ? 'dark' : 'light') : defaultTheme);
  if (pick !== currentTheme()) setTheme(pick, false); // o script do <head> já pode ter aplicado
}
media.addEventListener('change', (e) => {
  if (followSystem && !stored()) setTheme(e.matches ? 'dark' : 'light', false);
});

const HEX = /^#[0-9a-f]{3,8}$/i;
const color = (v, fallback) => (HEX.test(v || '') ? v : fallback);

// Aplica as cores salvas no painel como variáveis CSS.
export function applyColors(s = {}) {
  const root = document.documentElement.style;
  root.setProperty('--accent', color(s.color_accent, '#2f7bff'));
  root.setProperty('--accent-2', color(s.color_accent_2, '#00c2ff'));
  root.setProperty('--bg-light', color(s.color_bg_light, '#f3f7fd'));
  root.setProperty('--fg-light', color(s.color_fg_light, '#0a1a33'));
  root.setProperty('--bg-dark', color(s.color_bg_dark, '#030a18'));
  root.setProperty('--fg-dark', color(s.color_fg_dark, '#e6efff'));
}
