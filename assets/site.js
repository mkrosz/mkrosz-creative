// =====================================================================
//  Portfólio — renderização + interações. Zero dependências.
// =====================================================================
import { fetchPortfolio, readCache, isConfigured, formatDate, escapeHtml as esc, safeUrl, mediaKind, toEmbedUrl, youtubeId, normalizeText } from '../shared/api.js';
import { initTheme, toggleTheme, applyColors } from '../shared/theme.js';
import { platform, platformIcon } from '../shared/platforms.js';
import { createBlackHole } from './blackhole.js';
import { placeholder } from '../shared/placeholder.js';
import { injectLogo } from '../shared/logo.js';
import { gravity, isWhiteHole } from '../shared/gravity.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const slot = (name) => $(`[data-slot="${name}"]`);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(pointer: fine)').matches;

let DATA = null;
let blackHole = null;
const state = { q: '', tags: new Set(), page: 1 };
const PER_PAGE = 6; // projetos por página

// Logo personalizada (Identidade no painel): troca o gato pelas imagens enviadas.
// O topo do site é sempre escuro, então lá vai a versão do tema escuro.
function renderLogo(s) {
  const light = s.logo_url, dark = s.logo_dark_url || light;
  if (!light && !dark) return;
  const img = (src, cls) => `<img class="mk-logo-img ${cls}" src="${esc(safeUrl(src))}" alt="">`;
  $$('.mk-logo').forEach((el) => {
    const html = el.classList.contains('hero__logo') ? img(dark, '') : img(light || dark, 'is-light') + img(dark, 'is-dark');
    const cls = el.getAttribute('class').replace(/\s*mk-logo--custom/, '');
    el.outerHTML = `<span class="${cls} mk-logo--custom" aria-hidden="true">${html}</span>`;
  });
}

// ---------------------------------------------------------------------
//  Boot: cache primeiro (abre instantâneo), rede depois.
// ---------------------------------------------------------------------
async function boot() {
  injectLogo(); // o gato do mkrosz (barra flutuante e rodapé)
  bindStaticUI();
  const cached = isConfigured ? readCache() : null;
  if (cached) render(cached);
  try {
    const fresh = await fetchPortfolio();
    if (!cached || JSON.stringify(cached) !== JSON.stringify(fresh)) render(fresh);
  } catch (err) {
    console.error('Falha ao carregar o portfólio:', err);
    if (!cached) {
      const { DEMO } = await import('../shared/demo-data.js');
      render(DEMO);
    }
  }
}

function render(data) {
  DATA = data;
  const s = data.settings || {};
  applyColors(s);
  if (!document.documentElement.dataset.themeSet) {
    initTheme(s.default_theme);
    document.documentElement.dataset.themeSet = '1';
  }
  document.title = [s.site_name, s.role].filter(Boolean).join(' — ') || 'Portfólio';

  $$('[data-bind]').forEach((el) => {
    const key = el.dataset.bind;
    // Textos do hero e do contato são quebrados em letras (renderHero/renderContact)
    if (!['hero_title', 'hero_eyebrow', 'hero_subtitle', 'footer_cta'].includes(key)) el.textContent = s[key] ?? '';
  });

  renderLogo(s);
  renderHero(s);
  renderContact(s);
  splitSectionHeads();
  renderSocials(data.socials);
  renderMarquee(s.skills);
  renderFeature(data, s);
  renderFilters(data.tags, data.projects);
  initSearchHint.setWords?.([
    ...data.tags.map((t) => t.name.toLowerCase()),
    ...data.projects.slice(0, 4).map((p) => p.title),
  ].map((x) => `“${x}”`));
  renderGrid(data.projects);
  renderAbout(s);
  renderJourney(data.education);
  renderFooter(s);
  consoleHello(s);

  observeReveals();
  initScrollEffects();
  openFromHash();
  movePill();
  // setTimeout (e não rAF): abas abertas em segundo plano também mostram o conteúdo.
  setTimeout(() => document.body.classList.add('is-ready'), 30);
}

// "Design que *se sente*." → palavras entre asteriscos ganham destaque.
function richTokens(text = '') {
  const out = [];
  let accent = false;
  text.split(/(\*)/).forEach((part) => {
    if (part === '*') { accent = !accent; return; }
    part.split(/(\s+)/).forEach((w) => { if (w) out.push({ w, accent }); });
  });
  return out;
}

// Easter egg para quem abre o console (F12)
function consoleHello(s) {
  if (consoleHello.done) return;
  consoleHello.done = true;
  const art = [
    '        .   *        .       *',
    '   *        ▄▄████▄▄       .',
    '     .   ▄██▀▀    ▀▀██▄  *',
    ' ═══════██     ●     ██═══════',
    '   *     ▀██▄▄    ▄▄██▀    .',
    '      .     ▀▀████▀▀   *',
  ].join('\n');
  console.log(`%c${art}`, 'color:#00c2ff;font-family:monospace;font-size:12px;line-height:1.15');
  console.log('%cCurioso, hein? 👀', 'font:700 18px system-ui,sans-serif;color:#2f7bff');
  console.log(`%cGostou do que viu por baixo dos panos? Vamos conversar${s.email ? `: ${s.email}` : '!'}

Psiu… este universo guarda segredos:
  ⌨  digite "warp" em qualquer lugar da página
  🕳  o buraco negro não gosta de ser cutucado… muitas vezes\n  🎮  ↑ ↓ ↑ ↓ ← → ← → A B`, 'font:14px system-ui,sans-serif;line-height:1.6');
}

// Cabeçalhos das seções: título em letras que sobem de uma máscara e
// subtítulo palavra por palavra (a animação dispara quando entram na tela).
function splitSectionHeads() {
  $$('.section__head').forEach((head) => {
    const title = $('.section__title', head);
    const lead = $('.section__lead', head);
    let i = 0;
    if (title) {
      const text = title.textContent;
      title.innerHTML = `<span class="visually-hidden">${esc(text)}</span>` + text.split(/\s+/).filter(Boolean)
        .map((w) => `<span class="tw" aria-hidden="true">${[...w].map((c) => `<span class="tc" style="--d:${120 + i++ * 28}ms">${esc(c)}</span>`).join('')}</span>`)
        .join(' ');
    }
    if (lead) {
      const text = lead.textContent;
      const start = 300 + i * 28;
      lead.innerHTML = `<span class="visually-hidden">${esc(text)}</span>` + text.split(/\s+/).filter(Boolean)
        .map((w, j) => `<span class="tl" aria-hidden="true" style="--d:${start + j * 35}ms">${esc(w)}</span>`)
        .join(' ');
    }
  });
}

// Quebra um texto em palavras (.w) e letras (.c). Cada letra recebe o atraso
// de entrada (--d) e um giro inicial aleatório (--r). Retorna quando termina (ms).
function splitChars(el, text, { start = 0, step = 30 } = {}) {
  let i = 0;
  // Cópia invisível para leitores de tela (as letras soltas ficam ocultas para eles)
  el.innerHTML = `<span class="visually-hidden">${esc(text.replace(/\*/g, ''))}</span>` + richTokens(text)
    .map(({ w, accent }) => {
      if (/^\s+$/.test(w)) return ' ';
      const chars = [...w]
        .map((c) => `<span class="c" style="--d:${Math.round(start + i++ * step)}ms;--r:${Math.round((Math.random() - 0.5) * 70)}deg">${esc(c)}</span>`)
        .join('');
      return `<span class="w${accent ? ' accent' : ''}" aria-hidden="true">${chars}</span>`;
    })
    .join('');
  return start + i * step;
}

function renderHero(s) {
  const inner = $('.hero__inner');
  // Entrada em cascata: selo → título → subtítulo → status
  let t = splitChars($('[data-bind="hero_eyebrow"]'), s.hero_eyebrow || '', { start: 80, step: 22 });
  t = splitChars($('#hero-title'), s.hero_title || s.site_name || '', { start: t * 0.6, step: 32 });
  t = splitChars($('[data-bind="hero_subtitle"]'), s.hero_subtitle || '', { start: t * 0.75, step: 7 });
  t = splitChars(slot('status'), s.available_for_work ? 'Disponível para novos projetos' : '', { start: t * 0.9, step: 12 });
  // A bolinha verde é um elemento de verdade: entra na animação de órbita junto com as letras
  if (s.available_for_work) slot('status').insertAdjacentHTML('afterbegin', '<span class="status__dot" aria-hidden="true"></span>');
  // Terminada a entrada, as letras passam a reagir à "gravidade" do cursor.
  inner.classList.remove('is-settled');
  clearTimeout(renderHero.t);
  renderHero.t = setTimeout(() => inner.classList.add('is-settled'), t + 1200);
  renderHero.total = t;
  if (!renderHero.io && !reduced) {
    renderHero.io = new IntersectionObserver(([en]) => {
      const hero = $('.hero');
      if (!en.isIntersecting) {
        clearTimeout(renderHero.t);
        inner.classList.remove('is-settled');
        hero.classList.add('is-out');
      } else if (hero.classList.contains('is-out')) {
        hero.classList.remove('is-out');
        renderHero.t = setTimeout(() => inner.classList.add('is-settled'), renderHero.total + 1200);
      }
    });
    renderHero.io.observe($('.hero__inner'));
  }
}

// Contato: o título recebe a mesma entrada letra a letra do hero, disparada
// quando a seção aparece; depois as letras reagem à gravidade do cursor.
function renderContact(s) {
  const cta = $('.footer__cta');
  let t = splitChars($('.footer__cta .eyebrow'), 'Contato', { start: 0, step: 40 });
  t = splitChars($('[data-bind="footer_cta"]'), s.footer_cta || '', { start: t * 0.6, step: 30 });
  cta.classList.remove('is-settled');
  clearTimeout(renderContact.t);
  const settle = () => { renderContact.t = setTimeout(() => cta.classList.add('is-settled'), t + 1200); };
  if (cta.classList.contains('is-in')) settle();
  renderContact.io?.disconnect();
  // entra com 35% visível; rebobina só quando saiu inteira da tela
  renderContact.io = new IntersectionObserver(([en]) => {
    if (en.intersectionRatio >= 0.35 && !cta.classList.contains('is-in')) {
      cta.classList.add('is-in');
      settle();
    } else if (!en.isIntersecting) {
      clearTimeout(renderContact.t);
      cta.classList.remove('is-in', 'is-settled');
    }
  }, { threshold: [0, 0.35] });
  renderContact.io.observe(cta);
}

function socialLinks(socials = [], size = 18) {
  return socials
    .map((so) => {
      const p = platform(so.platform);
      const url = so.platform === 'email' && !/^mailto:/i.test(so.url) ? `mailto:${so.url}` : so.url;
      return `<a href="${esc(safeUrl(url))}" target="_blank" rel="noopener" aria-label="${esc(so.label || p.label)}" title="${esc(so.label || p.label)}">${platformIcon(so.platform, size)}</a>`;
    })
    .join('');
}

function renderSocials(socials) {
  slot('footer-socials').innerHTML = socialLinks(socials, 18);
}

