// =====================================================================
//  Portal do projeto destaque — um buraco negro no estilo do hero
//  (disco de acreção, partículas em órbita, anel de fótons, halo e
//  estrelas) que cresce com a rolagem. O "horizonte" é o recorte CSS
//  (.portal): dentro dele aparece a imagem do projeto.
//  No tema claro é um buraco branco: o centro brilha, com uma coroa azul, as
//  partículas são expelidas e a imagem nasce de dentro da luz. A nebulosa em
//  volta é o fundo da seção (CSS).
//  Só desenha enquanto a seção está na tela e o disco ainda é visível.
// =====================================================================
import { particlePalette, paletteIndex, randomHue, starColor } from './blackhole.js';

const TAU = Math.PI * 2;
const TILT = 0.26; // achatamento do disco (perspectiva), igual ao do hero
import { isWhiteHole as lightTheme } from '../shared/gravity.js';

// Raio do portal em px para um progresso k (0..1). O CSS usa a mesma conta:
// circle(calc(var(--e) * 75vmax + 26px)), com --e = k².
export const portalRadius = (k) => k * k * 0.75 * Math.max(innerWidth, innerHeight) + 26;

export function createPortal(canvas, getK, { reduced = false } = {}) {
  const ctx = canvas.getContext('2d');
  const small = innerWidth < 700;
  const parts = Array.from({ length: small ? 260 : 520 }, () => ({}));
  let w = 0, h = 0, dpr = 1, stars = [], running = false, visible = false, raf = 0, last = 0;
  let wk = lightTheme() ? 1 : 0; // 0 = buraco negro, 1 = buraco branco
  let fade = 1;                  // o disco some antes do portal cobrir a tela
  // gradientes e cores prontos: refeitos só quando o raio ou o tema mudam
  let halo = null, doppler = null, gradR = -1;
  let palette = null, paletteKey = -1;

  function spawn(p, anywhere) {
    // no buraco branco as partículas nascem coladas no horizonte e saem
    const t = anywhere ? Math.random() : wk > 0.5 ? Math.random() * 0.04 : 0.85 + Math.random() * 0.15;
    p.rf = 1.35 + Math.pow(t, 1.6) * 4.2;      // raio da órbita (× raio do buraco)
    p.a = Math.random() * TAU;
    p.size = Math.random() < 0.08 ? 2 : 1 + Math.random() * 0.6;
    p.drift = 0.35 + Math.random() * 0.9;
    p.hi = randomHue();                        // faixa de matiz: ciano → azul
  }

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, small ? 1.5 : 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    gradR = -1; // o centro mudou: refaz os gradientes
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    stars = Array.from({ length: Math.round((w * h) / 6000) }, () => ({ x: Math.random() * w, y: Math.random() * h, s: Math.random() * 1.2 + 0.2, tw: Math.random() * TAU }));
    parts.forEach((p) => spawn(p, true));
    if (!running) draw(0, 0);
  }

  // Faixas elípticas finas: o "corpo" luminoso do disco
  function band(cx, cy, R, from, to, grad) {
    ctx.strokeStyle = grad;
    for (let i = 0; i < 7; i++) {
      const rr = R * (1.45 + i * 0.42);
      ctx.globalAlpha = 0.22 * (1 - i / 7) * fade;
      ctx.lineWidth = R * (0.22 - i * 0.02);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rr, rr * TILT, 0, from, to);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function particles(cx, cy, R, front, dt) {
    const fall = 1 - wk * 2.6; // > 0 cai no buraco, < 0 é expelida
    const key = Math.round(wk * 10);
    if (key !== paletteKey) { palette = particlePalette(key / 10); paletteKey = key; }
    const s = Math.min(2.2, Math.max(1, R / 110)); // crescem um pouco com o buraco
    for (const p of parts) {
      const sin = Math.sin(p.a);
      if ((sin >= 0) !== front) continue;
      const r = p.rf * R;
      const x = cx + Math.cos(p.a) * r;
      const y = cy + sin * r * TILT;
      const near = 1 / p.rf;
      const lit = 0.55 + 0.45 * Math.cos(p.a);      // doppler: o lado que "vem" brilha mais
      ctx.fillStyle = palette[paletteIndex(p.hi, near, Math.min(1, near * 2.2 + 0.12) * lit * fade)];
      ctx.fillRect(x, y, p.size * s, p.size * s);
      p.a += dt * 0.9 * Math.pow(1 / p.rf, 1.5);    // Kepler: mais rápido perto do centro
      p.rf -= dt * p.drift * 0.05 * (0.4 + near) * fall; // vão caindo no buraco (ou saindo dele)
      if (p.rf < 1.08 || p.rf > 5.8) spawn(p, false);
    }
  }

  function draw(dt, time) {
    const k = getK();
    const R = portalRadius(k);
    fade = Math.min(1, Math.max(0, (0.8 - k) / 0.45)); // some antes de cobrir a tela
    const cx = w / 2, cy = h / 2;
    // troca de tema: o buraco vira branco (e volta) aos poucos
    const target = lightTheme() ? 1 : 0;
    wk = dt ? wk + (target - wk) * Math.min(1, dt * 2.5) : target;
    ctx.clearRect(0, 0, w, h);
    if (fade <= 0) return;

    // estrelas (as que caem dentro do portal somem)
    for (const s of stars) {
      const dx = s.x - cx, dy = s.y - cy;
      if (dx * dx + dy * dy < R * R * 2.2) continue;
      ctx.fillStyle = starColor((0.35 + Math.sin(time * 0.0012 + s.tw) * 0.3) * fade);
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }

    ctx.globalCompositeOperation = 'lighter';
    // halo azul e doppler: o raio só muda com a rolagem, então ficam prontos
    if (Math.abs(R - gradR) > 0.5) {
      gradR = R;
      halo = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 6);
      halo.addColorStop(0, 'rgba(47,123,255,0.35)');
      halo.addColorStop(0.35, 'rgba(0,140,255,0.1)');
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      doppler = ctx.createLinearGradient(cx - R * 6, 0, cx + R * 6, 0);
      doppler.addColorStop(0, 'rgba(120,200,255,0)');
      doppler.addColorStop(0.3, 'rgba(190,235,255,0.9)');
      doppler.addColorStop(0.62, 'rgba(70,130,255,0.45)');
      doppler.addColorStop(1, 'rgba(40,80,255,0)');
    }
    ctx.globalAlpha = fade;
    ctx.fillStyle = halo;
    ctx.fillRect(cx - R * 6, cy - R * 6, R * 12, R * 12);
    ctx.globalAlpha = 1;

    // metade de trás do disco…
    band(cx, cy, R, Math.PI, TAU, doppler);
    particles(cx, cy, R, false, dt);
    // …escondida atrás do horizonte (o portal)
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';

    // anel de fótons: luz curvada em volta do horizonte
    ctx.strokeStyle = doppler;
    ctx.globalAlpha = 0.25 * fade;
    ctx.lineWidth = R * 0.32;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.12, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = fade;
    ctx.lineWidth = Math.max(1.5, R * 0.045);
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.04, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // buraco branco: coroa azul que pulsa em volta da luz do centro
    if (wk > 0.01) {
      const beat = 1 + Math.sin(time * 0.003) * 0.05;
      const spill = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * (1.5 * beat) + 14);
      spill.addColorStop(0, `rgba(0,194,255,${0.55 * wk * fade})`);
      spill.addColorStop(0.35, `rgba(47,123,255,${0.18 * wk * fade})`);
      spill.addColorStop(1, 'rgba(47,123,255,0)');
      ctx.fillStyle = spill;
      ctx.beginPath();
      ctx.arc(cx, cy, R * (1.5 * beat) + 14, 0, TAU);
      ctx.arc(cx, cy, R, 0, TAU, true);
      ctx.fill();
    }

    // metade da frente passa por cima do portal
    band(cx, cy, R, 0, Math.PI, doppler);
    particles(cx, cy, R, true, dt);
    ctx.globalCompositeOperation = 'source-over';
  }

  function frame(time) {
    if (!running) return;
    const dt = Math.min(0.05, (time - (last || time)) / 1000) || 0.016;
    last = time;
    draw(dt, time);
    raf = requestAnimationFrame(frame);
  }
  const setRunning = (on) => {
    if (on === running) return;
    running = on;
    if (on) { last = 0; raf = requestAnimationFrame(frame); }
    else cancelAnimationFrame(raf);
  };
  const update = () => setRunning(visible && !reduced && !document.hidden && getK() < 0.8);

  new IntersectionObserver(([en]) => { visible = en.isIntersecting; update(); }).observe(canvas);
  document.addEventListener('visibilitychange', update);
  document.addEventListener('themechange', () => { if (!running) draw(0, 0); });
  new ResizeObserver(resize).observe(canvas); // já chama resize() ao começar a observar

  // chamado a cada atualização da rolagem: retoma o desenho se o disco voltou a aparecer
  return { update: () => { update(); if (!running) draw(0, 0); } };
}
