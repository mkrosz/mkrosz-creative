// =====================================================================
//  Fundo do contato — o "tecido do espaço-tempo" — canvas 2D, sem bibliotecas.
//  Uma malha vista em perspectiva afunda num poço gravitacional (a parte
//  invisível do buraco negro); a malha flui na direção do poço e pequenas
//  estrelas descem em espiral até sumir no fundo. O poço segue o mouse.
//  No tema claro é o buraco branco: o mesmo poço, mas com um núcleo de luz
//  no fundo, e as estrelas sobem dele em espiral, para fora.
//  Pausa sozinho quando sai da tela ou a aba fica oculta.
// =====================================================================
const TAU = Math.PI * 2;

export function createSpacetime(canvas, { reduced = false } = {}) {
  const ctx = canvas.getContext('2d');
  const COLS = 34, ROWS = 22;       // pontos da malha
  const SIZE = 12, DEPTH = 14, NEAR = 1.5; // tamanho do plano (unidades do "mundo")
  const CAM = 5, FOCAL = 1.1;        // altura da câmera e lente
  const PITCH = 0.66, CP = Math.cos(PITCH), SP = Math.sin(PITCH); // câmera inclinada para baixo
  let w = 0, h = 0, dpr = 1;
  let wx = 3, wz = 8.5, twx = 3, twz = 8.5; // centro do poço (suavizado)
  let flow = 0;                       // a malha "escorre" para o poço
  let colors = {};
  let wk = -1;                        // 0 = buraco negro (escuro), 1 = buraco branco (claro)
  let running = false, visible = false, raf = 0, last = 0;
  const motes = Array.from({ length: innerWidth < 700 ? 40 : 80 }, () => spawn({}, true));

  // Profundidade do poço num ponto: funil suave (1/r) com fundo arredondado
  const well = (x, z) => Math.max(-4.2, -2.3 / Math.sqrt((x - wx) ** 2 + (z - wz) ** 2 + 0.06));

  // Mundo (x, y, z) → tela. O horizonte fica um pouco acima do meio.
  function project(x, y, z) {
    const dy = y - CAM;
    const zc = z * CP - dy * SP;      // distância ao longo do olhar
    const yc = dy * CP + z * SP;      // altura na tela
    const s = (FOCAL * h) / Math.max(zc, 0.1);
    return [w * 0.5 + x * s, h * 0.5 - yc * s];
  }

  function spawn(m, anywhere) {
    m.r = anywhere ? 0.4 + Math.random() * 4.6 : wk > 0.5 ? 0.15 + Math.random() * 0.3 : 4 + Math.random() * 1.5;
    m.a = Math.random() * TAU;
    m.s = 0.6 + Math.random() * 0.8;
    m.trail = [];
    return m;
  }

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    colors = {
      line: cs.getPropertyValue('--fg').trim() || '#e6efff',
      accent: cs.getPropertyValue('--accent').trim() || '#2f7bff',
      accent2: cs.getPropertyValue('--accent-2').trim() || '#00c2ff',
      dark: document.documentElement.dataset.theme !== 'light',
    };
  }

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Celular: o poço fica no centro; telas largas: à direita do texto
    twx = wx = w < 760 ? 0 : 3;
    readColors();
    if (!running) draw(0);
  }

  function draw(dt) {
    ctx.clearRect(0, 0, w, h);
    // troca de tema: o fundo do poço acende (e apaga) aos poucos
    const target = colors.dark ? 0 : 1;
    wk = wk < 0 || !dt ? target : wk + (target - wk) * Math.min(1, dt * 0.003);
    flow = (flow + dt * 0.00018) % 1;
    // o poço segue o cursor com um leve atraso (parece ter massa)
    wx += (twx - wx) * Math.min(1, dt * 0.006);
    wz += (twz - wz) * Math.min(1, dt * 0.006);

    // ---- malha ----
    // Cada trecho de linha vai para um "balde" conforme a força e a cor: as
    // paredes do poço brilham (em azul) e o resto fica discreto. Poucos
    // stroke() por quadro, mesmo com milhares de trechos.
    const BINS = 6;
    const buckets = [Array.from({ length: BINS }, () => new Path2D()), Array.from({ length: BINS }, () => new Path2D())];
    const base = colors.dark ? 0.16 : 0.13;
    const fade = (z) => Math.max(0, Math.min(1, (DEPTH + NEAR - z) / 5));
    // Cada ponto é projetado direto em variáveis (sem criar arrays por ponto:
    // são milhares por quadro) e ligado ao anterior da mesma linha.
    let px = 0, py = 0, pd = 0, pz = 0; // ponto anterior: tela (px, py), altura e profundidade
    const point = (x, z, first) => {
      const d = well(x, z);
      const dy = d - CAM, zc = z * CP - dy * SP, yc = dy * CP + z * SP;
      const s = (FOCAL * h) / Math.max(zc, 0.1);
      const sx = w * 0.5 + x * s, sy = h * 0.5 - yc * s;
      if (!first) {
        const k = Math.min(1, -(pd + d) / 2 / 3); // profundidade do trecho (0..1)
        const al = Math.min(1, base * fade((pz + z) / 2) * (1 + k * 4));
        const path = buckets[k > 0.22 ? 1 : 0][Math.min(BINS - 1, Math.floor(al / 0.6 * BINS))];
        path.moveTo(px, py);
        path.lineTo(sx, sy);
      }
      px = sx; py = sy; pd = d; pz = z;
    };
    const step = SIZE * 2 / (COLS - 1), zstep = DEPTH / (ROWS - 1);
    // linhas transversais: andam em direção à câmera, em loop
    for (let j = 0; j < ROWS; j++) {
      const z = NEAR + ((j + flow) % ROWS) * zstep;
      for (let i = 0; i <= 80; i++) point(-SIZE + (i / 80) * SIZE * 2, z, i === 0);
    }
    // linhas longitudinais (fixas)
    for (let i = 0; i < COLS; i++) {
      const x = -SIZE + i * step;
      for (let k = 0; k <= 60; k++) point(x, NEAR + (k / 60) * DEPTH, k === 0);
    }
    ctx.lineWidth = 1;
    buckets.forEach((bins, c) => {
      ctx.strokeStyle = c ? colors.accent2 : colors.line;
      bins.forEach((path, i) => { ctx.globalAlpha = ((i + 0.5) / BINS) * 0.6; ctx.stroke(path); });
    });

    // ---- o horizonte de eventos no fundo do poço ----
    const [gx, gy] = project(wx, well(wx, wz), wz);
    const gr = (FOCAL * h) / (wz * CP + CAM * SP) * 0.55;
    const g = ctx.createRadialGradient(gx, gy, gr * 0.3, gx, gy, gr * 2.2);
    g.addColorStop(0, colors.accent2);
    g.addColorStop(0.3, colors.accent);
    g.addColorStop(1, 'transparent');
    // no buraco branco o brilho em volta é mais forte: a luz sai do poço
    ctx.globalAlpha = (colors.dark ? 0.32 : 0.2) + wk * 0.25;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(gx, gy, gr * 2.2, gr * 1.1, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    // escuro: horizonte preto; claro: núcleo branco com coroa ciano
    const v = Math.round(wk * 255);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.beginPath();
    ctx.ellipse(gx, gy, gr * 0.42, gr * 0.21, 0, 0, TAU);
    ctx.fill();
    if (wk > 0.01) {
      ctx.globalAlpha = wk;
      ctx.strokeStyle = colors.accent2;
      ctx.lineWidth = 2;
      ctx.stroke();
      const core = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr * 0.42);
      core.addColorStop(0, '#fff');
      core.addColorStop(1, 'rgba(255,255,255,0.6)');
      ctx.fillStyle = core;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // ---- estrelas descendo em espiral ----
    ctx.globalAlpha = 1;
    for (const m of motes) {
      // órbita mais rápida perto do centro (Kepler) e queda lenta
      m.a += dt * 0.0011 * m.s / Math.pow(Math.max(m.r, 0.15), 1.5);
      m.r -= dt * 0.00012 * m.s * (1 + 0.6 / m.r) * (1 - wk * 2);
      if (m.r < 0.12 || m.r > 5.2) { spawn(m); continue; }
      const x = wx + Math.cos(m.a) * m.r;
      const z = wz + Math.sin(m.a) * m.r * 1.05;
      if (z < NEAR) { m.trail.length = 0; continue; }
      const [sx, sy] = project(x, well(x, z) + 0.02, z);
      m.trail.push(sx, sy);
      if (m.trail.length > 16) m.trail.splice(0, 2);
      const near = Math.max(0, 1 - m.r / 4.4); // mais perto = mais quente
      ctx.strokeStyle = near > 0.55 ? colors.accent2 : colors.accent;
      ctx.lineWidth = 1 + near * 1.5;
      ctx.globalAlpha = 0.25 + near * 0.6;
      ctx.beginPath();
      for (let k = 0; k < m.trail.length; k += 2) (k ? ctx.lineTo : ctx.moveTo).call(ctx, m.trail[k], m.trail[k + 1]);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function loop(t) {
    if (!running) return;
    const dt = Math.min(48, t - (last || t));
    last = t;
    draw(dt);
    raf = requestAnimationFrame(loop);
  }

  function setRunning(on) {
    if (on === running) return;
    running = on;
    if (on) { last = 0; raf = requestAnimationFrame(loop); }
    else cancelAnimationFrame(raf);
  }

  new IntersectionObserver(([en]) => {
    visible = en.isIntersecting;
    setRunning(visible && !reduced && !document.hidden);
  }).observe(canvas);
  document.addEventListener('visibilitychange', () => setRunning(visible && !reduced && !document.hidden));
  // troca de tema: relê as cores na hora (sem ficar consultando a cada quadro)
  document.addEventListener('themechange', () => { readColors(); if (!running) draw(0); });
  new ResizeObserver(resize).observe(canvas); // já chama resize() ao começar a observar

  return {
    // posição do mouse no contato (-0.5..0.5): o poço vai atrás dele
    // O buraco negro "olha" para o cursor: anda só um pouco na direção dele,
    // sem sair da área à direita (nunca vai para baixo do texto e do botão).
    // (sx, sy) em px do canvas; null = volta ao lugar.
    setPointer(sx, sy) {
      const rx = w < 760 ? 0 : 3, rz = 8.5;
      if (sx == null || w < 760) { twx = rx; twz = rz; return; }
      const H = CAM - well(wx, wz);                 // altura da câmera até o fundo
      const v = (h * 0.5 - sy) / (FOCAL * h);
      const den = SP - v * CP;
      const z = den > 0.02 ? (H * (CP + v * SP)) / den : NEAR + DEPTH;
      const x = ((sx - w * 0.5) * (z * CP + H * SP)) / (FOCAL * h);
      const LIMIT = 0.9;                            // quanto ele pode sair do lugar
      const clamp = (d) => Math.max(-LIMIT, Math.min(LIMIT, d * 0.25));
      twx = rx + clamp(x - rx);
      twz = rz + clamp(z - rz);
    },
  };
}