function renderMarquee(skills = []) {
  // Cada letra vira um elemento (.ml) para poder crescer sozinha sob o mouse
  // (agrupadas em .mw para o espaçamento entre letras continuar normal)
  const letters = (k) => [...k].map((c) => (c === ' ' ? ' ' : `<span class="ml">${esc(c)}</span>`)).join('');
  const items = (skills.length ? skills : ['UX', 'UI', 'Branding', 'Motion']).map((k) => `<span><span class="mw">${letters(k)}</span></span>`).join('');
  // Duplicado para o loop infinito sem emenda.
  slot('marquee').innerHTML = items.repeat(skills.length < 6 ? 4 : 2);
}

// Easter eggs: só os gatilhos ficam aqui; o código (easter.js) é baixado
// apenas quando alguém descobre um deles.
function initEasterEggs() {
  // Digitar "warp" em qualquer lugar (fora de campos de texto) → hiperespaço
  let typed = '';
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || /input|textarea|select/i.test(e.target.tagName)) return;
    typed = (typed + e.key.toLowerCase()).slice(-4);
    if (typed === 'warp') {
      typed = '';
      import('./easter.js').then((m) => m.warp({ reduced }));
    }
  });
  // Código ↑ ↓ ↑ ↓ ← → ← → A B (ou o Konami clássico ↑ ↑ ↓ ↓ ← → ← → B A) → gravidade zero
  const ARROWS = { arrowup: 'U', arrowdown: 'D', arrowleft: 'L', arrowright: 'R', a: 'A', b: 'B' };
  const CODES = ['UDUDLRLRAB', 'UUDDLRLRBA'];
  let seq = '';
  document.addEventListener('keydown', (e) => {
    if (/input|textarea|select/i.test(e.target.tagName)) return;
    const k = ARROWS[e.key.toLowerCase()];
    seq = k ? (seq + k).slice(-10) : '';
    if (CODES.includes(seq)) {
      seq = '';
      import('./easter.js').then((m) => m.toggleZeroGravity({ reduced }));
    }
  });
  // 7 cliques no buraco negro em poucos segundos → a nave escapa
  let clicks = [];
  $('.hero').addEventListener('click', (e) => {
    const h = holeOnScreen();
    if (!h || Math.hypot(e.clientX - h.x, e.clientY - h.y) > Math.max(h.r * 1.5, 60)) return;
    const now = Date.now();
    clicks = clicks.filter((t) => now - t < 4000);
    clicks.push(now);
    if (clicks.length >= 7) {
      clicks = [];
      import('./easter.js').then((m) => m.launchShip({ from: holeOnScreen() }));
    }
  });
}

// Dica do campo de busca escrita "à mão": digita e apaga sugestões
// (tags e nomes de projetos). Para quando o campo está em uso ou fora da tela.
function initSearchHint() {
  const input = $('#search');
  if (reduced) return;
  let words = [], w = 0, c = 0, deleting = false, timer = 0, visible = false;
  const base = 'Pesquisar ';
  const tick = () => {
    timer = 0;
    if (!visible || input.value || document.activeElement === input || !words.length) return;
    const word = words[w % words.length];
    c += deleting ? -1 : 1;
    input.placeholder = base + word.slice(0, c) + (c % 2 ? '|' : '');
    let wait = deleting ? 45 : 90;
    if (!deleting && c >= word.length) { deleting = true; wait = 1600; }
    else if (deleting && c <= 0) { deleting = false; w++; wait = 350; }
    timer = setTimeout(tick, wait);
  };
  const run = () => { if (!timer) timer = setTimeout(tick, 400); };
  initSearchHint.setWords = (list) => { words = list; c = 0; w = 0; deleting = false; run(); };
  input.addEventListener('focus', () => { input.placeholder = 'Nome, tag ou descrição…'; });
  input.addEventListener('blur', () => { input.placeholder = 'Pesquisar projetos'; run(); });
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) run(); }).observe(input);
}

// Mouse em cima da faixa: em vez de parar, ela desacelera suavemente
// (muda a velocidade da animação CSS sem dar "pulo") e as letras perto do
// cursor crescem como uma lupa. O cálculo roda a cada quadro porque a faixa
// anda sozinha por baixo do mouse parado.
function initMarquee() {
  const box = $('.marquee');
  const track = $('.marquee__track');
  const RANGE = 70; // px de alcance da "lupa"
  let target = 1, rate = 1, raf = 0, inside = false, px = 0, py = 0;
  let active = new Map(), letters = [], anims = [];
  const step = () => {
    if (rate !== target) {
      rate += (target - rate) * 0.08;
      if (Math.abs(target - rate) < 0.005) rate = target;
      anims.forEach((a) => { a.playbackRate = rate; });
    }

    // primeiro só lê (posições), depois só escreve: sem recalcular o layout por letra
    const next = new Map();
    if (inside) {
      const box_ = box.getBoundingClientRect();
      if (py >= box_.top && py <= box_.bottom) {
        letters.forEach((l) => {
          const r = l.getBoundingClientRect();
          const d = Math.abs(px - (r.left + r.width / 2));
          if (d < RANGE) next.set(l, Math.pow(1 - d / RANGE, 1.6).toFixed(3));
        });
      }
    }
    active.forEach((_, l) => { if (!next.has(l)) l.style.setProperty('--f', 0); });
    next.forEach((f, l) => { if (active.get(l) !== f) l.style.setProperty('--f', f); });
    active = next;
    raf = inside || rate !== target ? requestAnimationFrame(step) : 0;
  };
  const kick = () => { raf ||= requestAnimationFrame(step); };
  box.addEventListener('pointerenter', (e) => {
    // as letras e a animação só mudam quando a faixa é redesenhada: pega aqui
    letters = reduced ? [] : $$('.ml', track); // movimento reduzido: sem lupa
    anims = track.getAnimations();
    inside = true; target = reduced ? 1 : 0.15; px = e.clientX; py = e.clientY; kick();
  });
  box.addEventListener('pointermove', (e) => { px = e.clientX; py = e.clientY; });
  box.addEventListener('pointerleave', () => { inside = false; target = 1; kick(); });
}

// Arte de espera: aparece no lugar da imagem enquanto ela carrega e fica no
// lugar dela se não carregar. Vai como fundo do próprio <img> (data-ph);
// quando a imagem chega, o fundo sai (ver initImageFallbacks).
function phAttrs(label, color, opts) {
  const ph = placeholder(label, { color, ...opts });
  return `data-ph="${esc(ph)}" style="background-image:url(&quot;${esc(ph)}&quot;)"`;
}
const projectPh = (p, opts) => phAttrs(p.title, p.accent_color, { seed: p.id, ...opts });
// endereço da imagem; sem imagem, a própria arte de espera (src="#" faria o
// navegador pedir a página de novo como se fosse imagem)
const imgSrc = (url, label, color, seed) => (url ? safeUrl(url) : placeholder(label, { color, seed }));

function initImageFallbacks() {
  // load/error não sobem pela árvore, mas passam pela fase de captura
  document.addEventListener('load', (e) => {
    const img = e.target;
    if (img.tagName !== 'IMG' || !img.dataset.ph || img.src === img.dataset.ph) return;
    img.style.backgroundImage = '';
    img.classList.add('is-loaded');
  }, true);
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName !== 'IMG' || !img.dataset.ph || img.src === img.dataset.ph) return;
    img.src = img.dataset.ph; // não carregou: fica a arte
  }, true);
}
initImageFallbacks();

function coverOf(p) {
  return p.cover_url || p.media?.find((m) => mediaKind(m) === 'image')?.url || '';
}

let portal = null; // buraco negro do destaque (portal.js)

function renderFeature(data, s) {
  const section = $('#destaque');
  const p = data.projects.find((x) => x.id === s.featured_project_id);
  section.hidden = !p;
  $('#nav-links a[href="#destaque"]').hidden = !p;
  if (!p) return;

  // Imagem que aparece por um portal (o recorte e o anel são CSS + rolagem)
  const media = slot('feature-media');
  // imagem real por cima da arte de espera (que aparece enquanto ela carrega)
  const cssUrl = (u) => `url("${u.replace(/"/g, '%22')}")`;
  const ph = placeholder(p.title, { color: p.accent_color, seed: p.id });
  media.style.setProperty('--img', coverOf(p) ? `${cssUrl(safeUrl(coverOf(p)))}, ${cssUrl(ph)}` : cssUrl(ph));
  media.setAttribute('aria-label', `Imagem do projeto ${p.title}`);
  // O portal é montado uma vez só: um novo render (cache → rede) só troca a imagem.
  // O buraco negro em volta (canvas) é baixado só quando a seção existe; com
  // movimento reduzido o portal já nasce aberto e o canvas não teria o que desenhar.
  if (!$('.portal', media)) {
    media.innerHTML = '<div class="feature__neb" aria-hidden="true"></div><div class="portal"><div class="portal__img"></div></div><canvas class="portal__space" aria-hidden="true"></canvas>';
    if (!reduced) {
      import('./portal.js').then(({ createPortal }) => {
        const k = () => Math.min(1, Math.max(0, ((parseFloat(section.style.getPropertyValue('--p')) || 0) - 0.26) / 0.3));
        portal = createPortal($('.portal__space', media), k);
      });
    }
  }
  media.onclick = () => openProject(p);

  // Título e texto vêm do próprio projeto (escolhido com a estrela no painel)
  // Título: uma palavra de cada vez
  slot('feature-title').innerHTML = richTokens(p.title)
    .filter(({ w }) => w.trim())
    .map(({ w, accent }, i) => `<span class="as${accent ? ' serif' : ''}" style="--s:${(0.52 + i * 0.025).toFixed(3)}">${esc(w)}</span>`)
    .join(' ');
  slot('feature-text').textContent = p.short_description || '';
  // Etiquetas aparecem em sequência
  const chips = [
    [p.title, '#fff'],
    p.project_date ? [formatDate(p.project_date), '#fff'] : null,
    ...p.tags.map((t) => [t.name, esc(t.color)]),
  ].filter(Boolean);
  slot('feature-meta').innerHTML = chips
    .map(([label, color], i) => `<span class="chip as" style="--s:${(0.68 + i * 0.02).toFixed(3)};--chip:${color}">${esc(label)}</span>`)
    .join('');
  slot('feature-open').onclick = () => openProject(p);
}

// ---------------------------------------------------------------------
//  Projetos: filtros + pesquisa
// ---------------------------------------------------------------------
function renderFilters(tags, projects) {
  const used = new Set(projects.flatMap((p) => p.tags.map((t) => t.id)));
  const visible = tags.filter((t) => used.has(t.id));
  const params = new URLSearchParams(location.search);
  if (params.get('tag')) state.tags = new Set(params.get('tag').split(',').filter(Boolean));
  if (params.get('q')) state.q = params.get('q');
  if (params.get('p')) state.page = Number(params.get('p')) || 1;
  $('#search').value = state.q;

  slot('filters').innerHTML = visible
    .map((t, n) => {
      const count = projects.filter((p) => p.tags.some((x) => x.id === t.id)).length;
      return `<button class="chip" type="button" data-tag="${esc(t.slug)}" style="--chip:${esc(t.color)};--n:${n}" aria-pressed="${state.tags.has(t.slug)}">${esc(t.name)} <small>${count}</small></button>`;
    })
    .join('');
  $('#filter-btn').hidden = !visible.length;
}

