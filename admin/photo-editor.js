// =====================================================================
//  Editor de foto: abre antes do envio de uma imagem no painel.
//  Corta numa proporção (arrastando e dando zoom), gira, espelha e ajusta
//  brilho, contraste e saturação. Tudo no navegador, num <canvas>.
//
//  editPhoto(file, { ratio, title }) devolve:
//    - um File novo com as edições,
//    - o próprio arquivo, se a pessoa escolher "Enviar sem editar",
//    - null, se cancelar.
//  GIF (pode ser animado) e o que não for imagem passam direto, sem editor.
// =====================================================================
const RATIOS = [['Original', 0], ['1:1', 1], ['4:3', 4 / 3], ['4:5', 4 / 5], ['16:9', 16 / 9], ['9:16', 9 / 16]];
const ADJUST = [['brightness', 'Brilho'], ['contrast', 'Contraste'], ['saturate', 'Saturação']];
const MAX_SIDE = 2560; // maior lado do arquivo final, em pixels
const MAX_ZOOM = 5;

const SVG = (d) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON = {
  left: SVG('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  right: SVG('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
  flip: SVG('<path d="M12 3v18"/><path d="M8 7 3 12l5 5V7z"/><path d="M16 7l5 5-5 5V7z"/>'),
  reset: SVG('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  zoom: SVG('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M11 8v6M8 11h6"/>'),
};

let dlg = null;
const $ = (sel) => dlg.querySelector(sel);
const $$ = (sel) => [...dlg.querySelectorAll(sel)];

function build() {
  dlg = document.createElement('dialog');
  dlg.className = 'photo-ed';
  dlg.setAttribute('aria-labelledby', 'photo-ed-title');
  dlg.innerHTML = `
    <form method="dialog" class="photo-ed__box">
      <header class="photo-ed__head">
        <h2 id="photo-ed-title">Ajustar foto</h2>
        <span class="photo-ed__count muted" data-count></span>
      </header>
      <div class="photo-ed__stage" data-stage>
        <canvas data-canvas></canvas>
        <div class="photo-ed__frame" data-frame aria-hidden="true"></div>
      </div>
      <p class="photo-ed__hint muted">Arraste a foto para posicionar · role ou use o zoom para aproximar</p>
      <div class="photo-ed__bar">
        <div class="seg" role="group" aria-label="Proporção do corte" data-ratios>
          ${RATIOS.map(([label], i) => `<button type="button" data-ratio="${i}">${label}</button>`).join('')}
        </div>
        <div class="photo-ed__tools">
          <button class="btn btn--icon btn--sm btn--ghost" type="button" data-rotate="-1" title="Girar para a esquerda" aria-label="Girar para a esquerda">${ICON.left}</button>
          <button class="btn btn--icon btn--sm btn--ghost" type="button" data-rotate="1" title="Girar para a direita" aria-label="Girar para a direita">${ICON.right}</button>
          <button class="btn btn--icon btn--sm btn--ghost" type="button" data-flip title="Espelhar" aria-label="Espelhar">${ICON.flip}</button>
          <button class="btn btn--icon btn--sm btn--ghost" type="button" data-reset title="Desfazer tudo" aria-label="Desfazer tudo">${ICON.reset}</button>
        </div>
      </div>
      <div class="photo-ed__sliders">
        <label class="photo-ed__slider"><span>${ICON.zoom} Zoom</span><input type="range" min="1" max="${MAX_ZOOM}" step="0.01" value="1" data-zoom></label>
        ${ADJUST.map(([key, label]) => `<label class="photo-ed__slider"><span>${label} <output data-out="${key}">0</output></span><input type="range" min="-100" max="100" step="1" value="0" data-adjust="${key}"></label>`).join('')}
      </div>
      <footer class="photo-ed__foot">
        <button class="btn btn--ghost" value="cancel">Cancelar</button>
        <span class="spacer"></span>
        <button class="btn btn--ghost" value="skip">Enviar sem editar</button>
        <button class="btn btn--primary" value="ok">Aplicar e enviar</button>
      </footer>
    </form>`;
  document.body.append(dlg);
}

const loadImage = (file) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => resolve({ img, url });
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('imagem inválida')); };
  img.src = url;
});

// Filtro CSS/canvas a partir dos ajustes (-100..100 → 0..2; brilho vai de 0,5 a 1,5)
const filterOf = (a) => `brightness(${1 + a.brightness / 200}) contrast(${1 + a.contrast / 100}) saturate(${1 + a.saturate / 100})`;

// Mesmo resultado do filtro, pixel a pixel, para navegadores sem ctx.filter (Safari antigo)
function applyPixels(ctx, w, h, a) {
  const b = 1 + a.brightness / 200, c = 1 + a.contrast / 100, s = 1 + a.saturate / 100;
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    let r = px[i] * b, g = px[i + 1] * b, bl = px[i + 2] * b;
    r = (r - 128) * c + 128; g = (g - 128) * c + 128; bl = (bl - 128) * c + 128;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    px[i] = l + (r - l) * s; px[i + 1] = l + (g - l) * s; px[i + 2] = l + (bl - l) * s;
  }
  ctx.putImageData(data, 0, 0);
}

