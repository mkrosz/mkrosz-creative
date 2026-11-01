// =====================================================================
//  Easter eggs — só é baixado quando alguém descobre um deles.
//
//  1. Nave escondida: clicar 7 vezes no buraco negro faz uma navezinha
//     sair dele. Pilote com as setas/WASD ou deixe ela seguir o mouse e
//     colete as 10 estrelas espalhadas pela tela. Esc sai.
//  2. Hiperespaço: digitar "warp" em qualquer lugar do site — as estrelas
//     viram riscos de luz, a tela treme e a página voa até o rodapé.
// =====================================================================
const TAU = Math.PI * 2;

function toast(text, ms = 2800) {
  document.querySelectorAll('.egg-toast').forEach((old) => old.remove());
  const el = document.createElement('div');
  el.className = 'egg-toast';
  el.textContent = text;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  setTimeout(() => {
    el.classList.remove('is-in');
    setTimeout(() => el.remove(), 400);
  }, ms);
}

function fullCanvas(cls) {
  const cv = document.createElement('canvas');
  cv.className = cls;
  cv.setAttribute('aria-hidden', 'true');
  document.body.append(cv);
  const ctx = cv.getContext('2d');
  const size = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = innerWidth * dpr;
    cv.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  size();
  addEventListener('resize', size);
  return { cv, ctx, dispose: () => { removeEventListener('resize', size); cv.remove(); } };
}

// Só um easter egg ativo por vez: ao ativar um, o que estiver rodando é desfeito.
function stopOthers(except) {
  if (except !== 'ship') ship?.end();
  if (except !== 'warp') warpStop?.();
  if (except !== 'zerog') zeroG?.end();
}

// ---------------------------------------------------------------------
//  1. Nave escondida
// ---------------------------------------------------------------------
let ship = null;