// Contador no botão "Filtrar" + tags escolhidas (removíveis) abaixo da busca
function renderActiveTags() {
  const count = slot('filter-count');
  count.hidden = !state.tags.size;
  count.textContent = state.tags.size;
  slot('active-tags').innerHTML = [...state.tags]
    .map((slug) => DATA.tags.find((t) => t.slug === slug))
    .filter(Boolean)
    .map((t) => `<span class="chip" style="--chip:${esc(t.color)}">${esc(t.name)}<button type="button" data-untag="${esc(t.slug)}" aria-label="Remover filtro ${esc(t.name)}">✕</button></span>`)
    .join('');
}

function renderGrid(projects) {
  slot('grid').innerHTML = projects
    .map((p, i) => `
      <button class="card reveal" type="button" data-id="${esc(p.id)}" style="--i:${i % 3};--vt:card-${i};--card-accent:${esc(p.accent_color || 'var(--accent)')}" aria-label="Abrir projeto ${esc(p.title)}">
        <div class="card__frame">
          <img src="${esc(imgSrc(coverOf(p), p.title, p.accent_color, p.id))}" alt="" loading="lazy" decoding="async" ${projectPh(p)}>
          <span class="card__shine"></span>
          <span class="card__arrow" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9"/></svg></span>
        </div>
        <div class="card__body">
          <div>
            <h3 class="card__title" title="${esc(p.title)}">${esc(p.title)}</h3>
            <p class="card__date">${esc(formatDate(p.project_date))}</p>
          </div>
          <div class="card__tags">${cardTags(p.tags)}</div>
        </div>
      </button>`)
    .join('');
  applyFilters(false, { resetPage: false });
}

// No card aparece só a 1ª tag; as outras viram um "+N" (o modal mostra todas)
function cardTags(tags) {
  if (!tags.length) return '';
  const [first, ...rest] = tags;
  const chip = `<span class="chip" style="--chip:${esc(first.color)}">${esc(first.name)}</span>`;
  if (!rest.length) return chip;
  const names = rest.map((t) => t.name).join(', ');
  return `${chip}<span class="chip chip--more" title="${esc(names)}" aria-label="Mais ${rest.length}: ${esc(names)}">+${rest.length}</span>`;
}


// Filtra (busca + tags) e pagina: 6 projetos por página.
// Mudar busca/tags volta para a página 1; trocar de página mantém os filtros.
function applyFilters(animate = true, { resetPage = true, paging = false } = {}) {
  if (!DATA) return;
  if (resetPage) state.page = 1;
  const q = normalizeText(state.q.trim());
  const matched = DATA.projects.filter((p) => {
    const hay = normalizeText([p.title, p.short_description, ...p.tags.map((t) => t.name)].join(' '));
    const okTag = state.tags.size === 0 || p.tags.some((t) => state.tags.has(t.slug));
    return okTag && (!q || q.split(/\s+/).every((term) => hay.includes(term)));
  });
  const pages = Math.max(1, Math.ceil(matched.length / PER_PAGE));
  state.page = Math.min(Math.max(1, state.page), pages);
  const onPage = new Set(matched.slice((state.page - 1) * PER_PAGE, state.page * PER_PAGE));

  const run = () => {
    DATA.projects.forEach((p) => {
      $(`.card[data-id="${CSS.escape(p.id)}"]`).hidden = !onPage.has(p);
    });
    $$('[data-tag]', slot('filters')).forEach((b) => b.setAttribute('aria-pressed', state.tags.has(b.dataset.tag)));
    renderActiveTags();
    renderPager(pages);
    slot('empty').hidden = matched.length > 0;
    slot('results').textContent = state.q || state.tags.size ? `${matched.length} de ${DATA.projects.length} projetos` : '';
  };
  if (paging && !reduced) pageSwap(run);
  // Filtrar rápido pula a transição anterior — isso é esperado, não é erro.
  else if (animate && document.startViewTransition && !reduced) document.startViewTransition(run).ready.catch(() => {});
  else run();

  const params = new URLSearchParams(location.search);
  state.tags.size ? params.set('tag', [...state.tags].join(',')) : params.delete('tag');
  state.q ? params.set('q', state.q) : params.delete('q');
  state.page > 1 ? params.set('p', state.page) : params.delete('p');
  const qs = params.toString();
  history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
}

// Troca de página: os cards atuais saem subindo, um a um, e os novos entram.
// A página não rola e a grade mantém a altura, então nada sai do lugar.
let swapTimer = 0;
let swapRaf = 0;
function pageSwap(run) {
  const grid = slot('grid');
  clearTimeout(swapTimer);
  cancelAnimationFrame(swapRaf);
  grid.style.height = '';
  grid.style.overflow = '';
  // 1) os cards atuais saem subindo, um a um
  const out = $$('.card:not([hidden])', grid);
  out.forEach((c, i) => {
    c.getAnimations().forEach((a) => a.cancel());
    c.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-18px) scale(.95)' }],
      { duration: 220, delay: i * 35, easing: 'cubic-bezier(.55,0,1,.45)', fill: 'forwards' });
  });
  swapTimer = setTimeout(() => {
    out.forEach((c) => c.getAnimations().forEach((a) => a.cancel()));
    // 2) troca os cards e mede a nova altura da grade (sem pintar nada no meio)
    const from = grid.offsetHeight;
    run();
    const to = grid.offsetHeight;
    grid.style.height = `${from}px`;
    // enquanto a altura muda, o que passa da grade fica escondido (efeito "cortina")
    grid.style.overflow = 'clip';
    grid.style.overflowClipMargin = '40px';
    // 3) os novos entram, um a um
    $$('.card:not([hidden])', grid).forEach((c, i) => {
      c.classList.add('is-in');
      c.animate([{ opacity: 0, transform: 'translateY(26px) scale(.95)' }, { opacity: 1, transform: 'none' }],
        { duration: 520, delay: i * 55, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' });
    });
    // 4) ao mesmo tempo a grade vai suavemente até a nova altura, e a página
    //    acompanha quadro a quadro: a paginação fica parada embaixo do mouse
    const y0 = scrollY, t0 = performance.now(), DUR = 480;
    const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / DUR);
      const h = from + (to - from) * ease(k);
      grid.style.height = `${h}px`;
      scrollTo({ top: y0 + (h - from), behavior: 'instant' });
      if (k < 1) swapRaf = requestAnimationFrame(step);
      else { grid.style.height = ''; grid.style.overflow = ''; grid.style.overflowClipMargin = ''; }
    };
    swapRaf = requestAnimationFrame(step);
  }, 220 + out.length * 35);
}


