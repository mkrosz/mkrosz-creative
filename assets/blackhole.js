// =====================================================================
//  Buraco negro do hero — canvas 2D, sem bibliotecas.
//  Disco de acreção com órbitas keplerianas (mais rápido perto do centro),
//  anel de fótons, estrelas e rastro de movimento.
//  No tema claro vira um buraco branco: o centro brilha, com uma coroa azul,
//  tudo é expelido para fora em vez de cair e a luz dele acende nuvens de
//  gás em volta (a "nebulosa iluminada"). A troca entre os dois é gradual.
//  Pausa sozinho quando o hero sai da tela ou a aba fica oculta.
// =====================================================================
const TAU = Math.PI * 2;

import { isWhiteHole } from '../shared/gravity.js';
// Cores prontas das partículas e estrelas. Montar uma string hsla()/rgba() por
// partícula a cada quadro (milhares) pesa; aqui as cores ficam numa tabela por
// faixa de matiz, distância e opacidade, refeita só quando o tema muda.
const HUES = [199, 207, 215, 222], NEAR_N = 8, ALPHA_N = 12;
export function particlePalette(wk) {
  const out = [];
  for (const hue of HUES) {
    for (let n = 0; n < NEAR_N; n++) {
      const near = ((n + 0.5) / NEAR_N) * 0.8;
      for (let a = 1; a <= ALPHA_N; a++) out.push(`hsla(${hue}, ${Math.round(100 - wk * 30)}%, ${Math.round(55 + near * 40 + wk * 12)}%, ${(a / ALPHA_N).toFixed(3)})`);
    }
  }
  return out;
}
// índice na tabela: hi = faixa de matiz (0..3), near = 0..0.8, alpha = 0..1
export const paletteIndex = (hi, near, alpha) =>
  (hi * NEAR_N + Math.min(NEAR_N - 1, ((near / 0.8) * NEAR_N) | 0)) * ALPHA_N + Math.max(0, Math.min(ALPHA_N - 1, Math.round(alpha * ALPHA_N) - 1));
export const randomHue = () => (Math.random() * HUES.length) | 0;
const STAR_N = 16;
export const STAR_COLORS = Array.from({ length: STAR_N }, (_, i) => `rgba(200,225,255,${((i + 1) / STAR_N).toFixed(3)})`);
export const starColor = (a) => STAR_COLORS[Math.max(0, Math.min(STAR_N - 1, Math.round(a * STAR_N) - 1))];

// Nuvens da nebulosa: posição (× raio do buraco, a partir do centro), tamanho e cor
const CLOUDS = [
  [-1.6, -0.5, 4.2, '0,150,255', 0.28],
  [1.8, 1.7, 3.8, '255,150,110', 0.18],
  [-3.9, 2.2, 3.6, '60,90,255', 0.22],
  [2.6, -2.2, 3.1, '0,194,255', 0.18],
  [-6.2, -2.0, 2.9, '255,180,140', 0.1],
];

