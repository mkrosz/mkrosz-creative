// =====================================================================
//  Gravidade das letras (hero, contato e 404). No tema escuro o cursor é
//  um buraco negro e puxa as letras; no claro é um buraco branco e empurra.
// =====================================================================
export const isWhiteHole = () => document.documentElement.dataset.theme === 'light';

// (dx, dy) = do centro da letra até o cursor; f = 0..1 (1 = cursor em cima)
export function gravity(el, dx, dy, f, range, white = isWhiteHole()) {
  if (!f) {
    el.style.transform = '';
  } else if (white) {
    // empurra para longe do cursor: quanto mais perto, mais longe vai
    const d = Math.hypot(dx, dy) || 1;
    const push = f * f * 54;
    el.style.transform = `translate(${(-dx / d) * push}px, ${(-dy / d) * push}px) scale(${1 - f * 0.1}) rotate(${(-dx / range) * f * 14}deg)`;
  } else {
    const pull = f * f * 0.32; // fração da distância percorrida em direção ao cursor
    el.style.transform = `translate(${dx * pull}px, ${dy * pull}px) scale(${1 + f * 0.18}) rotate(${(dx / range) * f * 12}deg)`;
  }
  el.style.setProperty('--f', f.toFixed(3));
}