// Paginação: « Anterior · 1 2 3 · Próxima » (some quando tudo cabe em uma página)
function renderPager(pages) {
  const nav = slot('pager');
  nav.hidden = pages < 2;
  if (pages < 2) { nav.innerHTML = ''; return; }
  const cur = state.page;
  const arrow = (dir) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${dir < 0 ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'}"/></svg>`;
  // Muitas páginas: mostra a primeira, a última e as vizinhas da atual
  const nums = [];
  for (let n = 1; n <= pages; n++) {
    if (n === 1 || n === pages || Math.abs(n - cur) <= 1) nums.push(n);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  nav.innerHTML = `
    <button class="pager__step" type="button" data-page="${cur - 1}" ${cur === 1 ? 'disabled' : ''}>${arrow(-1)}<span>Anterior</span></button>
    <div class="pager__nums">${nums
      .map((n) => (n === '…'
        ? '<span class="pager__gap" aria-hidden="true">…</span>'
        : `<button class="pager__num" type="button" data-page="${n}" ${n === cur ? 'aria-current="page"' : ''} aria-label="Página ${n}">${n}</button>`))
      .join('')}</div>
    <button class="pager__step" type="button" data-page="${cur + 1}" ${cur === pages ? 'disabled' : ''}><span>Próxima</span>${arrow(1)}</button>`;
}

// ---------------------------------------------------------------------
//  Sobre + Trajetória + Footer
// ---------------------------------------------------------------------
function renderAbout(s) {
  const initials = (s.site_name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('');
  slot('about-photo').innerHTML = s.about_image_url
    ? `<img src="${esc(safeUrl(s.about_image_url))}" alt="Foto de ${esc(s.site_name)}" loading="lazy" decoding="async" ${phAttrs(s.site_name || '', null, { w: 1000, h: 1250 })}>`
    : `<div class="initials" aria-hidden="true">${esc(initials)}</div>`;

  const words = (s.about_text || '').split(/\s+/).filter(Boolean);
  const el = slot('about-text');
  el.style.setProperty('--n', words.length);
  el.innerHTML = words.map((w, i) => `<span class="w" style="--i:${i}">${esc(w)}</span>`).join(' ');

  slot('about-facts').innerHTML = [
    ['Função', s.role],
    ['Localização', s.location],
    ['E-mail', s.email && `<a href="mailto:${esc(s.email)}">${esc(s.email)}</a>`],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${k === 'E-mail' ? v : esc(v)}</dd></div>`)
    .join('');
  // Habilidades em cards com ícone (módulo carregado sob demanda)
  import('./skills.js').then(({ renderSkills }) => {
    renderSkills(slot('skills'), s.skills || []);
    observeReveals();
  });
}

const period = (e) => {
  const opts = { month: 'short', year: 'numeric' };
  const start = formatDate(e.start_date, opts);
  const end = e.is_current ? 'Atual' : formatDate(e.end_date, opts);
  return [start, end].filter(Boolean).join(' — ');
};

function renderJourney(items = []) {
  const jobs = items.filter((e) => e.kind === 'trabalho');
  slot('journey-now').innerHTML = jobs
    .map((e) => `
      <article class="job">
        <span class="job__badge">${e.is_current ? 'Trabalhando agora' : esc(period(e))}</span>
        <h3 class="job__title">${esc(e.title)}</h3>
        <p class="job__org">${esc(e.institution)}${e.is_current ? ` · desde ${esc(formatDate(e.start_date, { month: 'short', year: 'numeric' }))}` : ''}</p>
        ${e.description ? `<p class="job__desc">${esc(e.description)}</p>` : ''}
      </article>`)
    .join('');

  const step = (e) => `
    <li class="step reveal">
      <p class="step__date">${esc(period(e))}</p>
      <h4 class="step__title">${esc(e.title)}</h4>
      <p class="step__org">${esc(e.institution)}</p>
      ${e.description ? `<p class="step__desc">${esc(e.description)}</p>` : ''}
      ${e.certificate_url || e.credential_url ? `<div class="step__actions">
        ${e.certificate_url ? `<button class="btn btn--sm btn--ghost" type="button" data-cert="${esc(e.id)}">Ver certificado</button>` : ''}
        ${e.credential_url ? `<a class="btn btn--sm btn--ghost" href="${esc(safeUrl(e.credential_url))}" target="_blank" rel="noopener">Validar ↗</a>` : ''}
      </div>` : ''}
    </li>`;
  const line = '<li class="timeline__line" aria-hidden="true"><i></i></li>';
  slot('journey-formacao').innerHTML = line + items.filter((e) => e.kind === 'formacao').map(step).join('');
  slot('journey-curso').innerHTML = line + items.filter((e) => e.kind === 'curso').map(step).join('');
  $$('.timeline').forEach((t) => { t.hidden = !$('li.step', t); });
}

function renderFooter(s) {
  const mail = slot('footer-mail');
  mail.hidden = !s.email;
  mail.href = `mailto:${s.email || ''}`;
  slot('footer-mail-text').textContent = s.email || '';
  slot('year').textContent = `© ${new Date().getFullYear()}`;
}

// ---------------------------------------------------------------------
//  Modal do projeto (galeria de imagens e vídeos)
// ---------------------------------------------------------------------
const modal = $('#project-modal');
let current = null;
let mediaIndex = 0;
let lastFocus = null;

// Apresentação automática: imagem fica IMAGE_MS na tela; vídeo toca até o fim.
// Depois passa para a próxima mídia (e volta para a primeira no final).
// Qualquer navegação feita pela pessoa desliga a apresentação.
const IMAGE_MS = 4500;
let autoplay = false;
let slideTimer = 0;

function mediaHtml(m) {
  const kind = mediaKind(m);
  if (kind === 'embed') {
    let src = toEmbedUrl(m.url) || safeUrl(m.url);
    const title = esc(m.caption || 'Vídeo do projeto');
    if (src.includes('vimeo')) {
      src += (src.includes('?') ? '&' : '?') + 'autoplay=1&title=0&byline=0&portrait=0';
      return `<iframe src="${esc(src)}" title="${title}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
    }
    // YouTube sem os controles dele (título, "More videos", logo...): o site
    // põe por cima uma camada que recebe os cliques e controles próprios.
    src += (src.includes('?') ? '&' : '?') + 'autoplay=1&enablejsapi=1&playsinline=1&controls=0&disablekb=1&fs=0&iv_load_policy=3&rel=0';
    return `<div class="pm__embed">
      <div class="pm__frame"><iframe src="${esc(src)}" title="${title}" tabindex="-1" allow="autoplay; encrypted-media"></iframe></div>
      <div class="pm__shield" data-yt="toggle" aria-hidden="true"></div>
      <div class="pm__ctrl">
        <button type="button" data-yt="back" aria-label="Voltar 10 segundos"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><text x="12" y="15.5" font-size="7" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif">10</text></svg></button>
        <button type="button" class="pm__ctrl-main" data-yt="toggle" aria-label="Pausar"><svg class="i-play" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.5-6.5a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5z"/></svg><svg class="i-pause" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg></button>
        <button type="button" data-yt="fwd" aria-label="Avançar 10 segundos"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/><text x="12" y="15.5" font-size="7" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif">10</text></svg></button>
      </div>
    </div>`;
  }
  if (kind === 'video') return `<video src="${esc(safeUrl(m.url))}" controls playsinline preload="auto"></video>`;
  return `<img src="${esc(safeUrl(m.url))}" alt="${esc(m.caption || '')}" decoding="async" ${current ? phAttrs(m.caption || current.title, current.accent_color, { seed: m.id || m.url }) : ''}>`;
}

const mediaList = () => (current.media.length ? current.media : [{ type: 'image', url: coverOf(current) }]);

function stopAutoplay() {
  autoplay = false;
  clearTimeout(slideTimer);
  $('.pm__bar', modal).hidden = true;
}

function nextSlide() {
  if (autoplay && !modal.hidden) showMedia(mediaIndex + 1);
}

// Barra de tempo: anima sozinha para imagens; para vídeos segue o tempo do vídeo
function runBar(ms) {
  const bar = $('.pm__bar', modal);
  const fill = $('i', bar);
  bar.hidden = !autoplay || mediaList().length < 2 && !ms;
  fill.style.animation = 'none';
  fill.style.width = '0';
  void fill.offsetWidth;
  if (ms) fill.style.animation = `pm-fill ${ms}ms linear forwards`;
}

function showMedia(i, { user = false } = {}) {
  if (user) stopAutoplay();
  const list = mediaList();
  const prev = mediaIndex;
  mediaIndex = (i + list.length) % list.length;
  const m = list[mediaIndex];
  const viewer = slot('pm-viewer');
  clearTimeout(slideTimer);

  // Transição: a mídia atual sai deslizando e a nova entra do outro lado
  viewer.style.setProperty('--dir', i < prev ? -1 : 1);
  const old = [...viewer.children];
  old.forEach((el) => {
    el.classList.add('is-leaving');
    el.querySelector?.('video')?.pause();
    if (el.tagName === 'VIDEO') el.pause();
    setTimeout(() => el.remove(), reduced || !old.length ? 0 : 600);
  });
  viewer.insertAdjacentHTML('beforeend', mediaHtml(m));
  const el = viewer.lastElementChild;
  if (old.length) el.classList.add('is-entering');

  const kind = mediaKind(m);
  if (kind === 'video') {
    // Começa a tocar na hora (com som; se o navegador bloquear, toca mudo)
    el.play().catch(() => { el.muted = true; el.play().catch(() => {}); });
    el.addEventListener('ended', nextSlide);
    el.addEventListener('timeupdate', () => {
      if (autoplay && el.duration) $('.pm__bar i', modal).style.width = `${(el.currentTime / el.duration) * 100}%`;
    });
    runBar(0);
    if (autoplay) $('.pm__bar', modal).hidden = false;
  } else if (kind === 'embed') {
    const iframe = el.tagName === 'IFRAME' ? el : $('iframe', el);
    iframe.addEventListener('load', () => listenEmbed(iframe));
    runBar(0);
  } else if (autoplay && list.length > 1) {
    runBar(IMAGE_MS);
    slideTimer = setTimeout(nextSlide, IMAGE_MS);
  } else {
    runBar(0);
  }

  // Vídeo em tela cheia fica limpo (sem setas, miniaturas e legenda) — ver CSS .pm.has-video
  $('.pm', modal).classList.toggle('has-video', kind !== 'image');
  slot('pm-caption').textContent = m.caption || (list.length > 1 ? `${mediaIndex + 1} / ${list.length}` : '');
  $$('button', slot('pm-thumbs')).forEach((b, j) => b.setAttribute('aria-current', j === mediaIndex));
  // A faixa de miniaturas não tem barra: centraliza a ativa automaticamente.
  const thumb = $('[aria-current="true"]', slot('pm-thumbs'));
  if (thumb) slot('pm-thumbs').scrollLeft = thumb.offsetLeft - (slot('pm-thumbs').clientWidth - thumb.offsetWidth) / 2;
  $$('.pm__nav', modal).forEach((b) => { b.hidden = list.length < 2; });
}

// Expandir a mídia: o modal passa a ocupar a janela toda E o navegador entra
// em tela cheia (como o F11). Sair desfaz as duas coisas juntas. Se o navegador
// não permitir tela cheia (alguns apps bloqueiam), fica só a expansão na janela.
function setExpanded(on) {
  modal.classList.toggle('is-expanded', on);
  $('.pm', modal).classList.toggle('is-expanded', on);
  $('#pm-expand').setAttribute('aria-label', on ? 'Sair da tela cheia' : 'Tela cheia');
  $('.pm__expand-text').textContent = on ? 'Sair' : 'Tela cheia';
}
function exitExpand() {
  setExpanded(false);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
function toggleExpand() {
  if ($('.pm', modal).classList.contains('is-expanded')) return exitExpand();
  setExpanded(true);
  document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
}
// Saiu da tela cheia pelo navegador (Esc/F11): o modal também volta ao normal
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && $('.pm', modal).classList.contains('is-expanded')) setExpanded(false);
});

// YouTube/Vimeo avisam por postMessage quando o vídeo termina
function listenEmbed(iframe) {
  const w = iframe.contentWindow;
  if (!w) return;
  if (iframe.src.includes('youtube')) {
    w.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*');
    w.postMessage(JSON.stringify({ event: 'command', func: 'addEventListener', args: ['onStateChange'], id: 1, channel: 'widget' }), '*');
  } else if (iframe.src.includes('vimeo')) {
    w.postMessage({ method: 'addEventListener', value: 'ended' }, '*');
  }
}
// Mensagens dos players: fim do vídeo (avança a apresentação) e, no YouTube,
// estado e tempo atual para os controles próprios.
addEventListener('message', (e) => {
  const iframe = $$('.pm__viewer > :not(.is-leaving)').map((el) => (el.tagName === 'IFRAME' ? el : $('iframe', el))).find(Boolean);
  if (!iframe || e.source !== iframe.contentWindow) return;
  let data = e.data;
  try { if (typeof data === 'string') data = JSON.parse(data); } catch { return; }
  const wrap = iframe.closest('.pm__embed');
  const info = data?.info;
  if (wrap && info && typeof info === 'object') {
    if (typeof info.currentTime === 'number') wrap.dataset.time = info.currentTime;
    if (typeof info.playerState === 'number') {
      const paused = info.playerState !== 1 && info.playerState !== 3; // 1 tocando, 3 carregando
      wrap.classList.toggle('is-paused', paused);
      $('.pm__ctrl-main', wrap).setAttribute('aria-label', paused ? 'Continuar' : 'Pausar');
    }
  }
  const ytEnded = data?.event === 'onStateChange' ? data.info === 0 : info?.playerState === 0;
  if (ytEnded || data?.event === 'ended') nextSlide();
});

// Controles próprios do YouTube: pausar/continuar e voltar/avançar 10 segundos
function ytCommand(wrap, func, args = []) {
  $('iframe', wrap).contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args, id: 1, channel: 'widget' }), '*');
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-yt]');
  const wrap = b?.closest('.pm__embed');
  if (!wrap) return;
  const t = Number(wrap.dataset.time || 0);
  if (b.dataset.yt === 'toggle') ytCommand(wrap, wrap.classList.contains('is-paused') ? 'playVideo' : 'pauseVideo');
  if (b.dataset.yt === 'back') { ytCommand(wrap, 'seekTo', [Math.max(0, t - 10), true]); wrap.dataset.time = Math.max(0, t - 10); }
  if (b.dataset.yt === 'fwd') { ytCommand(wrap, 'seekTo', [t + 10, true]); wrap.dataset.time = t + 10; }
});


function thumbFor(m, p) {
  const kind = mediaKind(m);
  if (kind === 'image') return `<img src="${esc(safeUrl(m.url))}" alt="" loading="lazy" ${phAttrs('', p.accent_color, { seed: m.id || m.url })}>`;
  const yt = youtubeId(m.url);
  const img = yt ? `https://i.ytimg.com/vi/${yt}/mqdefault.jpg` : coverOf(p);
  return `<img src="${esc(imgSrc(img, '', p.accent_color, m.id || m.url))}" alt="" loading="lazy" ${phAttrs('', p.accent_color, { seed: m.id || m.url })}><span class="play">▶</span>`;
}