// reedit: a foto já está no projeto; sem "Enviar sem editar" (cancelar já deixa como está)
// initial: os ajustes da última edição (file é o original): o editor reabre como estava.
// O File devolvido leva .editState, para guardar e reabrir depois.
export async function editPhoto(file, { ratio = 0, title = 'Ajustar foto', count = '', reedit = false, initial = null } = {}) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  let loaded;
  try { loaded = await loadImage(file); } catch { return file; } // o navegador não abre: envia como veio
  const { img, url } = loaded;
  if (!dlg) build();

  const canvas = $('[data-canvas]'), stage = $('[data-stage]'), frame = $('[data-frame]');
  const ctx = canvas.getContext('2d');
  const zoomInput = $('[data-zoom]');
  const ratioIndex = (r) => RATIOS.findIndex(([, v]) => Math.abs(v - r) < 0.01);
  const start = Math.max(0, ratioIndex(ratio)); // "Desfazer tudo" volta para cá
  const st = { ratio: start, rot: 0, flip: 1, zoom: 1, x: 0, y: 0, adj: { brightness: 0, contrast: 0, saturate: 0 } };
  // posição salva em fração da moldura: só vira pixels quando o palco tem tamanho
  let pending = null;
  if (initial) {
    const n = (v, d, min, max) => (Number.isFinite(+v) ? Math.min(max, Math.max(min, +v)) : d);
    st.ratio = Math.max(0, ratioIndex(+initial.ratio || 0));
    st.rot = n(initial.rot, 0, 0, 3) | 0;
    st.flip = initial.flip === -1 ? -1 : 1;
    st.zoom = n(initial.zoom, 1, 1, MAX_ZOOM);
    ADJUST.forEach(([key]) => { st.adj[key] = n(initial.adj?.[key], 0, -100, 100); });
    pending = { x: n(initial.x, 0, -10, 10), y: n(initial.y, 0, -10, 10) };
  }
  let box = { fw: 0, fh: 0, sw: 0, sh: 0 }; // moldura e palco, em pixels de tela

  // largura/altura da foto depois de girada
  const dims = () => (st.rot % 2 ? [img.naturalHeight, img.naturalWidth] : [img.naturalWidth, img.naturalHeight]);
  const aspect = () => { const [w, h] = dims(); return RATIOS[st.ratio][1] || w / h; };
  // escala que faz a foto cobrir a moldura inteira (zoom 1)
  const cover = () => { const [w, h] = dims(); return Math.max(box.fw / w, box.fh / h); };
  const scale = () => cover() * st.zoom;
  // não deixa sobrar espaço vazio dentro da moldura
  const clamp = () => {
    const [w, h] = dims(), s = scale();
    const mx = Math.max(0, (w * s - box.fw) / 2), my = Math.max(0, (h * s - box.fh) / 2);
    st.x = Math.min(mx, Math.max(-mx, st.x));
    st.y = Math.min(my, Math.max(-my, st.y));
  };

  const layout = () => {
    const sw = stage.clientWidth, sh = stage.clientHeight, pad = 24;
    const a = aspect();
    let fw = sw - pad * 2, fh = fw / a;
    if (fh > sh - pad * 2) { fh = sh - pad * 2; fw = fh * a; }
    box = { fw, fh, sw, sh };
    if (pending && fw) { st.x = pending.x * fw; st.y = pending.y * fh; pending = null; }
    Object.assign(frame.style, { width: `${fw}px`, height: `${fh}px` });
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = sw * dpr; canvas.height = sh * dpr;
    canvas.style.width = `${sw}px`; canvas.style.height = `${sh}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    clamp();
    draw();
  };

  // desenha a foto com o centro da moldura na origem
  const paint = (c, s) => {
    c.translate(st.x, st.y);
    c.rotate((st.rot * Math.PI) / 2);
    c.scale(st.flip * s, s);
    c.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  };
  const draw = () => {
    ctx.save();
    ctx.clearRect(0, 0, box.sw, box.sh);
    ctx.translate(box.sw / 2, box.sh / 2);
    paint(ctx, scale());
    ctx.restore();
    canvas.style.filter = filterOf(st.adj); // prévia rápida; o arquivo final usa o mesmo filtro
  };

  const sync = () => {
    $$('[data-ratio]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.ratio === st.ratio)));
    zoomInput.value = st.zoom;
    ADJUST.forEach(([key]) => {
      dlg.querySelector(`[data-adjust="${key}"]`).value = st.adj[key];
      dlg.querySelector(`[data-out="${key}"]`).textContent = st.adj[key] > 0 ? `+${st.adj[key]}` : st.adj[key];
    });
  };

  // ----- interações -----
  const onClick = (e) => {
    const r = e.target.closest('[data-ratio]');
    if (r) { st.ratio = +r.dataset.ratio; st.zoom = 1; st.x = st.y = 0; sync(); layout(); }
    const rot = e.target.closest('[data-rotate]');
    if (rot) { st.rot = (st.rot + +rot.dataset.rotate + 4) % 4; st.x = st.y = 0; layout(); }
    if (e.target.closest('[data-flip]')) { st.flip *= -1; draw(); }
    if (e.target.closest('[data-reset]')) {
      Object.assign(st, { ratio: start, rot: 0, flip: 1, zoom: 1, x: 0, y: 0, adj: { brightness: 0, contrast: 0, saturate: 0 } });
      sync(); layout();
    }
  };
  const onInput = (e) => {
    if (e.target === zoomInput) { st.zoom = +zoomInput.value; clamp(); draw(); }
    const key = e.target.dataset.adjust;
    if (key) { st.adj[key] = +e.target.value; sync(); draw(); }
  };
  let drag = null;
  const onDown = (e) => { drag = { x: e.clientX - st.x, y: e.clientY - st.y }; stage.setPointerCapture(e.pointerId); stage.classList.add('is-dragging'); };
  const onMove = (e) => { if (!drag) return; st.x = e.clientX - drag.x; st.y = e.clientY - drag.y; clamp(); draw(); };
  const onUp = () => { drag = null; stage.classList.remove('is-dragging'); };
  const onWheel = (e) => {
    e.preventDefault();
    st.zoom = Math.min(MAX_ZOOM, Math.max(1, st.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
    clamp(); sync(); draw();
  };
  const onKey = (e) => { // setas movem a foto quando o palco está em foco
    const step = e.shiftKey ? 20 : 4, map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (!map[e.key]) return;
    e.preventDefault();
    st.x += map[e.key][0]; st.y += map[e.key][1]; clamp(); draw();
  };
  const ro = new ResizeObserver(layout);

  dlg.addEventListener('click', onClick);
  dlg.addEventListener('input', onInput);
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('wheel', onWheel, { passive: false });
  stage.addEventListener('keydown', onKey);
  stage.tabIndex = 0;
  stage.setAttribute('aria-label', 'Foto: arraste ou use as setas para posicionar');

  $('#photo-ed-title').textContent = title;
  $('[data-count]').textContent = count;
  $('[value="skip"]').hidden = reedit;
  $('[value="ok"]').textContent = reedit ? 'Aplicar' : 'Aplicar e enviar';
  dlg.returnValue = '';
  sync();
  dlg.showModal();
  layout();
  ro.observe(stage);

  const choice = await new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue), { once: true }));
  ro.disconnect();
  dlg.removeEventListener('click', onClick);
  dlg.removeEventListener('input', onInput);
  stage.removeEventListener('pointerdown', onDown);
  stage.removeEventListener('pointermove', onMove);
  stage.removeEventListener('pointerup', onUp);
  stage.removeEventListener('pointercancel', onUp);
  stage.removeEventListener('wheel', onWheel);
  stage.removeEventListener('keydown', onKey);

  try {
    if (choice === 'skip') return file;
    if (choice !== 'ok') return null;
    const out = await render(file, img, st, box, scale());
    if (out !== file) {
      out.editState = {
        ratio: RATIOS[st.ratio][1], rot: st.rot, flip: st.flip, zoom: +st.zoom.toFixed(4),
        x: +(st.x / box.fw).toFixed(5), y: +(st.y / box.fh).toFixed(5), adj: { ...st.adj },
      };
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Gera o arquivo final no tamanho real da área cortada (até MAX_SIDE)
async function render(file, img, st, box, s) {
  const cw = box.fw / s, ch = box.fh / s; // área cortada, em pixels da foto
  const k = Math.min(1, MAX_SIDE / Math.max(cw, ch));
  const w = Math.max(1, Math.round(cw * k)), h = Math.max(1, Math.round(ch * k));
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const c = out.getContext('2d');
  const adjusted = st.adj.brightness || st.adj.contrast || st.adj.saturate;
  const native = 'filter' in c;
  if (adjusted && native) c.filter = filterOf(st.adj);
  c.imageSmoothingQuality = 'high';
  c.translate(w / 2, h / 2);
  c.scale(w / box.fw, h / box.fh);
  c.translate(st.x, st.y);
  c.rotate((st.rot * Math.PI) / 2);
  c.scale(st.flip * s, s);
  c.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  if (adjusted && !native) applyPixels(c, w, h, st.adj);

  // PNG e WebP podem ter fundo transparente (logos): mantém o formato
  const type = ['image/png', 'image/webp'].includes(file.type) ? file.type : 'image/jpeg';
  const blob = await new Promise((resolve) => out.toBlob(resolve, type, 0.92));
  if (!blob) return file;
  const ext = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' }[blob.type] || 'jpg';
  const name = `${file.name.replace(/\.[^.]+$/, '') || 'foto'}.${ext}`;
  return new File([blob], name, { type: blob.type, lastModified: Date.now() });
}