export function launchShip({ from } = {}) {
  if (ship) return;
  stopOthers('ship');
  const { ctx, dispose } = fullCanvas('egg-canvas');
  const hud = document.createElement('div');
  hud.className = 'egg-hud';
  hud.setAttribute('role', 'status');
  document.body.append(hud);

  const TOTAL = 10;
  const W = () => innerWidth, H = () => innerHeight;
  const s = {
    x: from?.x ?? W() / 2, y: from?.y ?? H() / 2, vx: 0, vy: -3, a: -Math.PI / 2,
    thrust: false, keys: new Set(), lastKey: 0, mx: null, my: null,
  };
  const stars = Array.from({ length: TOTAL }, () => ({
    x: 60 + Math.random() * (W() - 120),
    y: 70 + Math.random() * (H() - 190), // longe da dock
    tw: Math.random() * TAU,
    got: false,
  }));
  const bits = []; // rastro e explosões
  let score = 0, done = false, last = 0, raf = 0;

  const setHud = () => {
    hud.innerHTML = done
      ? '🌌 Universo explorado! Você achou todas as estrelas.'
      : `<b>★ ${score}/${TOTAL}</b><span>setas ou mouse para pilotar · Esc sai</span>`;
  };
  setHud();
  toast('🚀 Uma nave escapou do buraco negro!');

  const burst = (x, y, n, hueA = 190, hueB = 230, speed = 5) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, v = Math.random() * speed;
      bits.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, size: 1 + Math.random() * 3, hue: hueA + Math.random() * (hueB - hueA) });
    }
  };

  const onKey = (e) => {
    const k = e.key.toLowerCase();
    if (k === 'escape') { end(); return; }
    const map = { arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right' };
    if (!map[k] || /input|textarea/i.test(e.target.tagName)) return;
    e.preventDefault(); // as setas pilotam a nave em vez de rolar a página
    if (e.type === 'keydown') { s.keys.add(map[k]); s.lastKey = performance.now(); } else s.keys.delete(map[k]);
  };
  const onMove = (e) => {
    const p = e.touches ? e.touches[0] : e;
    s.mx = p.clientX;
    s.my = p.clientY;
  };
  addEventListener('keydown', onKey);
  addEventListener('keyup', onKey);
  addEventListener('pointermove', onMove, { passive: true });
  addEventListener('touchmove', onMove, { passive: true });

  function drawShip() {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.a + Math.PI / 2);
    // chama do motor
    if (s.thrust) {
      const f = 10 + Math.random() * 10;
      const g = ctx.createLinearGradient(0, 10, 0, 10 + f);
      g.addColorStop(0, 'rgba(0,194,255,0.95)');
      g.addColorStop(1, 'rgba(47,123,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-5, 9); ctx.lineTo(0, 10 + f); ctx.lineTo(5, 9);
      ctx.fill();
    }
    // corpo
    const body = ctx.createLinearGradient(-10, 0, 10, 0);
    body.addColorStop(0, '#9fc4ff');
    body.addColorStop(1, '#2f7bff');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(0, -16); ctx.lineTo(11, 11); ctx.lineTo(0, 6); ctx.lineTo(-11, 11);
    ctx.closePath();
    ctx.fill();
    // cabine
    ctx.fillStyle = '#e8f6ff';
    ctx.beginPath();
    ctx.ellipse(0, -3, 2.6, 4.5, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawStar(st, t) {
    const r = 7 + Math.sin(t * 0.004 + st.tw) * 1.6;
    ctx.save();
    ctx.translate(st.x, st.y);
    ctx.rotate(t * 0.0008 + st.tw);
    ctx.shadowColor = 'rgba(0,194,255,0.9)';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#fff6c2';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? r * 0.45 : r;
      const a = (i / 10) * TAU - Math.PI / 2;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function frame(t) {
    const dt = Math.min(2, (t - (last || t)) / 16.67); // 1 = um quadro a 60fps
    last = t;
    const usingKeys = s.keys.size > 0 || t - s.lastKey < 1200;

    if (usingKeys) {
      if (s.keys.has('left')) s.a -= 0.075 * dt;
      if (s.keys.has('right')) s.a += 0.075 * dt;
      s.thrust = s.keys.has('up');
      if (s.thrust) { s.vx += Math.cos(s.a) * 0.32 * dt; s.vy += Math.sin(s.a) * 0.32 * dt; }
      if (s.keys.has('down')) { s.vx *= 0.92; s.vy *= 0.92; }
    } else if (s.mx !== null) {
      // Segue o mouse: vira para ele e acelera mais quanto mais longe estiver
      const dx = s.mx - s.x, dy = s.my - s.y;
      const d = Math.hypot(dx, dy);
      const target = Math.atan2(dy, dx);
      let diff = target - s.a;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      s.a += diff * 0.12 * dt;
      s.thrust = d > 40;
      if (s.thrust) { const k = Math.min(0.45, d / 600); s.vx += Math.cos(s.a) * k * dt; s.vy += Math.sin(s.a) * k * dt; }
    }
    s.vx *= Math.pow(0.975, dt);
    s.vy *= Math.pow(0.975, dt);
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    // Sai por um lado, entra pelo outro
    if (s.x < -20) s.x = W() + 20; if (s.x > W() + 20) s.x = -20;
    if (s.y < -20) s.y = H() + 20; if (s.y > H() + 20) s.y = -20;

    if (s.thrust) {
      bits.push({ x: s.x - Math.cos(s.a) * 12, y: s.y - Math.sin(s.a) * 12, vx: -s.vx * 0.2 + (Math.random() - 0.5), vy: -s.vy * 0.2 + (Math.random() - 0.5), life: 1, size: 2 + Math.random() * 2, hue: 195 + Math.random() * 25 });
    }

    // Coleta
    stars.forEach((st) => {
      if (st.got || Math.hypot(st.x - s.x, st.y - s.y) > 26) return;
      st.got = true;
      score++;
      burst(st.x, st.y, 26, 40, 60, 4);
      if (score === TOTAL) {
        done = true;
        for (let i = 0; i < 6; i++) setTimeout(() => burst(Math.random() * W(), Math.random() * H() * 0.7, 40, 180, 330, 7), i * 180);
        setTimeout(end, 4200);
      }
      setHud();
    });

    ctx.clearRect(0, 0, W(), H());
    stars.forEach((st) => { if (!st.got) drawStar(st, t); });
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.vx *= 0.96; b.vy *= 0.96;
      b.life -= 0.022 * dt;
      if (b.life <= 0) { bits.splice(i, 1); continue; }
      ctx.fillStyle = `hsla(${b.hue}, 100%, 70%, ${b.life})`;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.size * b.life, 0, TAU);
      ctx.fill();
    }
    drawShip();
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  function end() {
    if (!ship) return;
    cancelAnimationFrame(raf);
    removeEventListener('keydown', onKey);
    removeEventListener('keyup', onKey);
    removeEventListener('pointermove', onMove);
    removeEventListener('touchmove', onMove);
    dispose();
    hud.remove();
    ship = null;
    if (!done) toast('A nave voltou para o buraco negro. 🕳️');
  }
  ship = { end };
}

// ---------------------------------------------------------------------
//  2. Hiperespaço
// ---------------------------------------------------------------------
let warping = false;
let warpStop = null;

export function warp({ reduced = false } = {}) {
  if (warping) return;
  stopOthers('warp');
  const html = document.documentElement;
  // No fim da página: volta para o início. De qualquer outro ponto: vai para o fim.
  const bottom = html.scrollHeight - innerHeight;
  const back = scrollY >= bottom - 40;
  const endY = back ? 0 : bottom;
  if (reduced) {
    scrollTo(0, endY);
    return;
  }
  warping = true;
  const { ctx, dispose } = fullCanvas('egg-warp');
  document.body.classList.add('is-warping');
  const lines = Array.from({ length: 280 }, () => ({ a: Math.random() * TAU, d: Math.random() * 60, v: 0.5 + Math.random() * 1.5 }));
  const startY = scrollY;
  const DUR = 2400;
  const prevBehavior = html.style.scrollBehavior;
  html.style.scrollBehavior = 'auto';
  const t0 = performance.now();
  const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  let cancelled = false;
  const finish = () => {
    dispose();
    document.body.classList.remove('is-warping');
    html.style.scrollBehavior = prevBehavior;
    warping = false;
    warpStop = null;
  };
  // Outro easter egg foi ativado no meio do salto: para onde está
  warpStop = () => { cancelled = true; finish(); };

  const frame = (now) => {
    if (cancelled) return;
    const k = Math.min(1, (now - t0) / DUR);
    const w = innerWidth, h = innerHeight, cx = w / 2, cy = h / 2;
    const max = Math.hypot(cx, cy);
    // velocidade sobe, segura e desce
    const speed = k < 0.25 ? k / 0.25 : k > 0.8 ? (1 - k) / 0.2 : 1;
    const dark = Math.min(0.88, speed * 0.95);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = `rgba(1,4,12,${dark})`;
    ctx.fillRect(0, 0, w, h);
    ctx.lineCap = 'round';
    lines.forEach((l) => {
      l.d += l.v * (2 + speed * 38) * (0.3 + l.d / max);
      if (l.d > max) { l.d = Math.random() * 40; l.a = Math.random() * TAU; }
      const len = 4 + speed * l.d * 0.35;
      const x1 = cx + Math.cos(l.a) * l.d, y1 = cy + Math.sin(l.a) * l.d;
      const x0 = cx + Math.cos(l.a) * Math.max(0, l.d - len), y0 = cy + Math.sin(l.a) * Math.max(0, l.d - len);
      ctx.strokeStyle = `rgba(${170 + Math.random() * 60},${215 + Math.random() * 40},255,${0.35 + speed * 0.6})`;
      ctx.lineWidth = 0.6 + (l.d / max) * 2.2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    });
    // a página "voa" até o destino enquanto as estrelas passam
    const sk = Math.min(1, Math.max(0, (k - 0.15) / 0.65));
    scrollTo(0, startY + (endY - startY) * ease(sk));

    if (k < 1) requestAnimationFrame(frame);
    else {
      finish();
      toast(back ? '⚡ Salto concluído. De volta ao começo do universo!' : '⚡ Salto para o hiperespaço concluído. Bem-vindo ao fim do universo!');
    }
  };
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------
//  3. Gravidade zero (código ↑ ↓ ↑ ↓ ← → ← → A B, ou o Konami clássico)
//  O que está na tela se solta e flutua perto de onde estava. Ao rolar a
//  página, o que vai aparecendo também se solta. Tudo continua funcionando:
//  clique é clique, campos de texto aceitam digitação; só vira "arrastar"
//  quando o mouse é segurado e movido. Repetir o código religa a gravidade
//  (ou ela volta sozinha depois de 1 minuto sem interação).
// ---------------------------------------------------------------------
let zeroG = null;

const ZG_TARGETS = [
  // hero
  '.hero .w', '.status__dot', '.hero__scroll',
  // títulos e textos das seções
  '.eyebrow', '.section__title .tw', '.section__lead .tl', '.results',
  // destaque (inclusive as peças da imagem)
  '.feature__title .as', '.feature__text',
  // projetos, sobre, trajetória
  '.card', '.skill', '.chip', '.btn', '.search', '.filter__btn', '.pager__num', '.pager__step', '.marquee__track > span',
  '.about__photo', '.about__text .w', '.about__rule', '.about__facts > div', '.job', '.step', '.timeline__head', '.timeline__line',
  // rodapé
  '.footer__title', '.footer__mail', '.footer__rule', '.footer__socials a', '.footer__nav a', '.footer__copy', '.footer__giant',
].join(',');
const ZG_MAX = 320;
const TYPING = 'input, textarea, select, [contenteditable="true"]';

export function toggleZeroGravity({ reduced = false } = {}) {
  if (zeroG) { zeroG.end(); return; }
  stopOthers('zerog');
  if (reduced) { toast('🪐 Gravidade zero… mas seu sistema pede menos movimento, então tudo fica no lugar.'); return; }

  document.body.classList.add('is-zero-g');
  const items = [];
  const inView = (r) => r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;

  // Solta o que estiver visível e ainda não flutua (sem pegar um elemento dentro de outro)
  function pickVisible() {
    if (items.length >= ZG_MAX) return;
    document.querySelectorAll(ZG_TARGETS).forEach((el) => {
      if (items.length >= ZG_MAX || el.closest('.dock, .modal, .egg-hud, .zg-item') || el.querySelector('.zg-item')) return;
      const r = el.getBoundingClientRect();
      if (!inView(r)) return;
      el.classList.add('zg-item');
      const prevDisplay = el.style.display, prevPosition = el.style.position;
      const cs = getComputedStyle(el);
      if (cs.display === 'inline') el.style.display = 'inline-block';
      // precisa de posição para ficar por cima; quem já tem (absolute, sticky...) mantém a sua
      if (cs.position === 'static') el.style.position = 'relative';
      items.push({
        el, w: r.width, h: r.height,
        mass: Math.max(1, r.width * r.height), // "peso" para as colisões
        homeX: r.left + scrollX, homeY: r.top + scrollY, // lugar original, em coordenadas da página
        x: 0, y: 0, rot: 0,
        vx: (Math.random() - 0.5) * 6, vy: -1 - Math.random() * 4, vr: (Math.random() - 0.5) * 3,
        // "deriva": direção que muda devagar e velocidade mínima — ninguém fica parado
        wa: Math.random() * Math.PI * 2, cruise: 0.6 + Math.random() * 1.4, spin: (Math.random() < 0.5 ? -1 : 1) * (0.15 + Math.random() * 0.5),
        prev: { transform: el.style.transform, transition: el.style.transition, display: prevDisplay, position: prevPosition },
      });
      el.style.transition = 'none';
    });
  }
  pickVisible();

  // --- arrastar / arremessar (sem atrapalhar cliques e digitação) ---
  let pending = null, drag = null, suppressClick = false, raf = 0, last = 0, lastPick = 0, idle = 0;
  const findItem = (target) => items.find((it) => it.el.contains(target));
  const touch = () => { clearTimeout(idle); idle = setTimeout(end, 60000); };

  const onDown = (e) => {
    touch();
    if (e.button !== 0 || e.target.closest(TYPING)) return; // campos de texto: comportamento normal
    const it = findItem(e.target);
    if (it) pending = { it, sx: e.clientX, sy: e.clientY, px: e.clientX, py: e.clientY, vx: 0, vy: 0 };
  };
  const onMove = (e) => {
    if (pending && !drag && Math.hypot(e.clientX - pending.sx, e.clientY - pending.sy) > 6) {
      drag = pending; // só agora vira arrastar
      drag.it.el.classList.add('is-grabbed');
      document.body.classList.add('zg-dragging');
    }
    if (!drag) return;
    const dx = e.clientX - drag.px, dy = e.clientY - drag.py;
    drag.it.x += dx; drag.it.y += dy;
    drag.vx = dx; drag.vy = dy;
    drag.it.vx = dx; drag.it.vy = dy;
    drag.px = e.clientX; drag.py = e.clientY;
  };
  const onUp = () => {
    if (drag) {
      drag.it.vx = drag.vx * 0.9; drag.it.vy = drag.vy * 0.9;
      drag.it.vr = Math.max(-8, Math.min(8, drag.vx * 0.25)); // gira, mas sem virar um pião
      drag.it.el.classList.remove('is-grabbed');
      document.body.classList.remove('zg-dragging');
      suppressClick = true; // o clique que vem depois de soltar não conta
    }
    pending = null;
    drag = null;
  };
  const onClick = (e) => {
    if (!suppressClick) return;
    suppressClick = false;
    e.preventDefault();
    e.stopPropagation();
  };
  addEventListener('pointerdown', onDown, true);
  addEventListener('pointermove', onMove, true);
  addEventListener('pointerup', onUp, true);
  addEventListener('click', onClick, true);
  addEventListener('keydown', touch, true);
  addEventListener('scroll', touch, { passive: true });

  // Colisões entre os elementos perto da tela: cada um é o seu retângulo, com
  // "peso" proporcional à área; o que está sendo arrastado empurra tudo.
  function collide(H) {
    const top = scrollY - 300, bottom = scrollY + H + 300;
    const near = items.filter((it) => {
      const cy = it.homeY + it.y + it.h / 2;
      return cy > top && cy < bottom;
    });
    for (let i = 0; i < near.length; i++) {
      const a = near[i];
      const ax = a.homeX + a.x + a.w / 2, ay = a.homeY + a.y + a.h / 2;
      for (let j = i + 1; j < near.length; j++) {
        const b = near[j];
        const dx = b.homeX + b.x + b.w / 2 - ax, dy = b.homeY + b.y + b.h / 2 - ay;
        // Retângulos (90% do tamanho, para vizinhos colados não "explodirem" no começo)
        const ox = (a.w + b.w) * 0.45 - Math.abs(dx), oy = (a.h + b.h) * 0.45 - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        // sai pelo lado em que a sobreposição é menor
        const alongX = ox < oy;
        const nx = alongX ? Math.sign(dx) || 1 : 0, ny = alongX ? 0 : Math.sign(dy) || 1;
        const overlap = alongX ? ox : oy;
        const aFixed = drag?.it === a, bFixed = drag?.it === b;
        const invA = aFixed ? 0 : 1 / a.mass, invB = bFixed ? 0 : 1 / b.mass;
        if (!invA && !invB) continue;
        // separa (quem é mais leve anda mais)
        const push = overlap / (invA + invB) * 0.6;
        a.x -= nx * push * invA; a.y -= ny * push * invA;
        b.x += nx * push * invB; b.y += ny * push * invB;
        // quica, se estão se aproximando
        const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rv < 0) {
          const imp = -(1 + 0.9) * rv / (invA + invB);
          a.vx -= imp * invA * nx; a.vy -= imp * invA * ny;
          b.vx += imp * invB * nx; b.vy += imp * invB * ny;
          // a batida também faz girar um pouco
          const kick = Math.min(4, Math.abs(rv) * 0.3);
          if (invA) a.vr += (Math.random() - 0.5) * kick;
          if (invB) b.vr += (Math.random() - 0.5) * kick;
        }
      }
    }
    // velocidade máxima, para nada sair "teleportando" depois de um choque forte
    items.forEach((it) => {
      const sp = Math.hypot(it.vx, it.vy);
      if (sp > 28 && drag?.it !== it) { it.vx *= 28 / sp; it.vy *= 28 / sp; }
      it.vr = Math.max(-10, Math.min(10, it.vr));
    });
  }

  const frame = (t) => {
    const dt = Math.min(2, (t - (last || t)) / 16.67);
    last = t;
    // Rolou para outra parte do site? O que apareceu também se solta.
    if (t - lastPick > 300) { lastPick = t; pickVisible(); }
    const W = document.documentElement.clientWidth, H = innerHeight;
    items.forEach((it) => {
      if (drag?.it !== it) {
        it.vx *= Math.pow(0.996, dt); it.vy *= Math.pow(0.996, dt); it.vr *= Math.pow(0.99, dt);
        // Deriva: empurra de leve numa direção que vai mudando, até a velocidade de cruzeiro
        it.wa += (Math.random() - 0.5) * 0.12 * dt;
        const speed = Math.hypot(it.vx, it.vy);
        if (speed < it.cruise) { it.vx += Math.cos(it.wa) * 0.045 * dt; it.vy += Math.sin(it.wa) * 0.045 * dt; }
        if (Math.abs(it.vr) < Math.abs(it.spin)) it.vr += it.spin * 0.02 * dt;
        it.x += it.vx * dt; it.y += it.vy * dt; it.rot += it.vr * dt;
        // Flutua perto de casa: na largura da janela e até meia tela acima/abaixo
        const minX = -it.homeX, maxX = W - it.w - it.homeX;
        const minY = Math.max(-it.homeY, -H * 0.45), maxY = H * 0.45;
        if (it.x < minX) { it.x = minX; it.vx = Math.abs(it.vx) * 0.8; }
        if (it.x > maxX) { it.x = maxX; it.vx = -Math.abs(it.vx) * 0.8; }
        if (it.y < minY) { it.y = minY; it.vy = Math.abs(it.vy) * 0.8; }
        if (it.y > maxY) { it.y = maxY; it.vy = -Math.abs(it.vy) * 0.8; }
      }
    });
    collide(H);
    items.forEach((it) => {
      it.el.style.transform = `translate(${it.x.toFixed(1)}px, ${it.y.toFixed(1)}px) rotate(${it.rot.toFixed(1)}deg)`;
    });
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  touch();
  toast('🪐 Gravidade desligada! Arraste e arremesse as coisas — o site continua funcionando. (repita o código para religar)', 4200);

  function end() {
    if (!zeroG) return;
    zeroG = null;
    cancelAnimationFrame(raf);
    clearTimeout(idle);
    removeEventListener('pointerdown', onDown, true);
    removeEventListener('pointermove', onMove, true);
    removeEventListener('pointerup', onUp, true);
    removeEventListener('click', onClick, true);
    removeEventListener('keydown', touch, true);
    removeEventListener('scroll', touch);
    document.body.classList.remove('zg-dragging');
    // Volta para o lugar com um efeito elástico, um pouco fora de sincronia
    items.forEach((it, i) => {
      it.el.classList.remove('is-grabbed');
      it.el.style.transition = `transform 1.1s cubic-bezier(.3,1.5,.5,1) ${Math.min(i, 60) * 12}ms`;
      it.el.style.transform = it.prev.transform;
    });
    setTimeout(() => {
      items.forEach((it) => {
        it.el.style.transition = it.prev.transition;
        it.el.style.display = it.prev.display;
        it.el.style.position = it.prev.position;
        it.el.classList.remove('zg-item');
      });
      document.body.classList.remove('is-zero-g');
    }, 1100 + Math.min(items.length, 60) * 12);
    toast('🌍 Gravidade restaurada.');
  }
  zeroG = { end };
}