function openProject(p, { push = true } = {}) {
  current = p;
  lastFocus = document.activeElement;
  slot('pm-title').textContent = p.title;
  slot('pm-date').textContent = formatDate(p.project_date);
  slot('pm-desc').textContent = p.short_description || '';
  slot('pm-tags').innerHTML = p.tags.map((t) => `<span class="chip" style="--chip:${esc(t.color)}">${esc(t.name)}</span>`).join('');
  // Links: uma fileira de quadrados com o ícone. Com muitos links, no
  // desktop aparecem os 4 primeiros + um "+N" que abre um painel com o resto
  // (ícone + nome), assim título e texto não ficam espremidos.
  const linkData = p.links.map((l) => {
    const pf = platform(l.platform);
    return { l, pf, label: l.label || `Ver no ${pf.label}`, href: esc(safeUrl(l.url)) };
  });
  const VISIBLE = 4;
  const extra = linkData.length > VISIBLE + 1 ? linkData.slice(VISIBLE) : [];
  slot('pm-links').innerHTML = linkData
    .map(({ l, pf, label, href }) => `<a class="pm__link" style="--brand:${pf.color}" href="${href}" target="_blank" rel="noopener" aria-label="${esc(label)}">${platformIcon(l.platform, 22)}</a>`)
    .join('') + (extra.length ? `
      <button class="pm__link pm__more" type="button" aria-expanded="false" aria-label="Mais ${extra.length} links">+${extra.length}</button>
      <div class="pm__more-panel" role="menu" hidden>${extra
        .map(({ l, pf, label, href }) => `<a role="menuitem" href="${href}" target="_blank" rel="noopener"><span class="pm__more-icon" style="--brand:${pf.color}">${platformIcon(l.platform, 16)}</span>${esc(l.label || pf.label)}</a>`)
        .join('')}</div>` : '');
  slot('pm-links').classList.toggle('has-more', extra.length > 0);
  // Título muito longo: fonte um pouco menor para caber inteiro
  slot('pm-title').classList.toggle('is-long', p.title.length > 60);
  slot('pm-thumbs').innerHTML = p.media.length > 1
    ? p.media.map((m, i) => `<button type="button" data-media="${i}" aria-label="Mídia ${i + 1}">${thumbFor(m, p)}</button>`).join('')
    : '';
  slot('pm-viewer').innerHTML = '';
  slot('pm-desc').scrollTop = 0;
  autoplay = !reduced;
  mediaIndex = 0;
  showMedia(0);

  clearTimeout(modal.hideTimer);
  modal.hidden = false;
  document.documentElement.style.overflow = 'hidden';
  setTimeout(() => modal.classList.add('is-open'), 10);
  $('.pm__close', modal).focus();
  if (push) history.replaceState(null, '', `#projeto/${p.slug || p.id}`);
}

function closeModal(el = modal) {
  if (el === modal) {
    stopAutoplay();
    exitExpand();
  }
  el.classList.remove('is-open');
  document.documentElement.style.overflow = '';
  // Guarda o timer: se o modal for reaberto antes de terminar de fechar,
  // a abertura cancela este "esconder" atrasado.
  clearTimeout(el.hideTimer);
  el.hideTimer = setTimeout(() => {
    el.hidden = true;
    if (el === modal) slot('pm-viewer').innerHTML = ''; // para vídeos
  }, reduced ? 0 : 320);
  if (el === modal && location.hash.startsWith('#projeto/')) history.replaceState(null, '', `${location.pathname}${location.search}`);
  lastFocus?.focus?.();
}

function openFromHash() {
  const m = location.hash.match(/^#projeto\/(.+)$/);
  if (!m || !DATA) return;
  const p = DATA.projects.find((x) => x.slug === decodeURIComponent(m[1]) || x.id === m[1]);
  if (p && modal.hidden) openProject(p, { push: false });
}

const SQUARE = {
  check: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>',
  open: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
};

// Certificado no mesmo layout do modal de projetos: arquivo à esquerda,
// curso + "o que apliquei" à direita, botões quadrados para validar/abrir.
function openCert(id) {
  const e = DATA?.education.find((x) => String(x.id) === String(id));
  if (!e?.certificate_url) return;
  const cm = $('#cert-modal');
  lastFocus = document.activeElement;
  const url = safeUrl(e.certificate_url);
  const isPdf = /\.pdf(\?|$)/i.test(url);
  // O certificado aparece sempre numa moldura 16:9 deitada
  slot('cm-viewer').innerHTML = `<div class="cm-frame">${isPdf
    ? `<iframe src="${esc(url)}" title="Certificado de ${esc(e.title)}"></iframe>`
    : `<img src="${esc(url)}" alt="Certificado de ${esc(e.title)}" ${phAttrs('Certificado', null, { seed: e.id, w: 1600, h: 900 })}>`}</div>`;
  slot('cm-date').textContent = period(e);
  slot('cm-title').textContent = e.title;
  slot('cm-title').classList.toggle('is-long', e.title.length > 60);
  slot('cm-tags').innerHTML = `<span class="chip" style="--chip:var(--accent-2)">${esc(e.institution)}</span>`;
  const text = e.applied_text || e.description || '';
  slot('cm-label').hidden = !e.applied_text;
  slot('cm-desc').textContent = text;
  slot('cm-desc').scrollTop = 0;
  slot('cm-links').innerHTML = [
    e.credential_url ? `<a class="pm__link" style="--brand:#1f9d48" href="${esc(safeUrl(e.credential_url))}" target="_blank" rel="noopener" aria-label="Validar certificado">${SQUARE.check}</a>` : '',
    `<a class="pm__link" style="--brand:var(--accent)" href="${esc(url)}" target="_blank" rel="noopener" aria-label="Abrir arquivo">${SQUARE.open}</a>`,
  ].join('');
  clearTimeout(cm.hideTimer);
  cm.hidden = false;
  document.documentElement.style.overflow = 'hidden';
  setTimeout(() => cm.classList.add('is-open'), 10);
  $('.pm__close', cm).focus();
}

// Mantém o Tab dentro do modal aberto.
function trapFocus(e, el) {
  const items = $$('a[href], button:not([hidden]), iframe, video, input', el).filter((x) => x.offsetParent !== null);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// ---------------------------------------------------------------------
//  Interações e efeitos
// ---------------------------------------------------------------------
// Troca de tema: liga por um instante as transições que normalmente ficam
// desligadas (ex.: a imagem do destaque, que segue a rolagem sem atraso)
let themingTimer = 0;
document.addEventListener('themechange', () => {
  document.documentElement.classList.add('is-theming');
  clearTimeout(themingTimer);
  themingTimer = setTimeout(() => document.documentElement.classList.remove('is-theming'), 1100);
});

function bindStaticUI() {
  $('#theme-toggle').addEventListener('click', toggleTheme);
  // O espaço começa a girar antes mesmo dos dados chegarem.
  blackHole = createBlackHole($('.hero__space'), { reduced });

  // Pesquisa com debounce + atalho "/"
  let t;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => { state.q = e.target.value; applyFilters(); }, 140);
    const box = $('#search-box');
    box.classList.remove('is-typing');
    void box.offsetWidth; // reinicia a animação do ícone
    box.classList.add('is-typing');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/input|textarea/i.test(document.activeElement.tagName) && modal.hidden && $('#cert-modal').hidden) {
      e.preventDefault();
      $('#search').focus();
    }
  });

  // Botão "Filtrar": abre/fecha o painel de tags
  const filterBtn = $('#filter-btn');
  const panel = $('#filter-panel');
  const setPanel = (open) => {
    panel.hidden = !open;
    filterBtn.setAttribute('aria-expanded', open);
    if (open) $('[data-tag]', panel)?.focus();
  };
  filterBtn.addEventListener('click', () => setPanel(panel.hidden));
  document.addEventListener('click', (e) => { if (!panel.hidden && !e.target.closest('.filter')) setPanel(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) { setPanel(false); filterBtn.focus(); }
  });
  slot('filters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tag]');
    if (!b) return;
    const tag = b.dataset.tag;
    state.tags.has(tag) ? state.tags.delete(tag) : state.tags.add(tag);
    applyFilters();
  });
  $('#filter-clear').addEventListener('click', () => { state.tags.clear(); applyFilters(); });
  slot('pager').addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (!b || b.disabled) return;
    state.page = Number(b.dataset.page);
    applyFilters(true, { resetPage: false, paging: true });
  });
  slot('active-tags').addEventListener('click', (e) => {
    const b = e.target.closest('[data-untag]');
    if (b) { state.tags.delete(b.dataset.untag); applyFilters(); }
  });
  $('#clear-filters').addEventListener('click', () => {
    state.q = '';
    state.tags.clear();
    $('#search').value = '';
    applyFilters();
  });

  slot('grid').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card) openProject(DATA.projects.find((p) => p.id === card.dataset.id));
  });

  document.addEventListener('click', (e) => {
    const cert = e.target.closest('[data-cert]');
    if (cert) openCert(cert.dataset.cert);
  });

  // Modal: fechar, navegar, miniaturas, teclado
  $$('.modal').forEach((m) => {
    m.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) closeModal(m);
      const step = e.target.closest('[data-step]');
      if (step) showMedia(mediaIndex + Number(step.dataset.step), { user: true });
      const th = e.target.closest('[data-media]');
      if (th) showMedia(Number(th.dataset.media), { user: true });
    });
  });
  document.addEventListener('keydown', (e) => {
    const open = $$('.modal').find((m) => !m.hidden);
    if (!open) return;
    if (e.key === 'Escape') {
      if (open === modal && $('.pm', modal).classList.contains('is-expanded')) exitExpand();
      else closeModal(open);
    }
    if (e.key === 'Tab') trapFocus(e, open);
    if (open === modal && e.key === 'ArrowRight') showMedia(mediaIndex + 1, { user: true });
    if (open === modal && e.key === 'ArrowLeft') showMedia(mediaIndex - 1, { user: true });
  });
  // Swipe na galeria (celular)
  let sx = null;
  $('.pm__stage').addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
  $('.pm__stage').addEventListener('touchend', (e) => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx;
    if (Math.abs(dx) > 50) showMedia(mediaIndex + (dx < 0 ? 1 : -1), { user: true });
    sx = null;
  });
  $('#pm-expand').addEventListener('click', toggleExpand);
  // Painel "+N" dos links do projeto
  const morePanel = (open) => {
    const btn = $('.pm__more', modal);
    const panel = $('.pm__more-panel', modal);
    if (!btn || !panel) return;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', open);
  };
  modal.addEventListener('click', (e) => {
    if (e.target.closest('.pm__more')) morePanel($('.pm__more-panel', modal).hidden);
    else if (!e.target.closest('.pm__more-panel')) morePanel(false);
  });
  document.addEventListener('keydown', (e) => {
    const panel = $('.pm__more-panel', modal);
    if (e.key === 'Escape' && panel && !panel.hidden) {
      morePanel(false);
      e.stopImmediatePropagation(); // fecha só o painel, não o modal
    }
  }, true);
  // Duplo clique na imagem também expande. No vídeo, não: lá cada clique é
  // pausar/continuar, e dois cliques seguidos não podem virar tela cheia.
  $('.pm__stage').addEventListener('dblclick', (e) => {
    if (e.target.closest('button') || $('.pm', modal).classList.contains('has-video')) return;
    toggleExpand();
  });
  // Mexer no vídeo (play/pausa/barra) também conta como escolha da pessoa
  slot('pm-viewer').addEventListener('pointerdown', () => { if (autoplay) stopAutoplay(); });
  window.addEventListener('hashchange', openFromHash);

  initNav();
  initScrollbar();
  initMarquee();
  initEasterEggs();
  initSearchHint();
  // Celular/touch: tocar no buraco negro também dispara a sucção
  $('.hero').addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' && $('.hero__inner').classList.contains('is-settled')) checkVortex(e.clientX, e.clientY, false);
  });
  initContact();
  if (finePointer && !reduced) {
    initCursor();
    initPointerEffects();
  }
}