// white: função que diz se agora é buraco branco (padrão: tema claro)
export function createBlackHole(canvas, { reduced = false, white = isWhiteHole } = {}) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const small = innerWidth < 700;
  const COUNT = small ? 520 : 1100;
  const TILT = 0.26; // achatamento do disco (perspectiva)

  let w = 0, h = 0, dpr = 1, cx = 0, cy = 0, R = 40, wide = true;
  let mx = 0, my = 0, tmx = 0, tmy = 0; // mouse suavizado (-0.5..0.5)
  let progress = 0;                     // scroll do hero (0..1)
  let vortex = 0, vortexTarget = 0;     // sucção (0 = calmo, 1 = engolindo tudo)
  let shock = null;                     // onda de choque depois da explosão
  let grow = 1;
  let running = false, visible = true, raf = 0, last = 0;
  let stars = [];
  let halo = null, glow = null;
  let wk = white() ? 1 : 0;             // 0 = buraco negro, 1 = buraco branco
  let nebula = null; // nuvens pré-desenhadas (canvas fora da tela)
  // gradientes fixos (desenhados com o centro do buraco na origem), refeitos no resize
  let doppler = null, corona = null, shade = null;
  let palette = null, paletteKey = -1;
  const parts = Array.from({ length: COUNT }, () => ({}));

  function spawn(p, anywhere) {
    // Distribuição mais densa perto do horizonte. No buraco branco as
    // partículas nascem coladas no centro e são expelidas para fora.
    const t = anywhere ? Math.random() : wk > 0.5 ? Math.random() * 0.04 : 0.85 + Math.random() * 0.15;
    p.r = R * (1.35 + Math.pow(t, 1.6) * 5.2);
    p.a = Math.random() * TAU;
    p.size = Math.random() < 0.08 ? 2 : 1 + Math.random() * 0.6;
    p.drift = 0.35 + Math.random() * 0.9; // velocidade de queda
    p.hi = randomHue();                   // faixa de matiz: ciano → azul
  }

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, small ? 1.5 : 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Desktop: buraco à direita do texto. Celular: no alto, texto embaixo.
    wide = w >= 900;
    R = wide ? Math.min(w * 0.09, h * 0.15) : Math.min(w * 0.15, innerHeight * 0.085);
    stars = Array.from({ length: Math.round((w * h) / 5200) }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      s: Math.random() * 1.2 + 0.2,
      tw: Math.random() * TAU,
    }));
    halo = glow = doppler = corona = shade = null;
    parts.forEach((p) => spawn(p, true));
    nebula = null;
    ctx.fillStyle = '#01040c';
    ctx.fillRect(0, 0, w, h);
  }

  function drawStars(time) {
    const hr = R * grow;
    ctx.lineWidth = 1;
    for (const s of stars) {
      // Na sucção as estrelas são puxadas para o centro e esticam ("espaguetificação");
      // no buraco branco são empurradas para fora
      const pull = vortex * 0.3 * (1 - wk * 2);
      const x = s.x + (cx - s.x) * pull * (0.6 + s.s * 0.3);
      const y = s.y + (cy - s.y) * pull * (0.6 + s.s * 0.3);
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy < hr * hr * 2.2) continue; // engolidas pela sombra
      const a = 0.35 + Math.sin(time * 0.0012 + s.tw) * 0.3 + vortex * 0.4;
      if (a <= 0.03) continue;
      if (vortex > 0.04) {
        ctx.strokeStyle = starColor(a);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + dx * vortex * 0.035, y + dy * vortex * 0.035);
        ctx.stroke();
      } else {
        ctx.fillStyle = starColor(a);
        ctx.fillRect(x, y, s.s, s.s);
      }
    }
  }

  // Ondulação suave quando o buraco solta o que capturou
  function drawShock(dt) {
    if (!shock) return;
    shock.t += dt;
    const k = shock.t / 1.4;
    if (k >= 1) { shock = null; return; }
    const ease = 1 - Math.pow(1 - k, 3);
    const rr = R * grow * (1.1 + ease * 5);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(150,215,255,${0.35 * (1 - k)})`;
    ctx.lineWidth = R * 0.12 * (1 - k) + 0.5;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rr, rr * 0.3, 0, 0, TAU);
    ctx.stroke();
  }

  // Faixas elípticas finas formam o "corpo" luminoso do disco.
  function drawBand(from, to, gradient) {
    ctx.strokeStyle = gradient;
    for (let i = 0; i < 7; i++) {
      const rr = R * (1.45 + i * 0.42);
      ctx.globalAlpha = 0.22 * (1 - i / 7);
      ctx.lineWidth = R * (0.22 - i * 0.02);
      ctx.beginPath();
      ctx.ellipse(0, 0, rr, rr * TILT, 0, from, to);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawParticles(front, dt) {
    const pull = 1 + progress * 7 + vortex * 6;
    const spin = 1 + vortex * 2.5;
    const fall = 1 - wk * 2.6; // > 0 cai no buraco, < 0 é expelida
    // azul que clareia perto do centro (mais pálido no buraco branco)
    const key = Math.round(wk * 10);
    if (key !== paletteKey) { palette = particlePalette(key / 10); paletteKey = key; }
    for (const p of parts) {
      const sin = Math.sin(p.a);
      if ((sin >= 0) !== front) continue;
      const near = R / p.r;                          // 0..~0.75
      const lit = 0.55 + 0.45 * Math.cos(p.a);       // doppler: o lado que "vem" brilha mais
      ctx.fillStyle = palette[paletteIndex(p.hi, near, Math.min(1, near * 2.2 + 0.12) * lit)];
      ctx.fillRect(Math.cos(p.a) * p.r, sin * p.r * TILT, p.size, p.size);
      // Kepler: ω ∝ r^-1.5
      p.a += dt * 0.9 * spin * Math.pow(R / p.r, 1.5);
      p.r -= dt * p.drift * pull * R * 0.05 * (0.4 + near) * fall;
      // Depois da explosão: partículas arremessadas para fora, freando aos poucos
      if (p.vr) {
        p.r += p.vr * dt;
        p.vr *= Math.pow(0.06, dt);
        if (p.vr < 2) p.vr = 0;
      }
      if (p.r < R * 1.08 || p.r > R * 6.8) spawn(p, false);
    }
  }

  // Nebulosa: nuvens de gás em volta do buraco branco, acesas pela luz dele.
  // Pré-desenhadas uma vez (gradientes de tela cheia a cada quadro pesam) e
  // coladas a cada quadro, derivando devagar. O véu do rastro apaga 32% por
  // quadro, então a intensidade final fica ~1,7× a opacidade usada aqui.
  // A imagem tem uma margem (pad) além da tela: ela anda com o mouse e com a
  // deriva, e sem essa sobra a borda dela apareceria como um corte no céu.
  let pad = 0;
  function drawNebula(time) {
    if (!nebula) {
      pad = Math.ceil(R * 0.4 + (w + h) * 0.03);
      nebula = document.createElement('canvas');
      nebula.width = Math.round((w + pad * 2) / 2);
      nebula.height = Math.round((h + pad * 2) / 2);
      const n = nebula.getContext('2d');
      const hx = ((wide ? w * 0.7 : w / 2) + pad) / 2, hy = ((wide ? h * 0.48 : Math.min(h, innerHeight) * 0.21) + pad) / 2, r = R / 2;
      n.globalCompositeOperation = 'lighter';
      for (const [ox, oy, size, color, a] of CLOUDS) {
        const x = hx + ox * r, y = hy + oy * r, rr = size * r;
        const g = n.createRadialGradient(x, y, 0, x, y, rr);
        g.addColorStop(0, `rgba(${color},${a})`);
        g.addColorStop(1, `rgba(${color},0)`);
        n.fillStyle = g;
        n.fillRect(x - rr, y - rr, rr * 2, rr * 2);
      }
    }
    const drift = Math.sin(time * 0.00008) * R * 0.25;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55 * wk * (1 + vortex * 0.6);
    ctx.drawImage(nebula, drift + mx * w * 0.03 - pad, drift * 0.4 + my * h * 0.02 - pad, w + pad * 2, h + pad * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function frame(time) {
    const dt = Math.min(0.05, (time - (last || time)) / 1000) || 0.016;
    last = time;
    mx += (tmx - mx) * 0.05;
    my += (tmy - my) * 0.05;
    cx = (wide ? w * 0.7 : w / 2) + mx * w * 0.05;
    // No modo estreito o buraco ocupa o topo (o CSS reserva 40svh para ele)
    cy = (wide ? h * 0.48 : Math.min(h, innerHeight) * 0.21) + my * h * 0.04;
    // Sucção sobe devagar e volta rápido
    vortex += (vortexTarget - vortex) * (vortexTarget > vortex ? 0.04 : 0.09);
    // Troca de tema: o buraco negro vira branco (e volta) aos poucos
    wk += ((white() ? 1 : 0) - wk) * Math.min(1, dt * 2.5);
    // O buraco "cresce" conforme o scroll e durante a sucção
    grow = (1 + progress * 0.9) * (1 + vortex * 0.35);

    // Rastro: pinta um véu escuro translúcido em vez de limpar a tela
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(1,4,12,0.32)';
    ctx.fillRect(0, 0, w, h);
    if (wk > 0.01) drawNebula(time);
    drawStars(time);

    // daqui em diante o centro do buraco é a origem: os gradientes ficam prontos
    // (criados uma vez) e só o transform muda a cada quadro
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(grow, grow);

    // Halo azul de fundo
    if (!halo) {
      halo = ctx.createRadialGradient(0, 0, R * 0.9, 0, 0, R * 6);
      halo.addColorStop(0, 'rgba(47,123,255,0.35)');
      halo.addColorStop(0.35, 'rgba(0,140,255,0.10)');
      halo.addColorStop(1, 'rgba(0,0,0,0)');
    }
    ctx.globalCompositeOperation = 'lighter';
    if (!glow) {
      // buraco branco: névoa clara em volta do centro
      glow = ctx.createRadialGradient(0, 0, R * 0.6, 0, 0, R * 6);
      glow.addColorStop(0, 'rgba(220,238,255,0.2)');
      glow.addColorStop(0.3, 'rgba(140,200,255,0.06)');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
    }
    ctx.globalAlpha = 1 - wk;
    ctx.fillStyle = halo;
    ctx.fillRect(-R * 6, -R * 6, R * 12, R * 12);
    ctx.globalAlpha = wk;
    ctx.fillStyle = glow;
    ctx.fillRect(-R * 6, -R * 6, R * 12, R * 12);
    ctx.globalAlpha = 1;

    // Doppler: o lado esquerdo do disco vem em nossa direção e brilha mais
    if (!doppler) {
      doppler = ctx.createLinearGradient(-R * 6, 0, R * 6, 0);
      doppler.addColorStop(0, 'rgba(120,200,255,0)');
      doppler.addColorStop(0.3, 'rgba(190,235,255,0.9)');
      doppler.addColorStop(0.62, 'rgba(70,130,255,0.45)');
      doppler.addColorStop(1, 'rgba(40,80,255,0)');
    }

    // Metade de trás do disco: faixa de luz + partículas
    drawBand(Math.PI, TAU, doppler);
    drawParticles(false, dt);

    // Anel de fótons: luz do disco curvada em volta do horizonte
    ctx.strokeStyle = doppler;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = R * 0.32;
    ctx.beginPath();
    ctx.arc(0, 0, R * 1.12, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = R * 0.045;
    ctx.beginPath();
    ctx.arc(0, 0, R * 1.04, 0, TAU);
    ctx.stroke();

    // Horizonte de eventos: preto no buraco negro, branco no buraco branco
    ctx.globalCompositeOperation = 'source-over';
    if (wk > 0.01) {
      // coroa azul que pulsa em volta do núcleo
      ctx.globalCompositeOperation = 'lighter';
      if (!corona) {
        corona = ctx.createRadialGradient(0, 0, R * 0.95, 0, 0, R * 1.9);
        corona.addColorStop(0, 'rgba(0,194,255,0.55)');
        corona.addColorStop(0.35, 'rgba(47,123,255,0.18)');
        corona.addColorStop(1, 'rgba(47,123,255,0)');
      }
      const beat = 1 + Math.sin(time * 0.003) * 0.06 + vortex * 0.4; // a coroa pulsa
      ctx.save();
      ctx.scale(beat, beat);
      ctx.globalAlpha = wk;
      ctx.fillStyle = corona;
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.9, 0, TAU);
      ctx.fill();
      ctx.restore();
      ctx.globalCompositeOperation = 'source-over';
    }
    const v = Math.round(wk * 255);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.fill();
    if (wk > 0.01) {
      // um leve volume: branco puro no alto, azul bem claro na borda
      if (!shade) {
        shade = ctx.createRadialGradient(-R * 0.3, -R * 0.3, 0, 0, 0, R);
        shade.addColorStop(0, '#fff');
        shade.addColorStop(0.7, 'rgb(250,252,255)');
        shade.addColorStop(1, 'rgb(205,228,255)');
      }
      ctx.globalAlpha = wk;
      ctx.fillStyle = shade;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Metade da frente passa na frente do horizonte
    ctx.globalCompositeOperation = 'lighter';
    drawBand(0, Math.PI, doppler);
    drawParticles(true, dt);
    ctx.restore();
    drawShock(dt);

    if (running) raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running || reduced || !visible || document.hidden) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  // Movimento reduzido: redesenha o quadro estático quando o tema muda
  document.addEventListener('themechange', () => {
    if (!reduced) return;
    wk = white() ? 1 : 0;
    parts.forEach((p) => spawn(p, true));
    for (let i = 0; i < 40; i++) frame(i * 16);
  });

  resize();
  if (reduced) {
    // Movimento reduzido: um quadro estático já "assentado".
    for (let i = 0; i < 40; i++) frame(i * 16);
  } else {
    start();
  }

  let rt;
  addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { resize(); if (reduced) frame(0); }, 150);
  });
  new IntersectionObserver(([en]) => {
    visible = en.isIntersecting;
    visible ? start() : stop();
  }).observe(canvas);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

  return {
    setPointer(x, y) { tmx = x; tmy = y; },
    setProgress(p) { progress = p; },
    // Centro e raio atuais do buraco, em pixels relativos ao canvas
    getHole() { return { x: cx, y: cy, r: R * grow }; },
    // Captura: o disco acelera e brilha mais enquanto o hero está em órbita
    // (no buraco branco, o que sai dele sai mais rápido)
    capture() { vortexTarget = 0.5; },
    // Solta: uma ondulação suave sai do buraco e o disco "respira" para fora
    release() {
      vortexTarget = 0;
      shock = { t: 0 };
      parts.forEach((p) => { p.vr = R * (0.8 + Math.random() * 2.2); });
    },
  };
}
