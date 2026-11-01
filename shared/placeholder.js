// Artes geradas em SVG (sem baixar nada): aparecem no lugar das imagens
// enquanto as reais carregam — ou se alguma não carregar.

const XML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

export function art(label, a, b, variant = 0, w = 1600, h = 1100) {
  const shapes = [
    `<circle cx="${w * 0.7}" cy="${h * 0.38}" r="${h * 0.32}" fill="${b}" opacity=".9"/><circle cx="${w * 0.32}" cy="${h * 0.7}" r="${h * 0.2}" fill="#fff" opacity=".18"/>`,
    `<rect x="${w * 0.12}" y="${h * 0.16}" width="${w * 0.46}" height="${h * 0.6}" rx="40" fill="${b}" opacity=".85" transform="rotate(-8 ${w / 2} ${h / 2})"/><rect x="${w * 0.46}" y="${h * 0.3}" width="${w * 0.4}" height="${h * 0.5}" rx="40" fill="#fff" opacity=".2"/>`,
    `<path d="M0 ${h * 0.75} C ${w * 0.25} ${h * 0.45}, ${w * 0.55} ${h}, ${w} ${h * 0.55} L ${w} ${h} L 0 ${h} Z" fill="${b}" opacity=".9"/><circle cx="${w * 0.22}" cy="${h * 0.3}" r="${h * 0.12}" fill="#fff" opacity=".25"/>`,
    `<g fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="2">${Array.from({ length: 12 }, (_, i) => `<circle cx="${w / 2}" cy="${h / 2}" r="${40 + i * 38}"/>`).join('')}</g><circle cx="${w / 2}" cy="${h / 2}" r="${h * 0.18}" fill="${b}"/>`,
  ][variant % 4];
  const text = String(label).replace(/[&<>"]/g, (c) => XML[c]);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/>${shapes}<text x="${w * 0.06}" y="${h * 0.92}" font-family="Helvetica, Arial, sans-serif" font-size="${h * 0.085}" font-weight="700" fill="#fff" letter-spacing="-2">${text}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// Arte de espera de um item: o desenho e a cor saem do próprio item
// (mesmo item = mesma arte). Rótulos longos são encurtados.
const HEX = /^#[0-9a-f]{6}$/i;
export function placeholder(label = '', { color, seed = label, w = 1600, h = 1100 } = {}) {
  let n = 0;
  for (const ch of String(seed)) n = (n * 31 + ch.codePointAt(0)) >>> 0;
  const short = label.length > 24 ? `${label.slice(0, 22).trimEnd()}…` : label;
  return art(short, '#03152e', HEX.test(color || '') ? color : '#2f7bff', n % 4, w, h);
}