// Dock: encolhe um pouco ao descer; o fundo colorido desliza até a seção ativa;
// os ícones crescem conforme o mouse se aproxima (como o Dock do macOS).
const SECTIONS = ['topo', 'destaque', 'projetos', 'sobre', 'trajetoria', 'contato'];
let activeId = 'topo';

function movePill() {
  const pill = $('.dock__pill');
  const link = $(`#nav-links a[href="#${activeId}"]`);
  if (!link || link.hidden) return pill.style.setProperty('--po', 0);
  pill.style.setProperty('--px', `${link.offsetLeft}px`);
  pill.style.setProperty('--po', 1);
}

function initNav() {
  const dock = $('#dock');
  addEventListener('resize', movePill, { passive: true });

  const hero = $('.hero');
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      activeId = en.target === hero ? 'topo' : en.target.id;
      $$('#nav-links a').forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === `#${activeId}`));
      movePill();
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  io.observe(hero);
  SECTIONS.slice(1).forEach((id) => io.observe(document.getElementById(id)));

  // Efeitos de mouse: bolha de vidro, luz na borda e pulinho dos ícones
  if (!finePointer || reduced) return;
  const hover = $('.dock__hover', dock);
  const items = () => $$('.dock__links a, .dock__item', dock).filter((el) => el.offsetParent);
  // Bolha-ímã: gruda no ícone que está sob o mouse. Enquanto o mouse se mexe
  // em cima do ícone, ela é "puxada" na direção dele (estica sem soltar).
  // Ao trocar de ícone ela se solta e pula com um tranco elástico, e chega
  // achatando (o "clac" do ímã). Saindo da barra, ela estica até se soltar.
  let current = null, inside = false;
  const center = (el, r = el.getBoundingClientRect()) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2, size: r.width });
  const snapTo = (el) => {
    hover.style.left = `${el.offsetLeft + (el.closest('.dock__links')?.offsetLeft || 0)}px`;
    hover.style.top = `${el.offsetTop + (el.closest('.dock__links')?.offsetTop || 0)}px`;
  };
  // puxão: até 7px na direção do mouse, esticando no mesmo sentido
  const pull = (e, rect) => {
    if (!current) return;
    const c = center(current, rect);
    const dx = e.clientX - c.x, dy = e.clientY - c.y;
    const dist = Math.hypot(dx, dy) || 1;
    const k = Math.min(dist, c.size) / c.size; // 0 no centro, 1 na borda
    const ang = Math.atan2(dy, dx) * 180 / Math.PI;
    hover.style.setProperty('--tx', `${(dx / dist) * k * 7}px`);
    hover.style.setProperty('--ty', `${(dy / dist) * k * 7}px`);
    hover.style.setProperty('--ang', `${ang}deg`);
    hover.style.setProperty('--sx', (1 + k * 0.2).toFixed(3));
    hover.style.setProperty('--sy', (1 - k * 0.1).toFixed(3));
  };
  const relax = () => ['--tx', '--ty', '--sx', '--sy'].forEach((v) => hover.style.removeProperty(v));
  // "clac": chega achatando e volta ao normal com um quique
  const clack = () => hover.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.16, .84)', offset: 0.3 }, { transform: 'scale(.95, 1.05)', offset: 0.65 }, { transform: 'scale(1)' }],
    { duration: 420, easing: 'ease-out', composite: 'add' },
  );
  let clackTimer = 0;
  dock.addEventListener('pointermove', (e) => {
    // lê todas as posições antes de escrever qualquer coisa (sem forçar layout no meio)
    const box = dock.getBoundingClientRect();
    const list = items().map((el) => ({ el, r: el.getBoundingClientRect() }));
    dock.style.setProperty('--gx', `${e.clientX - box.left}px`);
    // ícone mais perto do mouse ganha a bolha; os vizinhos reagem menos
    let best = null, bestD = Infinity, bestR = null;
    list.forEach(({ el, r }) => {
      const d = Math.abs(e.clientX - (r.left + r.width / 2));
      el.style.setProperty('--m', Math.max(0, 1 - d / 64).toFixed(3));
      if (d < bestD) { bestD = d; best = el; bestR = r; }
    });
    if (!best) return;
    if (best !== current) {
      // ao entrar na barra a bolha aparece direto no ícone; entre ícones, pula
      hover.classList.toggle('is-instant', !inside);
      relax();
      snapTo(best);
      clearTimeout(clackTimer);
      clackTimer = setTimeout(clack, inside ? 200 : 0);
      current = best;
      inside = true;
    }
    pull(e, bestR);
  });
  dock.addEventListener('pointerleave', (e) => {
    // soltando: estica na direção da saída e some
    if (current) {
      const c = center(current);
      const dx = e.clientX - c.x, dy = e.clientY - c.y;
      const dist = Math.hypot(dx, dy) || 1;
      const ex = (dx / dist) * 18, ey = (dy / dist) * 18;
      relax();
      hover.animate(
        [{ transform: 'translate(0, 0) scale(1)' }, { transform: `translate(${ex * 0.6}px, ${ey * 0.6}px) scale(1.25, .78)`, offset: 0.35 }, { transform: `translate(${ex}px, ${ey}px) scale(.35)` }],
        { duration: 340, easing: 'cubic-bezier(.5, 0, .75, 0)', composite: 'add' },
      );
    }
    inside = false;
    current = null;
    clearTimeout(clackTimer);
    items().forEach((el) => el.style.setProperty('--m', 0));
  });
}

// Barra de rolagem própria: o indicador estica na direção da rolagem conforme
// a velocidade e volta ao tamanho com uma mola (um leve quique). Arrastar e
// clicar na trilha funcionam como na barra nativa. Só com mouse.
function initScrollbar() {
  if (!finePointer) return;
  const bar = $('.scrollbar');
  const thumb = $('.scrollbar__thumb', bar);
  document.documentElement.classList.add('has-scrollbar');
  bar.hidden = false;
  let lastY = scrollY, s = 0, sv = 0, dir = 1, raf = 0, drag = null;

  const metrics = () => {
    const vh = innerHeight, doc = document.documentElement.scrollHeight;
    const h = Math.max(44, (vh * vh) / doc);
    return { vh, max: Math.max(1, doc - vh), h, room: vh - h };
  };
  const render = () => {
    const { max, h, room } = metrics();
    const y = (scrollY / max) * room;
    // estica para trás (o lado de onde veio), sem sair da trilha
    const extra = Math.min(s, room);
    const top = dir > 0 ? Math.max(0, y - extra) : y;
    const height = Math.min(h + extra, innerHeight - top);
    thumb.style.height = `${height.toFixed(1)}px`;
    thumb.style.transform = `translateY(${top.toFixed(1)}px) scaleX(${(1 - Math.min(s, 160) / 500).toFixed(3)})`;
    thumb.style.setProperty('--s', Math.min(1, s / 80).toFixed(2));
    // some quando a página não rola ou um modal travou a rolagem
    bar.classList.toggle('is-off', max <= 1 || document.documentElement.style.overflow === 'hidden');
  };
  const tick = () => {
    const dy = scrollY - lastY;
    lastY = scrollY;
    if (dy) dir = Math.sign(dy);
    // alvo do esticão: proporcional à velocidade; a mola leva até ele e volta
    const target = reduced || drag ? 0 : Math.min(Math.abs(dy) * 2.2, 140);
    sv = (sv + (target - s) * 0.2) * 0.72;
    s = Math.max(0, s + sv);
    render();
    raf = s > 0.3 || Math.abs(sv) > 0.1 || dy ? requestAnimationFrame(tick) : 0;
  };
  const kick = () => { raf ||= requestAnimationFrame(tick); };
  addEventListener('scroll', kick, { passive: true });
  addEventListener('resize', kick, { passive: true });
  new ResizeObserver(kick).observe(document.body);
  new MutationObserver(kick).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });

  // Arrastar o indicador / clicar na trilha
  bar.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const { max, room } = metrics();
    const r = thumb.getBoundingClientRect();
    if (e.target !== thumb) {
      // clique na trilha: leva o centro do indicador até o ponto clicado
      const y = Math.min(room, Math.max(0, e.clientY - r.height / 2));
      scrollTo({ top: (y / room) * max, behavior: reduced ? 'auto' : 'smooth' });
      return;
    }
    drag = { y: e.clientY, start: scrollY };
    bar.classList.add('is-dragging');
    bar.setPointerCapture(e.pointerId);
    document.documentElement.style.scrollBehavior = 'auto';
  });
  bar.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { max, room } = metrics();
    scrollTo(0, drag.start + ((e.clientY - drag.y) / room) * max);
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    bar.classList.remove('is-dragging');
    document.documentElement.style.scrollBehavior = '';
  };
  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', end);
  render();
}

// Revelações: animam ao entrar na tela e "rebobinam" quando saem dela por
// completo (para cima ou para baixo), então animam de novo ao voltar.
let revealIO, hideIO;
function observeReveals() {
  if (reduced) return $$('.reveal').forEach((el) => el.classList.add('is-in'));
  revealIO ??= new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) en.target.classList.add('is-in'); });
  }, { rootMargin: '0px 0px -8% 0px' });
  // só esconde quando já está 80px fora da tela. Escondido, o bloco desce 40px
  // (translateY do .reveal); sem essa folga, um bloco que acabou de sair por
  // cima voltaria a entrar na tela ao descer e ficaria piscando na borda.
  hideIO ??= new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (!en.isIntersecting) en.target.classList.remove('is-in'); });
  }, { rootMargin: '80px 0px' });
  $$('.reveal:not([data-revealing])').forEach((el) => {
    el.dataset.revealing = '';
    revealIO.observe(el);
    hideIO.observe(el);
  });
}

// Motor de scroll: só calcula elementos visíveis e escreve --p (0..1).
let scrollReady = false;
function initScrollEffects() {
  if (reduced || scrollReady) return;
  scrollReady = true;
  const visible = new Set();

  const clamp = (v) => Math.min(1, Math.max(0, v));
  const progress = {
    hero: (r, vh) => clamp(-r.top / vh),
    // Começa assim que a seção entra na tela e termina no fim da parte fixa
    feature: (r, vh) => clamp((vh - r.top) / r.height),
    words: (r, vh) => clamp((vh * 0.85 - r.top) / (r.height + vh * 0.35)),
    line: (r, vh) => clamp((vh * 0.75 - r.top) / r.height),
  };
  let ticking = false;
  const update = () => {
    ticking = false;
    const vh = innerHeight;
    // lê a posição de todos antes de escrever --p em qualquer um
    const rects = [...visible].map((el) => [el, el.getBoundingClientRect()]);
    rects.forEach(([el, r]) => {
      const p = progress[el.dataset.scroll](r, vh);
      el.style.setProperty('--p', p.toFixed(4));
      if (el.dataset.scroll === 'hero') blackHole?.setProgress(p); // rolar = buraco engole mais rápido
      if (el.dataset.scroll === 'feature') portal?.update();      // o portal cresce com a rolagem
    });
  };
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
  // Ao entrar OU sair da tela, recalcula: saltos (âncoras da dock, voltar no navegador)
  // não disparam vários eventos de scroll, e o elemento ficaria preso no meio do efeito.
  const set = (el) => {
    const p = progress[el.dataset.scroll](el.getBoundingClientRect(), innerHeight);
    el.style.setProperty('--p', p.toFixed(4));
  };
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) visible.add(en.target);
      else { visible.delete(en.target); set(en.target); }
    });
    onScroll();
  });
  $$('[data-scroll]').forEach((el) => io.observe(el));
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll, { passive: true });
  setTimeout(update, 50);
}

