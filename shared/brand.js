// =====================================================================
//  Logos da marca (Identidade no painel) fora do site: login do painel e 404.
//  As imagens vêm do cache do site (o mesmo do portfólio, aparece na hora);
//  sem cache, busca uma vez no banco. Também ajusta o ícone da aba.
// =====================================================================
import { readCache, fetchPortfolio, safeUrl, escapeHtml as esc } from './api.js';
import { setFaviconLogos } from './theme.js';

const logosOf = (s = {}) => ({ light: s.logo_url || '', dark: s.logo_dark_url || s.logo_url || '' });

// as duas versões; o CSS mostra a do tema atual (.is-light / .is-dark)
export const logoImgs = ({ light, dark }, cls = '') =>
  `<img class="${cls} is-light" src="${esc(safeUrl(light || dark))}" alt="" decoding="async">`
  + `<img class="${cls} is-dark" src="${esc(safeUrl(dark || light))}" alt="" decoding="async">`;

// apply({ light, dark }) troca o gato padrão pela logo; sem logo, não faz nada
export function useBrandLogos(apply) {
  let shown = '';
  const use = (s) => {
    const logos = logosOf(s);
    setFaviconLogos(logos.light, logos.dark);
    const key = `${logos.light}|${logos.dark}`;
    if ((logos.light || logos.dark) && key !== shown) { shown = key; apply(logos); }
  };
  const cached = readCache()?.settings;
  if (cached) use(cached);
  else fetchPortfolio().then((d) => use(d?.settings)).catch(() => {}); // sem banco: fica o gato padrão
}