// Cursor: o ponto acompanha o mouse na hora; o anel vem atrás com mola,
// gira na direção do movimento e estica conforme a velocidade.
function initCursor() {
  const cur = $('.cursor');
  const dot = $('.cursor__dot');
  const ring = $('.cursor__ring');
  let x = -100, y = -100, rx = x, ry = y, vx = 0, vy = 0, moving = false;
  // Ímã: em botões e links pequenos o anel gruda no elemento (do tamanho e
  // formato dele), fica sendo puxado de leve na direção do mouse, chega com
  // um "clac" e, ao sair, estica até se soltar. A barra flutuante tem o
  // próprio ímã, então fica de fora.
  let stuck = null;
  const MAGNET = 'a, button, [role="button"]';
  const kick = () => { if (!moving) { moving = true; requestAnimationFrame(loop); } };
  // Solta se o mouse saiu de cima do elemento (com 12px de tolerância) —
  // não depende só do "pointerover", que pode não chegar (elementos que se
  // mexem com a rolagem, camadas por cima, mouse rápido demais).
  const outside = () => {
    if (!stuck) return false;
    const r = stuck.getBoundingClientRect();
    return !stuck.isConnected || r.width === 0
      || x < r.left - 12 || x > r.right + 12 || y < r.top - 12 || y > r.bottom + 12;
  };
  addEventListener('pointermove', (e) => {
    x = e.clientX;
    y = e.clientY;
    dot.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    cur.classList.remove('is-hidden');
    if (outside()) { unstick(); cur.classList.remove('is-link'); }
    kick();
  }, { passive: true });
  addEventListener('scroll', () => { if (outside()) unstick(); if (stuck) kick(); }, { passive: true });
  document.addEventListener('pointerleave', () => { unstick(); cur.classList.add('is-hidden'); });
  addEventListener('pointerdown', () => cur.classList.add('is-down'));
  addEventListener('pointerup', () => cur.classList.remove('is-down'));

  const stretchAnim = (sx, sy, ang, ms) => ring.animate(
    [{ transform: 'none' }, { transform: `rotate(${ang}rad) scale(${sx}, ${sy}) rotate(${-ang}rad)`, offset: 0.35 }, { transform: 'none' }],
    { duration: ms, easing: 'ease-out', composite: 'add' },
  );
  function stick(el) {
    stuck = el;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    // o anel vira uma "capa" do elemento, com folga de 10px
    ring.style.setProperty('--sw', `${r.width + 14}px`);
    ring.style.setProperty('--sh', `${r.height + 14}px`);
    const rad = parseFloat(cs.borderTopLeftRadius) || 0;
    ring.style.setProperty('--sr', rad >= Math.min(r.width, r.height) / 2 ? '999px' : `${rad + 7}px`);
    cur.classList.add('is-stuck');
    // "clac" quando encaixa
    setTimeout(() => stuck === el && stretchAnim(1.08, 0.9, 0, 360), 140);
    kick();
  }
  function unstick() {
    if (!stuck) return;
    const r = stuck.getBoundingClientRect();
    const ang = Math.atan2(y - (r.top + r.height / 2), x - (r.left + r.width / 2));
    stuck = null;
    cur.classList.remove('is-stuck');
    // soltando: estica na direção em que o mouse saiu
    stretchAnim(1.35, 0.7, ang, 380);
    kick();
  }

  function loop() {
    // alvo: o mouse — ou, grudado, o centro do elemento puxado 18% na direção do mouse
    let tx = x, ty = y;
    if (stuck) {
      const r = stuck.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      tx = cx + (x - cx) * 0.18;
      ty = cy + (y - cy) * 0.18;
    }
    // Mola amortecida (dá o leve "balanço" ao parar)
    vx = (vx + (tx - rx) * 0.2) * 0.62;
    vy = (vy + (ty - ry) * 0.2) * 0.62;
    rx += vx;
    ry += vy;
    const speed = Math.hypot(vx, vy);
    const free = !stuck && !cur.classList.contains('is-view') && !cur.classList.contains('is-text');
    const stretch = free ? Math.min(speed / 30, 0.6) : 0;
    const angle = free ? Math.atan2(vy, vx) : 0;
    ring.style.transform = `translate3d(${rx}px, ${ry}px, 0) translate(-50%, -50%) rotate(${angle}rad) scale(${1 + stretch}, ${1 - stretch * 0.5})`;
    // Para o loop quando o anel alcança o ponto — zero custo com o mouse parado.
    if (speed < 0.05 && Math.abs(tx - rx) < 0.3 && Math.abs(ty - ry) < 0.3) { moving = false; return; }
    requestAnimationFrame(loop);
  }

  document.addEventListener('pointerover', (e) => {
    const view = e.target.closest('.card, .feature__media');
    const text = !view && e.target.closest('input[type="search"], input[type="text"], textarea');
    const link = !view && !text && e.target.closest(MAGNET);
    cur.classList.toggle('is-view', Boolean(view));
    cur.classList.toggle('is-text', Boolean(text));
    cur.classList.toggle('is-link', Boolean(link));
    // só elementos pequenos (botões, ícones, chips, links); nada da barra flutuante
    const r = link ? link.getBoundingClientRect() : null;
    const magnetic = link && !link.closest('.dock') && r.width <= 280 && r.height <= 90;
    if (magnetic && link !== stuck) { if (stuck) unstick(); stick(link); }
    else if (!magnetic && stuck) unstick();
  });
}

// ---------------------------------------------------------------------
//  Órbita: chegar perto do buraco negro faz ele capturar o hero inteiro
//  (letras, bolinha verde, botão). Tudo entra em órbita junto com o disco,
//  e depois volta para o lugar letra por letra, na ordem de leitura.
// ---------------------------------------------------------------------
let vortexState = 'idle'; // idle → orbit → idle
let vortexArmed = true;   // só dispara de novo depois que o cursor sai de perto

function holeOnScreen() {
  const h = blackHole?.getHole();
  if (!h) return null;
  const r = $('.hero__space').getBoundingClientRect();
  return { x: r.left + h.x, y: r.top + h.y, r: h.r };
}

function checkVortex(x, y, isMouse) {
  if (reduced) return;
  const hole = holeOnScreen();
  if (!hole) return;
  const d = Math.hypot(x - hole.x, y - hole.y);
  const zone = Math.max(hole.r * 1.5, 60);
  $('.cursor').classList.toggle('is-hole', d < zone * 1.8 && vortexState === 'idle');
  if (!isMouse || d > zone * 2.2) vortexArmed = true;
  if (d < zone && vortexArmed && vortexState === 'idle') {
    vortexArmed = false;
    isWhiteHole() ? startRepel() : startOrbit();
  }
}

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);
const ORBIT = { capture: 1.0, hold: 1.7, fly: 0.9, stagger: 0.007, flat: 0.38 };

function startOrbit() {
  vortexState = 'orbit';
  const hero = $('.hero');
  hero.classList.add('is-orbit');
  $('.cursor').classList.remove('is-hole');
  blackHole.capture();

  // Tudo em coordenadas da página, para a rolagem durante a animação não desalinhar
  const sy0 = scrollY;
  const hole0 = holeOnScreen();
  const items = [$('.hero__logo'), ...$$('.hero__inner .c'), $('.status__dot'), $('.hero__cta .btn'), $('.hero__scroll')]
    .filter((el) => el && el.offsetParent !== null)
    .map((el, i) => {
      const r = el.getBoundingClientRect();
      const ox = r.left + r.width / 2;
      const oy = r.top + r.height / 2 + sy0;
      const ring = 1.6 + Math.random() * 2;   // raio da órbita (× raio do buraco)
      // Em órbita as letras grandes encolhem até um tamanho máximo (menor no celular)
      const fs = el.classList.contains('c') ? parseFloat(getComputedStyle(el).fontSize) : 0;
      const shrink = fs ? Math.min(1, (innerWidth < 700 ? 26 : 64) / fs) : (innerWidth < 700 ? 0.7 : 1);
      el.style.transition = 'none';
      el.style.setProperty('--f', 0);
      return {
        el, ox, oy, ring, shrink, order: i,
        // Entra perto do lado em que está, espalhado para formar um anel completo
        a0: Math.atan2((oy - sy0 - hole0.y) / ORBIT.flat, ox - hole0.x) + (Math.random() - 0.5) * Math.PI * 1.6,
        w: (3.4 + Math.random() * 1.4) / Math.pow(ring, 1.5),            // mais perto = gira mais rápido
        delay: Math.random() * 0.25,
        spin: (Math.random() - 0.5) * 50,
      };
    });

  const t0 = performance.now();
  const releaseAt = ORBIT.capture + ORBIT.hold;
  let released = false;

  const frame = (now) => {
    const T = (now - t0) / 1000;
    const h = holeOnScreen();
    const hx = h.x, hy = h.y + scrollY;
    let done = true;

    items.forEach((o) => {
      const t = Math.max(0, T - o.delay);
      const a = o.a0 + o.w * t;
      const rr = o.ring * h.r;
      const px = hx + Math.cos(a) * rr;
      const py = hy + Math.sin(a) * rr * ORBIT.flat;
      const depth = (Math.sin(a) + 1) / 2;           // 0 = atrás do buraco, 1 = na frente
      const behind = Math.sin(a) < 0 && Math.abs(px - hx) < h.r * 1.05;
      const orbitScale = (0.5 + depth * 0.35) * o.shrink;
      const orbitRot = o.spin + Math.cos(a) * 25;
      const back = T - releaseAt - o.order * ORBIT.stagger;
      let x, y, s, rot, op;

      if (back <= 0) {
        // Captura: curva até a órbita (sobe um pouco no caminho)
        const k = easeInOut(Math.min(1, t / ORBIT.capture));
        x = o.ox + (px - o.ox) * k;
        y = o.oy + (py - o.oy) * k - Math.sin(k * Math.PI) * 70;
        s = 1 + (orbitScale - 1) * k;
        rot = orbitRot * k;
        op = 1 - (behind ? 0.85 : 0.15 * (1 - depth)) * k;
        done = false;
      } else {
        // Volta: sai de onde está na órbita e pousa no lugar com um quique elástico
        o.from ||= { x: px, y: py, s: orbitScale, rot: orbitRot };
        const k = Math.min(1, back / ORBIT.fly);
        const e = easeOutBack(k);
        x = o.from.x + (o.ox - o.from.x) * e;
        y = o.from.y + (o.oy - o.from.y) * e - Math.sin(k * Math.PI) * 90;
        s = o.from.s + (1 - o.from.s) * e;
        rot = o.from.rot * (1 - e);
        op = Math.min(1, 0.35 + k * 2);
        if (k < 1) done = false;
      }
      o.el.style.transform = `translate(${(x - o.ox).toFixed(1)}px, ${(y - o.oy).toFixed(1)}px) rotate(${rot.toFixed(1)}deg) scale(${s.toFixed(3)})`;
      o.el.style.opacity = op.toFixed(3);
    });

    if (!released && T >= releaseAt) {
      released = true;
      blackHole.release();
    }
    if (released && done) {
      items.forEach((o) => {
        o.el.style.transform = '';
        o.el.style.opacity = '';
        o.el.style.transition = '';
      });
      hero.classList.remove('is-orbit');
      vortexState = 'idle';
      return;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// Buraco branco (tema claro): em vez de capturar, ele expele o hero. Uma onda
// sai do centro e arremessa letras, bolinha e botão para longe (primeiro os
// mais próximos); eles flutuam um instante e voltam ao lugar, letra por letra.
const REPEL = { out: 0.75, hold: 1.5, fly: 0.9, stagger: 0.007 };

function startRepel() {
  vortexState = 'orbit';
  const hero = $('.hero');
  hero.classList.add('is-orbit');
  $('.cursor').classList.remove('is-hole');
  blackHole.release();

  const hole = holeOnScreen();
  const items = [$('.hero__logo'), ...$$('.hero__inner .c'), $('.status__dot'), $('.hero__cta .btn'), $('.hero__scroll')]
    .filter((el) => el && el.offsetParent !== null)
    .map((el, i) => {
      const r = el.getBoundingClientRect();
      const dx = r.left + r.width / 2 - hole.x, dy = r.top + r.height / 2 - hole.y;
      const d = Math.hypot(dx, dy) || 1;
      // quem está perto do buraco voa mais longe
      const dist = 90 + Math.random() * 120 + Math.max(0, 700 - d) * 0.3;
      el.style.transition = 'none';
      el.style.setProperty('--f', 0);
      return {
        el, order: i,
        tx: (dx / d) * dist, ty: (dy / d) * dist,
        delay: d * 0.00035,                   // a onda leva um tempo até chegar
        spin: (Math.random() - 0.5) * 220,
      };
    });

  const t0 = performance.now();
  const backAt = REPEL.out + REPEL.hold;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  const frame = (now) => {
    const T = (now - t0) / 1000;
    let done = true;
    items.forEach((o) => {
      const t = Math.max(0, T - o.delay);
      const back = T - backAt - o.order * REPEL.stagger;
      let k, x, y, s, rot, op;
      if (back <= 0) {
        // empurrado para fora e depois deriva devagar, girando
        k = easeOut(Math.min(1, t / REPEL.out));
        const drift = 1 + Math.max(0, t - REPEL.out) * 0.06;
        x = o.tx * k * drift;
        y = o.ty * k * drift;
        s = 1 - 0.3 * k;
        rot = o.spin * k + Math.max(0, t - REPEL.out) * o.spin * 0.1;
        op = 1 - 0.45 * k;
        done = false;
      } else {
        // volta ao lugar com um quique elástico
        o.from ||= { x: o.tx * (1 + REPEL.hold * 0.06), y: o.ty * (1 + REPEL.hold * 0.06), rot: o.spin * (1 + REPEL.hold * 0.1) };
        k = Math.min(1, back / REPEL.fly);
        const e = easeOutBack(k);
        x = o.from.x * (1 - e);
        y = o.from.y * (1 - e);
        s = 0.7 + 0.3 * e;
        rot = o.from.rot * (1 - e);
        op = Math.min(1, 0.55 + k * 2);
        if (k < 1) done = false;
      }
      o.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${rot.toFixed(1)}deg) scale(${s.toFixed(3)})`;
      o.el.style.opacity = op.toFixed(3);
    });
    if (done) {
      items.forEach((o) => {
        o.el.style.transform = '';
        o.el.style.opacity = '';
        o.el.style.transition = '';
      });
      hero.classList.remove('is-orbit');
      vortexState = 'idle';
      return;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// Gravidade em todas as letras do hero: as perto do cursor são puxadas até ele
// (ou empurradas, no tema claro).
function initHeroGravity() {
  const hero = $('.hero');
  const inner = $('.hero__inner');
  let chars = [], frame = 0, mx = 0, my = 0;
  // As posições ficam guardadas em relação ao bloco do texto, e não à página:
  // o bloco desce e encolhe com a rolagem (--p), então a cada quadro só se lê a
  // posição dele e se soma (sem medir letra por letra de novo).
  const measure = () => {
    const ir = inner.getBoundingClientRect(), k = ir.width / inner.offsetWidth || 1;
    // letras + o gato da marca + a bolinha verde do "disponível"
    chars = [$('.hero__logo', inner), ...$$('.c', inner), $('.status__dot', inner)].filter(Boolean).map((el) => {
      const r = el.getBoundingClientRect();
      return { el, ox: (r.left + r.width / 2 - ir.left) / k, oy: (r.top + r.height / 2 - ir.top) / k };
    });
  };
  const apply = () => {
    frame = 0;
    if (vortexState !== 'idle') return; // o buraco negro está no controle
    const RANGE = 260, white = isWhiteHole();
    const ir = inner.getBoundingClientRect(), k = ir.width / inner.offsetWidth || 1;
    chars.forEach((c) => {
      const dx = mx - (ir.left + c.ox * k), dy = my - (ir.top + c.oy * k);
      gravity(c.el, dx, dy, Math.max(0, 1 - Math.hypot(dx, dy) / RANGE), RANGE, white);
    });
  };
  hero.addEventListener('pointerenter', measure);
  addEventListener('resize', () => { chars = []; });
  hero.addEventListener('pointermove', (e) => {
    blackHole?.setPointer(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5);
    if (!inner.classList.contains('is-settled')) return;
    checkVortex(e.clientX, e.clientY, true);
    if (vortexState !== 'idle') return;
    // mede de novo se o conteúdo foi redesenhado (cache → dados novos)
    if (!chars.length || chars.some((c) => !c.el.isConnected)) measure();
    mx = e.clientX;
    my = e.clientY;
    frame ||= requestAnimationFrame(apply);
  });
  hero.addEventListener('pointerleave', () => {
    blackHole?.setPointer(0, 0);
    $('.cursor').classList.remove('is-hole');
    if (vortexState !== 'idle') return;
    chars.forEach((c) => { c.el.style.transform = ''; c.el.style.setProperty('--f', 0); });
  });
}

// Contato: letras puxadas (ou empurradas, no claro) pelo cursor, como no hero, e o fundo do
// espaço-tempo, que só é baixado quando a seção está chegando perto.
function initContact() {
  const footer = $('.footer');
  const cta = $('.footer__cta');
  let space = null;
  const io = new IntersectionObserver(([en]) => {
    if (!en.isIntersecting) return;
    io.disconnect();
    import('./spacetime.js').then(({ createSpacetime }) => { space = createSpacetime($('.footer__space'), { reduced }); });
  }, { rootMargin: '600px 0px' });
  io.observe(footer);
  // o fundo cobre só a parte de cima (título e botão), até a linha divisória
  const fit = () => footer.style.setProperty('--space-h', `${$('.footer__rule').offsetTop + 40}px`);
  new ResizeObserver(fit).observe(footer);

  // no celular fica só o fundo; a gravidade das letras é para mouse
  if (!finePointer || reduced) return;
  let chars = [], frame = 0, mx = 0, my = 0;
  const measure = () => {
    chars = $$('.c', cta).map((el) => {
      const r = el.getBoundingClientRect();
      return { el, x: r.left + r.width / 2, y: r.top + r.height / 2 + scrollY };
    });
  };
  const apply = () => {
    frame = 0;
    const RANGE = 260, white = isWhiteHole();
    chars.forEach((c) => {
      const dx = mx - c.x, dy = my - (c.y - scrollY);
      gravity(c.el, dx, dy, Math.max(0, 1 - Math.hypot(dx, dy) / RANGE), RANGE, white);
    });
  };
  addEventListener('resize', () => { chars = []; });
  footer.addEventListener('pointermove', (e) => {
    const r = $('.footer__space').getBoundingClientRect();
    space?.setPointer(e.clientX - r.left, e.clientY - r.top);
    if (!cta.classList.contains('is-settled') || $('.is-zero-g')) return;
    if (!chars.length || !chars[0].el.isConnected) measure();
    mx = e.clientX;
    my = e.clientY;
    frame ||= requestAnimationFrame(apply);
  });
  footer.addEventListener('pointerleave', () => {
    space?.setPointer(null);
    chars.forEach((c) => { c.el.style.transform = ''; c.el.style.setProperty('--f', 0); });
  });
}

// Tilt 3D nos cards, botões magnéticos e gravidade nas letras do hero.
function initPointerEffects() {
  initHeroGravity();

  // Cards de habilidades: inclinam de leve na direção do mouse
  slot('skills').addEventListener('pointermove', (e) => {
    const card = e.target.closest('.skill');
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - 0.5) * 16}deg`);
    card.style.setProperty('--rx', `${(0.5 - (e.clientY - r.top) / r.height) * 16}deg`);
  });
  slot('skills').addEventListener('pointerout', (e) => {
    const card = e.target.closest('.skill');
    if (card && !card.contains(e.relatedTarget)) { card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', '0deg'); }
  });

  const grid = slot('grid');
  grid.addEventListener('pointermove', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const r = card.querySelector('.card__frame').getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    card.style.setProperty('--ry', `${(px - 0.5) * 24}deg`);
    card.style.setProperty('--rx', `${(0.5 - py) * 24}deg`);
    card.style.setProperty('--mx', (px - 0.5).toFixed(3));
    card.style.setProperty('--my', (py - 0.5).toFixed(3));
    card.style.setProperty('--sx', `${px * 100}%`);
    card.style.setProperty('--sy', `${py * 100}%`);
  });
  grid.addEventListener('pointerout', (e) => {
    const card = e.target.closest('.card');
    if (card && !card.contains(e.relatedTarget)) {
      card.style.setProperty('--rx', '0deg');
      card.style.setProperty('--ry', '0deg');
      card.style.setProperty('--mx', 0);
      card.style.setProperty('--my', 0);
    }
  });

  document.addEventListener('pointermove', (e) => {
    // Durante a órbita o buraco negro controla o botão do hero
    if ($('.hero.is-orbit')) return;
    const m = e.target.closest('.magnetic');
    $$('.magnetic.is-pulled').forEach((el) => {
      if (el !== m) { el.classList.remove('is-pulled'); el.style.transform = ''; }
    });
    if (!m) return;
    const r = m.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    m.classList.add('is-pulled');
    m.style.transform = `translate(${dx * 0.25}px, ${dy * 0.35}px)`;
  }, { passive: true });
}

boot();
