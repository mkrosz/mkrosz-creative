// =====================================================================
//  Painel administrativo do portfólio.
//  Usa o SDK do Supabase (auth + storage) — só o painel carrega isso;
//  o site público continua sem dependências.
// =====================================================================
import { SUPABASE_URL, SUPABASE_ANON_KEY, STORAGE_BUCKET } from '../shared/config.js';
import { isConfigured, escapeHtml as esc, formatDate, mediaKind, safeUrl, youtubeId, normalizeText } from '../shared/api.js';
import { applyColors, toggleTheme } from '../shared/theme.js';
import { PLATFORMS, platformIcon, guessPlatform } from '../shared/platforms.js';
import { injectLogo } from '../shared/logo.js';

injectLogo(); // o gato do mkrosz (menu lateral e login)

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const bySort = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0);

let sb = null;
const DEMO_MODE = !isConfigured;
// Login de teste do modo demonstração: arquivo só do painel, baixado só sem Supabase
// (o site público não o vê). Se o arquivo não existir, não há login de teste.
const DEMO_LOGIN = DEMO_MODE ? await import('./demo-login.js').then((m) => m.DEMO_LOGIN).catch(() => null) : null;
let DATA = { settings: {}, socials: [], tags: [], projects: [], education: [] };

// ---------------------------------------------------------------------
//  Camada de dados: Supabase de verdade ou memória (modo demonstração)
// ---------------------------------------------------------------------
const TABLE_KEY = { social_links: 'socials', tags: 'tags', education: 'education', projects: 'projects' };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
const slugify = (v = '') => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function check({ data, error }) {
  if (error) throw error;
  return data;
}

const db = {
  async load() {
    if (DEMO_MODE) {
      const { DEMO } = await import('../shared/demo-data.js');
      const d = structuredClone(DEMO);
      d.projects = d.projects.map((p, i) => ({ ...p, sort_order: i, published: true, tag_ids: p.tags.map((t) => t.id) }));
      d.education.forEach((e, i) => { e.sort_order ??= i; });
      d.socials.forEach((s, i) => { s.sort_order ??= i; });
      return d;
    }
    const [settings, socials, tags, projects, education] = await Promise.all([
      sb.from('settings').select('*').eq('id', 1).maybeSingle().then(check),
      sb.from('social_links').select('*').order('sort_order').then(check),
      sb.from('tags').select('*').order('sort_order').order('name').then(check),
      db.loadProjects(),
      sb.from('education').select('*').order('sort_order').then(check),
    ]);
    return { settings: settings || {}, socials, tags, education, projects };
  },

  // só os projetos (com tags, mídias e links): é o que muda ao salvar um projeto
  async loadProjects() {
    const rows = check(await sb.from('projects').select('*, project_tags(tag_id), project_media(*), project_links(*)').order('sort_order').order('project_date', { ascending: false }));
    return rows.map((p) => ({
      ...p,
      tag_ids: p.project_tags.map((x) => x.tag_id),
      media: [...p.project_media].sort(bySort),
      links: [...p.project_links].sort(bySort),
    }));
  },

  async saveSettings(patch) {
    if (DEMO_MODE) return Object.assign(DATA.settings, patch);
    const row = check(await sb.from('settings').update(patch).eq('id', 1).select().single());
    return Object.assign(DATA.settings, row);
  },

  async saveRow(table, row) {
    const list = DATA[TABLE_KEY[table]];
    if (DEMO_MODE) {
      if ('slug' in row) row.slug = slugify(row.slug || row.name || row.title);
      const found = list.find((x) => x.id === row.id);
      if (found) return Object.assign(found, row);
      const created = { ...row, id: uid(), sort_order: list.length };
      list.push(created);
      return created;
    }
    let saved;
    if (row.id) {
      const { id, ...patch } = row;
      saved = check(await sb.from(table).update(patch).eq('id', id).select().single());
      Object.assign(list.find((x) => x.id === id) || {}, saved);
    } else {
      const sort_order = Math.max(-1, ...list.map((x) => x.sort_order ?? 0)) + 1;
      saved = check(await sb.from(table).insert({ ...row, sort_order }).select().single());
      list.push(saved);
    }
    return saved;
  },

  async deleteRow(table, id) {
    if (!DEMO_MODE) check(await sb.from(table).delete().eq('id', id));
    const key = TABLE_KEY[table];
    DATA[key] = DATA[key].filter((x) => x.id !== id);
  },

  async saveProject(payload) {
    if (DEMO_MODE) {
      const tags = DATA.tags.filter((t) => payload.tag_ids.includes(t.id));
      return db.saveRow('projects', { ...payload, slug: payload.slug || payload.title, tags });
    }
    check(await sb.rpc('save_project', { payload }));
    DATA.projects = await db.loadProjects(); // recarrega só os projetos, não o banco inteiro
  },

  // accept: os tipos aceitos pelo campo (ex.: 'image/*,application/pdf')
  async upload(file, folder, accept = 'image/*,video/*,application/pdf') {
    checkFile(file, accept);
    uploads.start();
    try {
      if (DEMO_MODE) return URL.createObjectURL(file);
      const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
      const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      check(await sb.storage.from(STORAGE_BUCKET).upload(path, file, { cacheControl: '31536000', contentType: file.type || undefined }));
      const url = sb.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
      sessionUploads.add(url);
      return url;
    } finally {
      uploads.end();
    }
  },
};

// ---------------------------------------------------------------------
//  Arquivos: tipos aceitos, envios em andamento e limpeza do storage
// ---------------------------------------------------------------------
// Os mesmos tipos e limite do bucket (schema.sql). SVG fica de fora: pode levar script.
const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime', 'application/pdf'];
const MAX_FILE_MB = 50;
// erro de arquivo recusado: a mensagem já é a final (errorMessage não a reescreve)
const fileError = (msg) => Object.assign(new Error(msg), { friendly: true });
function checkFile(file, accept) {
  const ok = accept.split(',').some((a) => (a.endsWith('/*') ? file.type.startsWith(a.slice(0, -1)) : file.type === a.trim()));
  if (!ok || !FILE_TYPES.includes(file.type)) {
    const what = accept.includes('pdf') ? 'uma imagem ou um PDF' : accept.includes('video') ? 'uma imagem ou um vídeo' : 'uma imagem';
    throw fileError(`Envie ${what} (JPG, PNG, WebP, AVIF, GIF${accept.includes('video') ? ', MP4, WebM' : ''}${accept.includes('pdf') ? ', PDF' : ''}).`);
  }
  if (file.size > MAX_FILE_MB * 1024 * 1024) throw fileError(`O arquivo passa de ${MAX_FILE_MB} MB.`);
}

// Enquanto houver envio em andamento, os botões de salvar ficam travados
const uploads = {
  n: 0,
  start() { this.n++; document.body.classList.add('is-uploading'); },
  end() { this.n = Math.max(0, this.n - 1); document.body.classList.toggle('is-uploading', this.n > 0); },
};

// Arquivos enviados nesta sessão que ainda não foram salvos em nada
const sessionUploads = new Set();
const STORAGE_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/`;
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// todas as URLs do nosso storage citadas em DATA (projetos, trajetória, configurações…)
const storageUrls = () => new Set(DEMO_MODE ? [] : JSON.stringify(DATA).match(new RegExp(`${escRe(STORAGE_PREFIX)}[^"]+`, 'g')) || []);
// Apaga do storage os arquivos que não são mais usados por nada. Falha aqui não
// atrapalha quem está editando: o arquivo só fica sobrando.
async function cleanupFiles(urls) {
  if (DEMO_MODE) return;
  const used = storageUrls();
  const paths = [...new Set(urls)].filter((u) => u?.startsWith(STORAGE_PREFIX) && !used.has(u))
    .map((u) => decodeURIComponent(u.slice(STORAGE_PREFIX.length)));
  urls.forEach((u) => sessionUploads.delete(u));
  if (!paths.length) return;
  const { error } = await sb.storage.from(STORAGE_BUCKET).remove(paths);
  if (error) console.warn('Não foi possível apagar arquivos antigos do storage:', error.message);
}
// Roda uma alteração e depois apaga o que ela deixou sem uso (arquivo trocado,
// mídia removida, item excluído) e os envios desta sessão que não foram salvos.
async function withCleanup(change) {
  const before = storageUrls();
  const result = await change();
  cleanupFiles([...before, ...sessionUploads]);
  return result;
}

// ---------------------------------------------------------------------
//  UI helpers: toast, confirmação, drawer
// ---------------------------------------------------------------------
function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast${type === 'error' ? ' toast--error' : ''}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), type === 'error' ? 6000 : 2800);
}

function errorMessage(err) {
  if (err?.friendly) return err.message;
  const m = err?.message || String(err);
  if (/row-level security|42501|permission/i.test(m)) return 'Sem permissão para salvar. Confirme se seu usuário está na tabela admins.';
  if (/duplicate key.*slug/i.test(m)) return 'Já existe um item com esse slug. Escolha outro.';
  if (/education_dates_chk/.test(m)) return 'A data de conclusão está antes da data de início.';
  if (/_color_chk|_colors_chk/.test(m)) return 'Use uma cor em hexadecimal (ex.: #2f7bff).';
  if (/projects_state_chk/.test(m)) return 'Um projeto não pode estar publicado e offline ao mesmo tempo.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Sem conexão com o Supabase. Verifique a internet e tente de novo.';
  return `Não foi possível salvar: ${m}`;
}

function confirmDialog(title, text, ok) {
  const dlg = $('#confirm');
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  $('#confirm-ok').textContent = ok;
  dlg.showModal();
  return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
}
const confirmDelete = (name, kind) => confirmDialog(`Excluir ${kind} "${name}"?`, 'Essa ação não pode ser desfeita.', `Excluir ${kind}`);
const confirmDiscard = () => confirmDialog('Descartar alterações?', 'Você mudou coisas que ainda não foram salvas.', 'Descartar');

// Alterações não salvas: na gaveta (drawerDirty) ou numa página de configurações
// (botão "Salvar alterações" habilitado). Sair pede confirmação.
let drawerDirty = false;
const settingsDirty = () => !!$('#settings-save') && !$('#settings-save').disabled;
async function leaveSettings() {
  if (!settingsDirty()) return true;
  if (!(await confirmDiscard())) return false;
  applyColors(DATA.settings); // desfaz a prévia das cores
  cleanupFiles([...sessionUploads]);
  return true;
}
addEventListener('beforeunload', (e) => { if (drawerDirty || settingsDirty() || uploads.n) e.preventDefault(); });

const drawer = $('#drawer');
let drawerCtx = null;
let drawerOpener = null;

// altLabel: um segundo botão de salvar (ex.: "Salvar como rascunho"); onSave
// recebe { alt: true } quando foi ele o clicado.
// status: selo ao lado do título ({ label, kind: 'live' | 'off' | 'draft' }).
function openDrawer({ title, body, onSave, saveLabel = 'Salvar', altLabel = '', status = null }) {
  drawerCtx = { onSave };
  drawerOpener = document.activeElement;
  $('#drawer-title').textContent = title;
  const st = $('#drawer-status');
  st.hidden = !status;
  if (status) { st.textContent = status.label; st.className = `badge badge--${status.kind}`; }
  $('#drawer-body').innerHTML = body;
  $('#drawer-save').textContent = saveLabel;
  $('#drawer-alt').textContent = altLabel;
  $('#drawer-alt').hidden = !altLabel;
  drawer.hidden = false;
  drawerDirty = false;
  document.body.style.overflow = 'hidden';
  $$('#drawer-body [data-list]').forEach(fitChips);
  $('#drawer-body input, #drawer-body textarea, #drawer-body select')?.focus();
}

function closeDrawer() {
  drawer.hidden = true;
  drawerDirty = false;
  document.body.style.overflow = '';
  drawerCtx = null;
  drawerOpener?.focus?.();
  // envios feitos na gaveta e não salvos (cancelou, fechou) saem do storage
  cleanupFiles([...sessionUploads]);
}
// Fechar sem salvar: pergunta antes de jogar as alterações fora
async function requestCloseDrawer() {
  if (drawerDirty && !(await confirmDiscard())) return;
  closeDrawer();
}

// Qualquer edição dentro da gaveta marca alterações não salvas
$('#drawer-form').addEventListener('input', (e) => { if (!e.target.closest('.tag-combo')) drawerDirty = true; });
$('#drawer-form').addEventListener('change', () => { drawerDirty = true; });
let tagOutside = null; // fecha as listas de tags ao clicar fora (definido em editProject)
drawer.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) return requestCloseDrawer();
  const tab = e.target.closest('[data-tab]');
  if (tab) return activateTab(tab.dataset.tab);
  tagOutside?.(e);
  // "Editar posições" de mídias e links (um único listener, criado uma vez)
  const sortRep = e.target.closest('[data-sort-rep]');
  if (sortRep) {
    const on = $(`#${sortRep.dataset.sortRep}`).classList.toggle('is-sorting');
    sortRep.setAttribute('aria-pressed', on);
    sortRep.innerHTML = `${ICON.sort}${on ? 'Concluir' : 'Editar posições'}`;
    return;
  }
  // botões que mudam o conteúdo (adicionar, remover, mover, tags…) também contam
  if (e.target.closest('#drawer-body button:not(.tip):not(.tag-all-btn)')) drawerDirty = true;
});

function activateTab(name) {
  $$('#drawer [data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === name));
  $$('#drawer [data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== name; });
  // no celular as abas deslizam: mantém a aba ativa à vista
  const tab = $(`#drawer [data-tab="${name}"]`);
  tab?.parentElement.scrollTo({ left: tab.offsetLeft - tab.parentElement.offsetLeft - 8 });
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !drawer.hidden && !$('#confirm').open) requestCloseDrawer(); });
$('#drawer-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  if (!form.checkValidity()) {
    // Se o campo inválido está numa aba escondida, abre essa aba primeiro.
    const pane = form.querySelector(':invalid')?.closest('[data-pane]');
    if (pane) activateTab(pane.dataset.pane);
    form.reportValidity();
    return;
  }
  if (uploads.n) return toast('Espere o envio do arquivo terminar para salvar.', 'error');
  const btn = $('#drawer-save');
  const alt = e.submitter?.id === 'drawer-alt';
  btn.disabled = true;
  $('#drawer-alt').disabled = true;
  try {
    await withCleanup(() => drawerCtx.onSave(form, { alt }));
    closeDrawer();
    renderSection();
  } catch (err) {
    console.error(err);
    toast(errorMessage(err), 'error');
  } finally {
    btn.disabled = false;
    $('#drawer-alt').disabled = false;
  }
});

// ---------------------------------------------------------------------
//  Campos de formulário
// ---------------------------------------------------------------------
const f = (key, label, type = 'text', opts = {}) => ({ key, label, type, ...opts });

// Dica discreta: um "i" ao lado do rótulo; o texto aparece num balão
// ao passar o mouse ou focar com o teclado.
const tip = (text) => text ? ` <span class="tip" tabindex="0" role="img" aria-label="${esc(text)}" data-tip="${esc(text)}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.2"/></svg></span>` : '';

function fieldHtml(fd, value) {
  const id = `f-${fd.key}`;
  const cls = `field${fd.full ? ' full' : ''}`;
  const label = `${fd.label}${tip(fd.help)}`;
  const req = fd.required ? ' required' : '';
  const v = value ?? '';
  switch (fd.type) {
    case 'textarea':
      return `<label class="${cls}"><span>${label}</span><textarea class="input" id="${id}" name="${fd.key}" rows="${fd.rows || 4}"${req}>${esc(v)}</textarea></label>`;
    case 'bool':
      return `<div class="${cls}"><label class="switch"><input type="checkbox" name="${fd.key}" ${value ? 'checked' : ''}> ${label}</label></div>`;
    case 'color':
      // Botão com a amostra da cor: abre o painel (seletor + hexadecimal)
      return `<div class="${cls}"><span class="field-label">${label}</span>
        <button class="color-btn" type="button" data-color-open aria-label="${fd.label}: escolher cor">
          <span class="color-btn__swatch" style="background:${esc(v || 'transparent')}"></span>
          <span class="color-btn__hex">${esc(v || 'Escolher cor')}</span>
        </button>
        <input type="hidden" name="${fd.key}" value="${esc(v)}"${req}></div>`;
    case 'select':
      return `<label class="${cls}"><span>${label}</span><select class="input" name="${fd.key}"${req}>${fd.options()
        .map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`)
        .join('')}</select></label>`;
    case 'image':
      // Clicar (ou soltar um arquivo em cima) abre o seletor de arquivos
      return `<div class="${cls}"><span class="field-label">${label}</span>
        <div class="upload${v ? ' has-file' : ''}" data-upload="${fd.accept || 'image/*'}" data-folder="${fd.folder || 'imagens'}">
          <button class="upload__drop" type="button" data-upload-pick aria-label="${fd.label}: escolher arquivo">
            <span class="upload__preview" data-preview>${previewHtml(v)}</span>
            <span class="upload__text">
              <strong data-upload-title>${v ? 'Trocar arquivo' : 'Clique para enviar'}</strong>
              <small>ou arraste até aqui</small>
            </span>
          </button>
          <button class="btn btn--icon btn--sm btn--ghost upload__clear" type="button" data-upload-clear aria-label="${fd.label}: remover arquivo" title="Remover arquivo">${ICON.trash}</button>
          <input type="hidden" name="${fd.key}" value="${esc(v)}">
        </div></div>`;
    case 'list':
      return `<div class="${cls} list-input" data-list="${fd.key}"><span class="field-label">${label}</span>
        <input class="input" type="text" placeholder="Digite e pressione Enter para adicionar" data-list-add>
        <div class="list-input__chips">${(value || []).map(listChip).join('')}<span class="list-more" tabindex="0" hidden><span class="list-more__n"></span><span class="list-more__panel" role="group" aria-label="Demais itens"></span></span></div>
        <input type="hidden" name="${fd.key}" value="${esc(JSON.stringify(value || []))}"></div>`;
    default:
      return `<label class="${cls}"><span>${label}</span><input class="input" id="${id}" type="${fd.type}" name="${fd.key}" value="${esc(fd.type === 'date' ? String(v).slice(0, 10) : v)}"${req}${fd.placeholder ? ` placeholder="${esc(fd.placeholder)}"` : ''}></label>`;
  }
}

// Ícones dos botões pequenos (mesmo traço do portfólio)
const ICON = {
  up: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>',
  down: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  x: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  trash: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
  sort: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4v16M4 8l4-4 4 4M16 20V4M12 16l4 4 4-4"/></svg>',
  edit: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
  prev: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>',
  next: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
  search: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
};
const editButton = (id) => `<button class="btn btn--icon btn--sm btn--ghost" type="button" data-edit="${esc(id)}" aria-label="Editar" title="Editar">${ICON.edit}</button>`;

// Paginação das listas: só cabe na tela o que a altura permite (sem rolagem).
// No modo "Editar posições" a lista aparece inteira.
const listPages = {};
function perPage(rows) {
  // cards (Projetos e Trajetória): sempre 8 por página; listas: o que cabe na altura
  if (rows[0]?.parentElement.classList.contains('cards')) return 8;
  if (rows[0]?.parentElement.classList.contains('tagcards')) return 12;
  return Math.max(4, Math.floor((innerHeight - 350) / 66));
}
function paginate(rows, id, refresh) {
  const pager = $('#pager');
  const per = perPage(rows);
  const total = Math.max(1, Math.ceil(rows.length / per));
  const page = Math.min(listPages[id] || 0, total - 1);
  listPages[id] = page;
  rows.forEach((r, i) => { r.hidden = !sorting && Math.floor(i / per) !== page; });
  if (!pager) return;
  pager.hidden = sorting || total < 2;
  // Igual à paginação de projetos do site: « Anterior · 1 2 3 · Próxima »
  // (muitas páginas: a primeira, a última e as vizinhas da atual)
  const nums = [];
  for (let k = 0; k < total; k++) {
    if (k === 0 || k === total - 1 || Math.abs(k - page) <= 1) nums.push(k);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  pager.innerHTML = `
    <button class="pager__step" type="button" data-page="${page - 1}" ${page === 0 ? 'disabled' : ''}>${ICON.prev}<span>Anterior</span></button>
    <div class="pager__nums">${nums.map((k) => (k === '…'
      ? '<span class="pager__gap" aria-hidden="true">…</span>'
      : `<button class="pager__num" type="button" data-page="${k}" ${k === page ? 'aria-current="page"' : ''} aria-label="Página ${k + 1}">${k + 1}</button>`)).join('')}</div>
    <button class="pager__step" type="button" data-page="${page + 1}" ${page === total - 1 ? 'disabled' : ''}><span>Próxima</span>${ICON.next}</button>`;
  pager.onclick = (e) => {
    const b = e.target.closest('[data-page]');
    if (!b || b.disabled) return;
    listPages[id] = Number(b.dataset.page);
    refresh();
  };
}

// "Editar posições": as setas de ordem só aparecem com esse modo ligado
let sorting = false;
// lista atual e campo de data, para os botões "por data" do modo de posições
let dateCtx = null;
const dateSortButtons = (table, list, key) => {
  dateCtx = sorting && key ? { table, list, key } : null;
  return dateCtx ? `<div class="seg" role="group" aria-label="Ordenar por data">
    <button type="button" data-date-sort="desc">Mais recentes primeiro</button>
    <button type="button" data-date-sort="asc">Mais antigos primeiro</button></div>` : '';
};
const sortToggle = (n) => n > 1
  ? `<button class="btn btn--ghost" type="button" id="sort-toggle" aria-pressed="${sorting}">${ICON.sort}${sorting ? 'Concluir' : 'Editar posições'}</button>`
  : '';
const listChip = (item) => `<span class="chip">${esc(item)}<button type="button" data-list-remove aria-label="Remover ${esc(item)}">${ICON.x}</button></span>`;

const UPLOAD_ICON = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>';

// Prévia de um arquivo/mídia. `kind` vem do tipo do arquivo enviado (links
// "blob:" não têm extensão); sem ele, é deduzido pelo endereço.
function previewHtml(url, kind) {
  if (!url) return UPLOAD_ICON;
  const yt = youtubeId(url);
  if (yt) return `<img src="https://i.ytimg.com/vi/${yt}/mqdefault.jpg" alt=""><span class="play-badge">▶</span>`;
  if (kind === 'pdf' || /\.pdf(\?|$)/i.test(url)) return '<span class="file-badge">PDF</span>';
  // preload="metadata": só o primeiro quadro, sem baixar o vídeo inteiro
  if (kind === 'video' || mediaKind({ url }) === 'video') return `<video src="${esc(safeUrl(url))}" muted preload="metadata"></video><span class="play-badge">▶</span>`;
  if (mediaKind({ url }) === 'embed') return '<span class="file-badge">▶ Vídeo</span>';
  return `<img src="${esc(safeUrl(url))}" alt="" loading="lazy" decoding="async">`;
}
const fileKind = (file) => (file.type === 'application/pdf' ? 'pdf' : file.type.startsWith('video') ? 'video' : 'image');

function readFields(form, fields) {
  const out = {};
  fields.forEach((fd) => {
    const el = form.elements[fd.key];
    if (!el) return;
    if (fd.type === 'bool') out[fd.key] = el.checked;
    else if (fd.type === 'list') out[fd.key] = JSON.parse(el.value || '[]');
    else {
      const v = el.value.trim();
      out[fd.key] = v === '' ? (fd.required ? '' : null) : v;
    }
  });
  return out;
}

// Comportamentos dos campos (delegação global: vale para páginas e drawer)
document.addEventListener('click', (e) => {
  const pick = e.target.closest('[data-upload-pick]');
  if (pick) {
    const box = pick.closest('[data-upload]');
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: box.dataset.upload });
    input.onchange = () => input.files[0] && uploadInto(box, input.files[0]);
    input.click();
  }
  const clear = e.target.closest('[data-upload-clear]');
  if (clear) setUpload(clear.closest('[data-upload]'), '');
  const rm = e.target.closest('[data-list-remove]');
  if (rm) {
    const wrap = rm.closest('[data-list]');
    rm.closest('.chip').remove();
    syncList(wrap);
  }
});

const tipPop = document.body.appendChild(Object.assign(document.createElement('div'), { className: 'tip-pop', role: 'tooltip', hidden: true }));
function showTip(el) {
  tipPop.textContent = el.dataset.tip;
  tipPop.hidden = false;
  const r = el.getBoundingClientRect(), w = tipPop.offsetWidth, h = tipPop.offsetHeight;
  const below = r.top - h - 10 < 8;
  tipPop.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
  tipPop.style.top = `${below ? r.bottom + 10 : r.top - h - 10}px`;
}
const hideTip = () => { tipPop.hidden = true; };
document.addEventListener('pointerover', (e) => { const t = e.target.closest?.('.tip'); t ? showTip(t) : hideTip(); });
document.addEventListener('focusin', (e) => { e.target.matches('.tip') ? showTip(e.target) : hideTip(); });
document.addEventListener('scroll', hideTip, true);
// a dica fica dentro do rótulo: clicar nela não deve marcar/focar o campo
document.addEventListener('click', (e) => { const t = e.target.closest('.tip'); if (t) { e.preventDefault(); showTip(t); } }, true);

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.target.matches('[data-list-add]')) return;
  e.preventDefault();
  const v = e.target.value.trim();
  if (!v) return;
  const wrap = e.target.closest('[data-list]');
  unfoldChips(wrap); // devolve os escondidos para a linha antes, para o novo ir para o fim
  $('.list-more', wrap).insertAdjacentHTML('beforebegin', listChip(v));
  e.target.value = '';
  syncList(wrap);
});

// Campo de arquivo: envia e mostra a prévia
function setUpload(box, url, kind) {
  const hidden = $('input[type="hidden"]', box);
  hidden.value = url;
  box.classList.toggle('has-file', !!url);
  $('[data-preview]', box).innerHTML = previewHtml(url, kind);
  $('[data-upload-title]', box).textContent = url ? 'Trocar arquivo' : 'Clique para enviar';
  hidden.dispatchEvent(new Event('input', { bubbles: true }));
}
async function uploadInto(box, file) {
  const title = $('[data-upload-title]', box);
  box.classList.add('is-busy');
  title.textContent = 'Enviando…';
  try {
    setUpload(box, await db.upload(file, box.dataset.folder, box.dataset.upload), fileKind(file));
    toast('Arquivo enviado');
  } catch (err) {
    title.textContent = 'Clique para enviar';
    toast(errorMessage(err), 'error');
  } finally {
    box.classList.remove('is-busy');
  }
}
// Arrastar e soltar arquivos nos campos de envio
document.addEventListener('dragover', (e) => {
  const box = e.target.closest?.('[data-upload], [data-dropzone]');
  if (!box) return;
  e.preventDefault();
  box.classList.add('is-over');
});
document.addEventListener('dragleave', (e) => e.target.closest?.('[data-upload], [data-dropzone]')?.classList.remove('is-over'));
document.addEventListener('drop', (e) => {
  const box = e.target.closest?.('[data-upload]');
  if (!box) return;
  e.preventDefault();
  box.classList.remove('is-over');
  if (e.dataTransfer.files[0]) uploadInto(box, e.dataTransfer.files[0]);
});

// ---------------------------------------------------------------------
//  Painel de cor: quadro de saturação/brilho + faixa de matiz + hexadecimal
//  + cores prontas. Um painel só, reaproveitado por todos os campos de cor.
// ---------------------------------------------------------------------
const PRESETS = ['#2f7bff', '#00c2ff', '#5b6cff', '#1e40af', '#38bdf8', '#7fb2ff', '#0ea5e9', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#22c55e', '#ffffff', '#e6efff', '#0a1a33', '#030a18'];
const clamp01 = (v) => Math.min(1, Math.max(0, v));
function hexToHsv(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let hue = 0;
  if (d) hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (hue * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}
function hsvToHex({ h, s, v }) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255).toString(16).padStart(2, '0');
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}

// Formatos do campo de texto do painel: HEX, RGB, CMYK, HSV e HSL.
// A cor fica sempre guardada em HEX; o formato só muda como ela é mostrada/digitada.
const FORMATS = ['hex', 'rgb', 'cmyk', 'hsv', 'hsl'];
let pickFormat = 'hex';
const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgbToHex = (rgb) => `#${rgb.map((n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')).join('')}`;
const round = Math.round;
function formatColor(hex, fmt) {
  const [r, g, b] = hexToRgb(hex);
  const { h, s, v } = hexToHsv(hex);
  if (fmt === 'rgb') return `${r}, ${g}, ${b}`;
  if (fmt === 'cmyk') {
    const k = 1 - Math.max(r, g, b) / 255;
    const c = (x) => (k === 1 ? 0 : round(((1 - x / 255 - k) / (1 - k)) * 100));
    return `${c(r)}, ${c(g)}, ${c(b)}, ${round(k * 100)}`;
  }
  if (fmt === 'hsv') return `${round(h)}, ${round(s * 100)}%, ${round(v * 100)}%`;
  if (fmt === 'hsl') {
    const l = v * (1 - s / 2);
    const sl = l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l);
    return `${round(h)}, ${round(sl * 100)}%, ${round(l * 100)}%`;
  }
  return hex.slice(1);
}
// texto digitado → HSV do painel (null enquanto ainda não é uma cor válida)
function parseColor(text, fmt) {
  if (fmt === 'hex') {
    const v = text.replace(/[^0-9a-f]/gi, '');
    return v.length === 3 || v.length === 6 ? hexToHsv(`#${v}`) : null;
  }
  const n = (text.match(/\d+(\.\d+)?/g) || []).map(Number);
  if (n.length < (fmt === 'cmyk' ? 4 : 3)) return null;
  if (fmt === 'rgb') return hexToHsv(rgbToHex(n));
  if (fmt === 'cmyk') {
    const [c, m, y, k] = n.map((x) => Math.min(100, x) / 100);
    return hexToHsv(rgbToHex([c, m, y].map((x) => 255 * (1 - x) * (1 - k))));
  }
  const [h, a, b] = [n[0] % 360, Math.min(100, n[1]) / 100, Math.min(100, n[2]) / 100];
  if (fmt === 'hsv') return { h, s: a, v: b };
  const v = b + a * Math.min(b, 1 - b); // hsl → hsv
  return { h, s: v ? 2 * (1 - b / v) : 0, v };
}

const picker = document.createElement('div');
picker.className = 'cp';
picker.hidden = true;
picker.setAttribute('role', 'dialog');
picker.setAttribute('aria-label', 'Escolher cor');
picker.innerHTML = `
  <div class="cp__sv" aria-hidden="true"><span class="cp__knob"></span></div>
  <input class="cp__hue" type="range" min="0" max="360" step="1" aria-label="Matiz">
  <div class="cp__row">
    <span class="cp__now"></span>
    <label class="cp__hex"><span class="cp__prefix">#</span><input type="text" spellcheck="false" aria-label="Cor em HEX"></label>
    <div class="cp__fmt">
      <button type="button" class="cp__fmt-btn" aria-haspopup="listbox" aria-expanded="false" aria-label="Formato da cor">HEX<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
      <div class="cp__fmt-list" role="listbox" hidden>${FORMATS.map((f) => `<button type="button" role="option" data-fmt="${f}" aria-selected="${f === 'hex'}">${f.toUpperCase()}</button>`).join('')}</div>
    </div>
  </div>
  <div class="cp__presets">${PRESETS.map((c) => `<button type="button" style="background:${c}" data-preset="${c}" aria-label="${c}"></button>`).join('')}</div>`;
document.body.append(picker);
let pickTarget = null;
let hsv = { h: 220, s: 0.8, v: 1 };

function paintPicker(skipHex) {
  const hex = hsvToHex(hsv);
  picker.style.setProperty('--hue', `hsl(${hsv.h} 100% 50%)`);
  $('.cp__knob', picker).style.cssText = `left:${hsv.s * 100}%;top:${(1 - hsv.v) * 100}%;background:${hex}`;
  $('.cp__hue', picker).value = hsv.h;
  $('.cp__now', picker).style.background = hex;
  if (!skipHex) $('.cp__hex input', picker).value = formatColor(hex, pickFormat);
  return hex;
}
// o campo da cor: ao lado do botão, ou indicado por data-color-for (prévias de tema)
const pickInput = (btn) => (btn.dataset.colorFor
  ? btn.closest('form').elements[btn.dataset.colorFor]
  : btn.parentElement.querySelector('input[type="hidden"]'));
function applyPick(hex) {
  if (!pickTarget) return;
  const hidden = pickInput(pickTarget);
  hidden.value = hex;
  const sw = $('.color-btn__swatch', pickTarget);
  if (sw) { sw.style.background = hex; $('.color-btn__hex', pickTarget).textContent = hex; }
  hidden.dispatchEvent(new Event('input', { bubbles: true }));
}
function openPicker(btn) {
  pickTarget = btn;
  const v = pickInput(btn).value;
  hsv = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? hexToHsv(v) : { h: 220, s: 0.8, v: 1 };
  paintPicker();
  picker.hidden = false;
  // abaixo do botão; se não couber, acima
  const r = btn.getBoundingClientRect(), pw = picker.offsetWidth, ph = picker.offsetHeight;
  const top = r.bottom + 8 + ph > innerHeight ? r.top - ph - 8 : r.bottom + 8;
  picker.style.left = `${Math.max(8, Math.min(r.left, innerWidth - pw - 8))}px`;
  picker.style.top = `${Math.max(8, top)}px`;
  $('.cp__hex input', picker).focus();
}
function closePicker() {
  if (picker.hidden) return;
  picker.hidden = true;
  pickTarget?.focus();
  pickTarget = null;
}
let pickDrag = false;
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-color-open]');
  if (btn) return btn === pickTarget ? closePicker() : openPicker(btn);
  if (pickDrag) { pickDrag = false; return; }
  if (!picker.hidden && !picker.contains(e.target)) closePicker();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !picker.hidden) { e.stopImmediatePropagation(); closePicker(); }
}, true);
// arrastar no quadro de saturação/brilho
const sv = $('.cp__sv', picker);
const svMove = (e) => {
  const r = sv.getBoundingClientRect();
  hsv.s = clamp01((e.clientX - r.left) / r.width);
  hsv.v = 1 - clamp01((e.clientY - r.top) / r.height);
  applyPick(paintPicker());
};
sv.addEventListener('pointerdown', (e) => { sv.setPointerCapture(e.pointerId); svMove(e); });
// arrastar no quadro/matiz e soltar fora do painel gera um clique fora: ignora esse
picker.addEventListener('pointerdown', () => { pickDrag = true; });
document.addEventListener('pointerup', () => setTimeout(() => { pickDrag = false; }));
sv.addEventListener('pointermove', (e) => { if (sv.hasPointerCapture(e.pointerId)) svMove(e); });
$('.cp__hue', picker).addEventListener('input', (e) => { hsv.h = Number(e.target.value); applyPick(paintPicker()); });
$('.cp__hex input', picker).addEventListener('input', (e) => {
  const next = parseColor(e.target.value, pickFormat);
  if (next) { hsv = next; applyPick(paintPicker(true)); }
});
// ao sair do campo, reescreve no formato certinho
$('.cp__hex input', picker).addEventListener('blur', () => paintPicker());
// botão de formato: abre a lista HEX / RGB / CMYK / HSV / HSL
const fmtBtn = $('.cp__fmt-btn', picker), fmtList = $('.cp__fmt-list', picker);
function setFormat(fmt) {
  pickFormat = fmt;
  fmtBtn.firstChild.textContent = fmt.toUpperCase();
  $('.cp__prefix', picker).hidden = fmt !== 'hex';
  $('.cp__hex input', picker).setAttribute('aria-label', `Cor em ${fmt.toUpperCase()}`);
  $$('[data-fmt]', fmtList).forEach((b) => b.setAttribute('aria-selected', b.dataset.fmt === fmt));
  paintPicker();
}
fmtBtn.addEventListener('click', () => {
  fmtList.hidden = !fmtList.hidden;
  fmtBtn.setAttribute('aria-expanded', !fmtList.hidden);
});
fmtList.addEventListener('click', (e) => {
  const b = e.target.closest('[data-fmt]');
  if (!b) return;
  setFormat(b.dataset.fmt);
  fmtList.hidden = true;
  fmtBtn.setAttribute('aria-expanded', 'false');
  $('.cp__hex input', picker).focus();
});
picker.addEventListener('click', (e) => { if (!e.target.closest('.cp__fmt')) { fmtList.hidden = true; fmtBtn.setAttribute('aria-expanded', 'false'); } });
$('.cp__hex input', picker).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); closePicker(); } });
picker.addEventListener('click', (e) => {
  const c = e.target.closest('[data-preset]');
  if (c) { hsv = hexToHsv(c.dataset.preset); applyPick(paintPicker()); }
});
// o painel acompanha o botão se a página rolar; fecha ao fechar a gaveta
addEventListener('scroll', closePicker, { passive: true });
$('#drawer-body').addEventListener('scroll', closePicker, { passive: true });

function syncList(wrap) {
  const items = $$('.chip', wrap).map((c) => c.firstChild.textContent);
  $('input[type="hidden"]', wrap).value = JSON.stringify(items);
  fitChips(wrap);
  wrap.closest('form')?.dispatchEvent(new Event('input', { bubbles: true }));
}

// Itens numa linha só, como os links do projeto no site: o que não cabe vai
// para o "+N", que mostra os demais ao passar o mouse.
function unfoldChips(wrap) {
  const more = $('.list-more', wrap);
  $$('.list-more__panel .chip', wrap).forEach((c) => more.before(c));
}
function fitChips(wrap) {
  const row = $('.list-input__chips', wrap), more = $('.list-more', row), panel = $('.list-more__panel', more);
  unfoldChips(wrap); // volta tudo para a linha
  more.hidden = true;
  const chips = $$(':scope > .chip', row);
  if (!chips.length || !row.offsetParent) return;
  const top = chips[0].offsetTop;
  const overflow = () => chips.filter((c) => c.parentElement === row && c.offsetTop > top);
  if (!overflow().length) return;
  more.hidden = false;
  // tira itens do fim até os que ficam + o "+N" caberem na primeira linha
  let kept = chips.length;
  do {
    kept -= 1;
    chips.slice(kept).forEach((c) => panel.append(c));
    $('.list-more__n', more).textContent = `+${chips.length - kept}`;
  } while (kept > 1 && (overflow().length || more.offsetTop > top));
  more.setAttribute('aria-label', `Mais ${chips.length - kept}: ${chips.slice(kept).map((c) => c.firstChild.textContent).join(', ')}`);
}
addEventListener('resize', () => $$('[data-list]').forEach(fitChips));

// ---------------------------------------------------------------------
//  Definição das seções do painel
// ---------------------------------------------------------------------
// Texto para pesquisa: minúsculo e sem acentos
const platformOptions = () => Object.entries(PLATFORMS).map(([value, p]) => ({ value, label: p.label }));
const KIND_LABEL = { formacao: 'Formação', trabalho: 'Trabalho', curso: 'Curso' };
const ACCENT_HELP = 'Coloque palavras entre *asteriscos* para destacá-las em itálico.';

const SECTIONS = [
  { group: 'Conteúdo' },
  {
    id: 'identidade', label: 'Identidade', desc: 'Seu nome, função e contato — aparecem na navbar, no sobre e no rodapé.', kind: 'settings',
    fields: [
      f('site_name', 'Nome', 'text', { required: true }),
      f('role', 'Função / título', 'text', { required: true }),
      f('email', 'E-mail de contato', 'email'),
      f('location', 'Localização'),
      f('logo_url', 'Logo — tema claro', 'image', { folder: 'identidade', accept: 'image/*', help: 'Opcional, para trocar a logo no futuro. Substitui o gato no site e no painel com o tema claro. Vazio (lixeira ao lado) = o gato padrão. Use PNG ou WebP com fundo transparente.' }),
      f('logo_dark_url', 'Logo — tema escuro', 'image', { folder: 'identidade', accept: 'image/*', help: 'Usada com o tema escuro e no topo do site (que é sempre escuro). Vazio = usa a do tema claro.' }),
      f('available_for_work', 'Disponível para novos projetos', 'bool', { full: true, help: 'Mostra o selo verde no hero.' }),
    ],
  },
  {
    id: 'hero', label: 'Hero', desc: 'A primeira coisa que o visitante vê.', kind: 'settings',
    fields: [
      f('hero_eyebrow', 'Texto acima do título'),
      f('hero_cta_label', 'Texto do botão'),
      f('hero_title', 'Título principal', 'text', { full: true, help: ACCENT_HELP }),
      f('hero_subtitle', 'Subtítulo', 'textarea', { full: true, rows: 3 }),
    ],
  },
  { id: 'projetos', label: 'Projetos', desc: 'Imagens, vídeos, tags, data e links de cada projeto. A estrela escolhe o projeto em destaque no site.', kind: 'projects' },
  {
    id: 'tags', label: 'Tags', desc: 'As tags dos projetos: renomeie, troque a cor ou exclua as que não usa mais. Novas tags também podem ser criadas direto no projeto.', kind: 'collection', table: 'tags', singular: 'tag',
    fields: [
      f('name', 'Nome', 'text', { required: true }),
      f('color', 'Cor', 'color', { help: 'Cor da etiqueta no site e do filtro de projetos.' }),
    ],
    defaults: { color: '#2f7bff' },
    // filtro pelo estado dos projetos que usam a tag: uma tag pode estar em vários
    groups: { online: 'Online', offline: 'Offline', rascunho: 'Rascunho', nenhum: 'Sem uso' },
    kinds: (t) => {
      const use = tagUse(t);
      const k = Object.entries(TAG_STATE).filter(([state]) => use[state]).map(([, v]) => v);
      return k.length ? k : ['nenhum'];
    },
    row: (t) => ({ title: t.name, meta: '' }),
    // card: a etiqueta como aparece no site + em quantos projetos de cada estado ela está
    card: (t) => {
      const use = tagUse(t);
      const states = [['published', 'online', 'badge--live'], ['offline', 'offline', 'badge--off'], ['draft', 'rascunho', 'badge--draft']]
        .filter(([state]) => use[state])
        .map(([state, label, cls]) => `<span class="badge ${cls}">${use[state]} ${label}</span>`).join('');
      return `<span class="chip tagcard__chip" style="--chip:${esc(t.color || 'var(--accent)')}">${esc(t.name)}</span>
        <div class="tagcard__states">${states || '<span class="badge">sem uso</span>'}</div>`;
    },
  },
  {
    id: 'sobre', label: 'Sobre mim', desc: 'Texto, foto e habilidades.', kind: 'settings',
    fields: [
      f('about_title', 'Título da seção'),
      f('about_image_url', 'Sua foto', 'image', { folder: 'sobre' }),
      f('about_text', 'Texto sobre você', 'textarea', { full: true, rows: 4, help: 'As palavras acendem uma a uma conforme o visitante rola a página.' }),
      f('skills', 'Habilidades / ferramentas', 'list', { full: true, help: 'Viram cards com ícone no “Sobre mim” e aparecem na faixa animada abaixo do hero. Ferramentas como Figma, Photoshop, Illustrator, After Effects, XD, Blender e Canva ganham o logo; áreas como UX, UI, Branding e Motion ganham um ícone; o resto mostra as iniciais.' }),
    ],
  },
  {
    id: 'trajetoria', label: 'Trajetória', desc: 'Formação, onde você trabalha e cursos com certificado.', kind: 'collection', table: 'education', singular: 'item',
    fields: [
      f('kind', 'Tipo', 'select', { required: true, options: () => Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label })) }),
      f('institution', 'Instituição / empresa', 'text', { required: true }),
      f('title', 'Curso / cargo', 'text', { required: true, full: true }),
      f('start_date', 'Início', 'date'),
      f('end_date', 'Conclusão', 'date'),
      f('is_current', 'Em andamento / trabalho atual', 'bool', { full: true }),
      f('description', 'Descrição curta', 'textarea', { full: true, rows: 3 }),
      f('certificate_url', 'Certificado (imagem ou PDF)', 'image', { full: true, accept: 'image/*,application/pdf', folder: 'certificados', help: 'Use uma imagem deitada em 16:9 (ex.: 1600×900). No site ela aparece numa moldura 16:9.' }),
      f('applied_text', 'O que apliquei no curso', 'textarea', { full: true, rows: 4, help: 'Aparece ao lado do certificado quando o visitante clica em “Ver certificado”.' }),
      f('credential_url', 'Link de validação do certificado', 'url', { full: true }),
    ],
    defaults: { kind: 'curso' },
    groups: { trabalho: 'Trabalho', formacao: 'Formação', curso: 'Cursos' },
    dateKey: 'start_date',
    row: (e) => ({
      lead: `<span class="badge">${KIND_LABEL[e.kind] || e.kind}</span>`,
      title: e.title,
      meta: [e.institution, [formatDate(e.start_date, { month: 'short', year: 'numeric' }), e.is_current ? 'Atual' : formatDate(e.end_date, { month: 'short', year: 'numeric' })].filter(Boolean).join(' — '), e.certificate_url ? 'com certificado' : ''].filter(Boolean).join(' · '),
    }),
  },
  {
    id: 'redes', label: 'Redes sociais', desc: 'Links que aparecem na navbar e no rodapé.', kind: 'collection', table: 'social_links', singular: 'rede',
    fields: [
      f('url', 'Link do perfil', 'url', { required: true, full: true, placeholder: 'https://www.behance.net/seu-usuario' }),
      f('platform', 'Plataforma', 'select', { required: true, options: platformOptions, help: 'Detectada automaticamente pelo link.' }),
      f('label', 'Rótulo (opcional)', 'text', { help: 'Usado no texto alternativo do ícone.' }),
      f('visible', 'Visível no site', 'bool', { full: true }),
    ],
    defaults: { visible: true, platform: 'website' },
    row: (s) => ({
      lead: `<span class="row__thumb" style="color:${PLATFORMS[s.platform]?.color || 'inherit'}">${platformIcon(s.platform, 22)}</span>`,
      title: s.label || PLATFORMS[s.platform]?.label || s.platform,
      meta: `${s.url}${s.visible === false ? ' · oculto' : ''}`,
    }),
  },
  {
    id: 'textos', label: 'Textos & rodapé', desc: 'Títulos das seções e textos do rodapé.', kind: 'settings',
    fields: [
      // agrupados na ordem em que aparecem no site
      f('featured_eyebrow', 'Selo', 'text', { group: 'Projeto destaque', help: 'Texto pequeno acima do nome do projeto em destaque. O projeto é escolhido pela estrela na lista de Projetos.' }),
      f('projects_title', 'Título', 'text', { group: 'Lista de projetos', help: 'Título grande acima dos cards de projetos.' }),
      f('projects_subtitle', 'Subtítulo', 'text', { group: 'Lista de projetos', help: 'Frase logo abaixo do título.' }),
      f('studies_title', 'Título', 'text', { group: 'Trajetória', help: 'Título grande acima da formação, trabalhos e cursos.' }),
      f('studies_subtitle', 'Subtítulo', 'text', { group: 'Trajetória', help: 'Frase logo abaixo do título.' }),
      f('footer_cta', 'Chamada', 'text', { group: 'Rodapé', help: 'Frase grande no fim da página, acima do seu e-mail.' }),
      f('footer_text', 'Texto final', 'text', { group: 'Rodapé', help: 'Última linha da página, depois do ano e do seu nome: “2026 Seu nome — texto”.' }),
    ],
  },
  { group: 'Aparência' },
  {
    id: 'cores', label: 'Cores & tema', desc: 'As cores valem para o portfólio e para este painel. Clique no fundo, no texto ou nos botões das prévias para mudar cada cor.', kind: 'settings',
    body: themeEditor,
    fields: [
      f('color_accent', 'Cor de destaque', 'color', { required: true }),
      f('color_accent_2', 'Cor de destaque 2', 'color', { required: true }),
      f('color_bg_light', 'Fundo — tema claro', 'color', { required: true }),
      f('color_fg_light', 'Texto — tema claro', 'color', { required: true }),
      f('color_bg_dark', 'Fundo — tema escuro', 'color', { required: true }),
      f('color_fg_dark', 'Texto — tema escuro', 'color', { required: true }),
      f('default_theme', 'Tema padrão do visitante', 'select', { options: () => [{ value: 'system', label: 'Seguir o sistema' }, { value: 'light', label: 'Claro' }, { value: 'dark', label: 'Escuro' }] }),
    ],
  },
  { id: 'perfil', label: 'Meu perfil', desc: 'E-mail e senha de acesso ao painel.', kind: 'profile', nav: false, eyebrow: 'Conta' },
  { group: 'Extras' },
  {
    id: 'easter-eggs', label: 'Easter eggs', desc: 'Segredos escondidos no portfólio e como ativar cada um. Só um fica ativo por vez: ativar outro desfaz o anterior. Só você vê esta página.', kind: 'info',
    html: () => `
      <div class="eggs">
        <article class="card-box egg">
          <p class="egg__icon" aria-hidden="true">🚀</p>
          <h3>Nave escondida</h3>
          <p><strong>Como ativar:</strong> clique <strong>7 vezes</strong> no buraco negro do topo do site em até 4 segundos (no celular, toque 7 vezes).</p>
          <p><strong>O que acontece:</strong> uma navezinha escapa do buraco negro e 10 estrelas aparecem pela tela. Pilote com as <kbd>setas</kbd> ou <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> (ou só mova o mouse que ela segue) e colete todas. Coletando as 10, aparecem fogos de estrelas. <kbd>Esc</kbd> encerra a qualquer momento.</p>
        </article>
        <article class="card-box egg">
          <p class="egg__icon" aria-hidden="true">⚡</p>
          <h3>Modo hiperespaço</h3>
          <p><strong>Como ativar:</strong> com o site aberto, digite <kbd>w</kbd> <kbd>a</kbd> <kbd>r</kbd> <kbd>p</kbd> em qualquer lugar da página (fora da barra de pesquisa).</p>
          <p><strong>O que acontece:</strong> as estrelas viram riscos de luz, a tela treme de leve e a página “voa” sozinha até o fim do site. Se você já estiver no fim, ela volta voando para o início.</p>
        </article>
        <article class="card-box egg">
          <p class="egg__icon" aria-hidden="true">🪐</p>
          <h3>Gravidade zero</h3>
          <p><strong>Como ativar:</strong> com o site aberto, aperte no teclado <kbd>↑</kbd> <kbd>↓</kbd> <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> <kbd>←</kbd> <kbd>→</kbd> <kbd>A</kbd> <kbd>B</kbd> (o código Konami clássico <kbd>↑</kbd> <kbd>↑</kbd> <kbd>↓</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> <kbd>←</kbd> <kbd>→</kbd> <kbd>B</kbd> <kbd>A</kbd> também funciona).</p>
          <p><strong>O que acontece:</strong> títulos, palavras, cards, ícones, botões e até o rodapé se soltam e ficam flutuando sem parar, quicando nas bordas e <strong>colidindo uns com os outros</strong> (os maiores empurram os menores). Dá para <strong>arrastar e arremessar</strong> cada um com o mouse. Ao rolar a página ou ir para outra seção, o que aparece também se solta. O site continua funcionando normalmente: cliques abrem projetos e links, e a busca aceita digitação. Repetir o código religa a gravidade (ou ela volta sozinha depois de 1 minuto sem interação), e tudo retorna ao lugar com um efeito elástico.</p>
        </article>
        <article class="card-box egg">
          <p class="egg__icon" aria-hidden="true">👀</p>
          <h3>Mensagem no console</h3>
          <p><strong>Como ativar:</strong> abra o console do navegador (<kbd>F12</kbd> → aba <em>Console</em>) com o portfólio aberto.</p>
          <p><strong>O que aparece:</strong> um buraco negro desenhado em texto, um recado para recrutadores e devs curiosos com o seu e-mail (o mesmo da seção Identidade) e dicas dos outros dois segredos.</p>
        </article>
      </div>`,
  },
];

// ---------------------------------------------------------------------
//  Renderização das seções
// ---------------------------------------------------------------------
let currentId = 'identidade';
const content = $('#content');

// Ícones do menu (mesmo traço dos ícones da navbar do portfólio)
const NAV_ICONS = {
  identidade: '<rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="9" cy="11" r="2.2"/><path d="M5.8 16.2a3.4 3.4 0 0 1 6.4 0M14.5 10h4M14.5 13.5h3"/>',
  hero: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="3.5"/>',
  projetos: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>',
  tags: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.4"/>',
  sobre: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  trajetoria: '<path d="M2 9 12 4l10 5-10 5z"/><path d="M6 11v5c3 2.5 9 2.5 12 0v-5"/>',
  redes: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6"/>',
  textos: '<path d="M4 6V4h16v2M12 4v16M9 20h6"/>',
  cores: '<path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-2 0-1.5-1.5-1.8-1.5-3.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4-4-7-9-7z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10.5" cy="7" r="1.2"/><circle cx="15.5" cy="7.5" r="1.2"/>',
  'easter-eggs': '<path d="M12 3c3.5 0 6.5 5.5 6.5 10a6.5 6.5 0 0 1-13 0C5.5 8.5 8.5 3 12 3z"/><path d="m6 13 3-2 3 2 3-2 3 2"/>',
};
const navIcon = (id) => `<svg viewBox="0 0 24 24" aria-hidden="true">${NAV_ICONS[id] || '<circle cx="12" cy="12" r="8"/>'}</svg>`;

function renderNav() {
  $('#side-nav').innerHTML = SECTIONS.filter((s) => s.nav !== false).map((s) => (s.group
    ? `<p class="group">${s.group}</p>`
    : `<button type="button" data-section="${s.id}" ${s.id === currentId ? 'aria-current="page"' : ''}>${navIcon(s.id)}<span>${s.label}</span></button>`)).join('');
  // no celular o menu é uma fileira que desliza: mantém o item ativo à vista
  const nav = $('#side-nav'), cur = $('[aria-current="page"]', nav);
  nav.scrollLeft = 0;
  if (cur && matchMedia('(max-width: 860px)').matches) nav.scrollLeft = cur.offsetLeft - nav.offsetLeft - (nav.clientWidth - cur.offsetWidth) / 2;
}

$('#section-actions').addEventListener('click', (e) => {
  const byDate = e.target.closest('[data-date-sort]');
  if (byDate && dateCtx) {
    // ordena a lista inteira pela data (sem data vai para o fim) e salva a nova ordem
    const { table, list, key } = dateCtx;
    const dir = byDate.dataset.dateSort === 'asc' ? 1 : -1;
    const time = (x) => (x[key] ? new Date(x[key]).getTime() : null);
    const sorted = [...list].sort((a, b) => (time(a) === null) - (time(b) === null) || dir * (time(a) - time(b)));
    saveOrder(table, sorted).then((ok) => ok && toast(dir === 1 ? 'Ordenado do mais antigo para o mais recente' : 'Ordenado do mais recente para o mais antigo'));
    return;
  }
  if (!e.target.closest('#sort-toggle')) return;
  sorting = !sorting;
  renderSection();
});

// Clique com o mouse num item do menu: tira o foco para o menu fechar ao sair o mouse
// (pelo teclado, e.detail é 0 e o foco continua)
$('.side').addEventListener('click', (e) => { if (e.detail) e.target.closest('button, a')?.blur(); });

$('#side-nav').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-section]');
  if (!b || !(await leaveSettings())) return;
  currentId = b.dataset.section;
  sorting = false;
  history.replaceState(null, '', `#${currentId}`);
  renderSection();
  content.scrollIntoView({ block: 'start' });
});

// Logo do menu: o gato padrão ou as imagens enviadas em Identidade (claro/escuro)
function renderBrandMark() {
  const light = DATA.settings.logo_url, dark = DATA.settings.logo_dark_url || light;
  const cur = $('#open-profile .mark');
  if (!cur) return;
  const img = (src, cls) => `<img class="${cls}" src="${esc(safeUrl(src))}" alt="">`;
  cur.outerHTML = light || dark
    ? `<span class="mark mark--custom" aria-hidden="true">${img(light || dark, 'is-light')}${img(dark, 'is-dark')}</span>`
    : '<svg class="mark" viewBox="0 0 1110 740" aria-hidden="true" focusable="false"><use href="#mk-cat"/></svg>';
}

function renderSection() {
  const sec = SECTIONS.find((s) => s.id === currentId) || SECTIONS[1];
  renderNav();
  renderBrandMark();
  $$('[data-bind="site_name"]').forEach((el) => { el.textContent = DATA.settings.site_name || 'Portfólio'; });
  // o grupo do menu (Conteúdo, Aparência…) vira o selo acima do título
  let group = '';
  for (const s of SECTIONS) { if (s.group) group = s.group; if (s === sec) break; }
  if (sec.eyebrow) group = sec.eyebrow;
  $('#section-group').textContent = group;
  $('#section-title').innerHTML = `${esc(sec.label)}${tip(sec.desc)}`;
  $('#section-actions').innerHTML = '';
  content.classList.toggle('is-sorting', sorting);
  if (sec.kind === 'settings') renderSettings(sec);
  if (sec.kind === 'collection') renderCollection(sec);
  if (sec.kind === 'projects') renderProjects();
  if (sec.kind === 'info') content.innerHTML = sec.html();
  if (sec.kind === 'profile') renderProfile();
}

// Campos com "group" viram um cartão por parte do site (com o nome no topo)
function settingsCards(fields) {
  const groups = [];
  for (const fd of fields) {
    const last = groups[groups.length - 1];
    if (last && last.name === fd.group) last.fields.push(fd);
    else groups.push({ name: fd.group, fields: [fd] });
  }
  return groups.map((g) => `<div class="card-box">${g.name ? `<h3>${esc(g.name)}</h3>` : ''}<div class="form-grid">${g.fields
    .map((fd) => fieldHtml(fd, DATA.settings[fd.key])).join('')}</div></div>`).join('');
}

// Cores & tema: as duas prévias SÃO o formulário. Clicar no fundo, no texto
// ou nos botões abre o painel de cor daquela parte.
function themeEditor(v) {
  const hidden = ['color_accent', 'color_accent_2', 'color_bg_light', 'color_fg_light', 'color_bg_dark', 'color_fg_dark']
    .map((k) => `<input type="hidden" name="${k}" value="${esc(v[k] || '')}" required>`).join('');
  const pick = (key, label) => `data-color-open data-color-for="${key}" data-label="${label}" aria-label="${label}: escolher cor"`;
  const pane = (mode, name) => `
    <div class="tp tp--${mode}">
      <button class="tp__bg" type="button" ${pick(`color_bg_${mode}`, 'Fundo')}></button>
      <span class="tp__tag">${name}</span>
      <button class="tp__text" type="button" ${pick(`color_fg_${mode}`, 'Texto')}>
        <strong>${esc(v.site_name || 'Seu nome')}</strong>
        <span>Assim fica o texto sobre o fundo.</span>
      </button>
      <span class="tp__btns">
        <button class="tp__btn tp__btn--a" type="button" ${pick('color_accent', 'Destaque')}>Destaque</button>
        <button class="tp__btn tp__btn--b" type="button" ${pick('color_accent_2', 'Destaque 2')}>Destaque 2</button>
      </span>
    </div>`;
  const theme = v.default_theme || 'system';
  return `
    <div class="theme-editor" id="theme-editor">
      ${hidden}
      <div class="theme-editor__bar">
        <span class="field-label">Tema que o visitante vê primeiro</span>
        <div class="seg" role="group" aria-label="Tema padrão do visitante">
          ${[['system', 'Seguir o sistema'], ['light', 'Claro'], ['dark', 'Escuro']].map(([val, l]) => `<button type="button" data-theme-pick="${val}" aria-pressed="${theme === val}">${l}</button>`).join('')}
        </div>
        <input type="hidden" name="default_theme" value="${esc(theme)}">
      </div>
      <div class="theme-editor__panes">${pane('light', 'Tema claro')}${pane('dark', 'Tema escuro')}</div>
      <p class="theme-editor__hint muted small">Clique no fundo, no texto ou nos botões para mudar a cor.</p>
    </div>`;
}

function renderSettings(sec) {
  content.innerHTML = `
    <form class="form${sec.fields.some((fd) => fd.group) ? ' form--groups' : ''}" id="settings-form" novalidate>
      ${sec.body ? sec.body(DATA.settings) : settingsCards(sec.fields)}
      <div class="form-actions">
        <button class="btn btn--ghost" type="button" id="settings-reset" disabled>Descartar</button>
        <button class="btn btn--primary" type="submit" id="settings-save" disabled>Salvar alterações</button>
      </div>
    </form>`;
  const form = $('#settings-form');
  $$('[data-list]', form).forEach(fitChips);
  const dirty = (on) => { $('#settings-save').disabled = !on; $('#settings-reset').disabled = !on; };
  const refreshPreview = () => {
    if (sec.id !== 'cores') return;
    const c = readFields(form, sec.fields);
    applyColors({ ...DATA.settings, ...c });
    // só troca as variáveis: o botão que está com o painel de cor aberto continua no lugar
    const ed = $('#theme-editor');
    [['--a', c.color_accent], ['--b', c.color_accent_2], ['--bg-l', c.color_bg_light], ['--fg-l', c.color_fg_light], ['--bg-d', c.color_bg_dark], ['--fg-d', c.color_fg_dark]]
      .forEach(([k, val]) => ed.style.setProperty(k, val));
  };
  if (sec.id === 'cores') {
    form.addEventListener('click', (e) => {
      const b = e.target.closest('[data-theme-pick]');
      if (!b) return;
      form.elements.default_theme.value = b.dataset.themePick;
      $$('[data-theme-pick]', form).forEach((x) => x.setAttribute('aria-pressed', x === b));
      dirty(true);
    });
  }
  refreshPreview();
  form.addEventListener('input', () => { dirty(true); refreshPreview(); });
  form.addEventListener('change', () => dirty(true));
  $('#settings-reset').addEventListener('click', () => { applyColors(DATA.settings); cleanupFiles([...sessionUploads]); renderSettings(sec); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.checkValidity()) return form.reportValidity();
    if (uploads.n) return toast('Espere o envio do arquivo terminar para salvar.', 'error');
    $('#settings-save').disabled = true;
    try {
      await withCleanup(() => db.saveSettings(readFields(form, sec.fields)));
      applyColors(DATA.settings);
      dirty(false);
      renderNav();
      renderBrandMark();
      toast('Alterações salvas');
    } catch (err) {
      $('#settings-save').disabled = false;
      toast(errorMessage(err), 'error');
    }
  });
}

// Lista genérica: tags, trajetória e redes sociais
const listState = {};
function renderCollection(sec) {
  const list = [...DATA[TABLE_KEY[sec.table]]].sort(bySort);
  $('#section-actions').innerHTML = `${dateSortButtons(sec.table, list, sec.dateKey)}${sortToggle(list.length)}<button class="btn btn--primary" type="button" id="new-item">Adicionar ${sec.singular}</button>`;
  $('#new-item').onclick = () => editItem(sec, { ...sec.defaults });

  // Trajetória: separa por tipo (Trabalho / Formação / Curso) e tem busca
  const st = (listState[sec.id] ??= { q: '', kind: 'all' });
  // em que filtros o item entra (Trajetória: o tipo; Tags: todos os estados em que é usada)
  const kindsOf = sec.kinds || ((x) => [x.kind || '']);
  const bar = sec.groups && list.length ? `<div class="projects-bar">
      <label class="search">${ICON.search}<span class="visually-hidden">Pesquisar</span>
        <input type="search" id="list-search" placeholder="Pesquisar" value="${esc(st.q)}" autocomplete="off"></label>
      <div class="seg" role="group" aria-label="Mostrar">
        ${[['all', 'Todos'], ...Object.entries(sec.groups)].map(([v, l]) => `<button type="button" data-kind="${v}" aria-pressed="${st.kind === v}">${l} <span class="badge">${v === 'all' ? list.length : list.filter((x) => kindsOf(x).includes(v)).length}</span></button>`).join('')}
      </div>
    </div>` : '';

  content.innerHTML = list.length
    ? `${bar}<div class="${sec.card ? 'tagcards' : sec.groups ? 'cards' : 'rows'}" id="list-rows">${list.map((item, i) => {
      const r = sec.row(item);
      const kinds = kindsOf(item);
      const hay = esc(normalizeText(`${r.title} ${r.meta} ${KIND_LABEL[item.kind] || ''} ${kinds.map((k) => sec.groups?.[k] || '').join(' ')}`));
      const tools = `<div class="row__tools">${reorderButtons(i, list.length)}${editButton(item.id)}${deleteButton(item.id)}</div>`;
      if (sec.card) return `<div class="row tagcard" data-hay="${hay}" data-kind="${esc(kinds.join(' '))}">${sec.card(item)}${tools}</div>`;
      // trajetória em cards (como os blocos de projetos do site, mais simples)
      if (sec.groups) return `<div class="row tile tile--text" data-hay="${hay}" data-kind="${esc(item.kind || '')}">
        <div class="tile__top">${r.lead}${tools}</div>
        <p class="tile__title tile__title--2" title="${esc(r.title)}">${esc(r.title)}</p>
        <p class="tile__meta">${esc(r.meta)}</p>
      </div>`;
      return `<div class="row" data-hay="${hay}" data-kind="${esc(item.kind || '')}">
        <span class="row__lead">${r.lead}</span>
        <div class="row__text"><p class="row__title"><span class="row__name">${esc(r.title)}</span></p><p class="row__meta">${esc(r.meta)}</p></div>
        ${tools}
      </div>`;
    }).join('')}</div>
      <div class="empty-state" id="list-none" hidden><h3>Nada encontrado</h3><p>Tente outro nome.</p></div>
      <nav class="pager" id="pager" aria-label="Páginas" hidden></nav>`
    : `<div class="empty-state"><h3>Nada por aqui ainda</h3><p>Adicione o primeiro item para ele aparecer no site.</p><button class="btn btn--primary" type="button" data-new>Adicionar ${sec.singular}</button></div>`;

  const refresh = () => {
    if (!list.length) return;
    const terms = sorting ? [] : normalizeText(st.q.trim()).split(/\s+/).filter(Boolean);
    const rows = $$('#list-rows .row').filter((row) => {
      const ok = terms.every((t) => row.dataset.hay.includes(t)) && (sorting || st.kind === 'all' || row.dataset.kind.split(' ').includes(st.kind));
      row.hidden = !ok;
      return ok;
    });
    $('#list-none').hidden = rows.length > 0;
    paginate(rows, sec.id, refresh);
  };
  $('#list-search')?.addEventListener('input', (e) => { st.q = e.target.value; listPages[sec.id] = 0; refresh(); });
  $$('.seg [data-kind]').forEach((b) => b.addEventListener('click', () => {
    st.kind = b.dataset.kind;
    listPages[sec.id] = 0;
    $$('.seg [data-kind]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    refresh();
  }));
  refresh();

  content.onclick = (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) editItem(sec, list.find((x) => x.id === ed.dataset.edit));
    if (e.target.closest('[data-new]')) editItem(sec, { ...sec.defaults });
    const mv = e.target.closest('[data-move]');
    if (mv) move(sec.table, list, Number(mv.dataset.index), Number(mv.dataset.move));
    const del = e.target.closest('[data-delete]');
    if (del) removeRow(sec.table, list.find((x) => x.id === del.dataset.delete), sec.singular);
  };
}

const deleteButton = (id) => `<button class="btn btn--icon btn--sm btn--ghost row__del" type="button" data-delete="${esc(id)}" aria-label="Excluir" title="Excluir">${ICON.trash}</button>`;

// Excluir direto da lista (com confirmação pelo nome)
async function removeRow(table, row, kind) {
  if (!row || !(await confirmDelete(row.title || row.name || row.label || row.url, kind))) return;
  try {
    // apaga também os arquivos (capa, mídias, certificado) que só ele usava
    await withCleanup(() => db.deleteRow(table, row.id));
    // excluir o projeto em destaque tira o destaque (no banco o FK já zera)
    if (table === 'projects' && DATA.settings.featured_project_id === row.id) {
      DATA.settings.featured_project_id = null;
    }
    // tag excluída sai de todos os projetos (no banco o cascade já tirou)
    if (table === 'tags') {
      DATA.projects.forEach((p) => {
        p.tag_ids = (p.tag_ids || []).filter((id) => id !== row.id);
        if (p.tags) p.tags = p.tags.filter((t) => t.id !== row.id);
      });
    }
    toast(`${kind[0].toUpperCase()}${kind.slice(1)} excluído`);
    renderSection();
  } catch (err) {
    toast(errorMessage(err), 'error');
  }
}

const reorderButtons = (i, n) => `
  <button class="btn btn--icon btn--sm btn--ghost" type="button" data-move="-1" data-index="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Mover para cima">${ICON.up}</button>
  <button class="btn btn--icon btn--sm btn--ghost" type="button" data-move="1" data-index="${i}" ${i === n - 1 ? 'disabled' : ''} aria-label="Mover para baixo">${ICON.down}</button>`;

async function move(table, list, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  const reordered = [...list];
  [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
  await saveOrder(table, reordered);
}

async function saveOrder(table, reordered) {
  try {
    // Renumera só o que mudou de posição.
    await Promise.all(reordered.map((item, k) => (item.sort_order !== k ? db.saveRow(table, { id: item.id, sort_order: k }) : null)));
    reordered.forEach((item, k) => { item.sort_order = k; });
    renderSection();
    return true;
  } catch (err) {
    toast(errorMessage(err), 'error');
    return false;
  }
}

function editItem(sec, item) {
  const isNew = !item.id;
  openDrawer({
    title: isNew ? `Adicionar ${sec.singular}` : `Editar ${sec.singular}`,
    body: `<div class="form-grid">${sec.fields.map((fd) => fieldHtml(fd, item[fd.key])).join('')}</div>`,
    saveLabel: isNew ? `Adicionar ${sec.singular}` : 'Salvar alterações',
    onSave: async (form) => {
      const row = readFields(form, sec.fields);
      // a mesma regra do banco (education_dates_chk), avisada antes de enviar
      if (row.start_date && row.end_date && row.end_date < row.start_date) throw fileError('A data de conclusão está antes da data de início.');
      await db.saveRow(sec.table, isNew ? row : { id: item.id, ...row });
      toast(isNew ? 'Item adicionado' : 'Alterações salvas');
    },
  });
  // Redes sociais: detecta a plataforma pelo link digitado.
  if (sec.table === 'social_links') {
    const form = $('#drawer-form');
    form.elements.url.addEventListener('input', (e) => { form.elements.platform.value = guessPlatform(e.target.value); });
  }
}

// ---------------------------------------------------------------------
//  Projetos
// ---------------------------------------------------------------------
const STAR = (on) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"${on ? ' style="fill:currentColor"' : ''}><path d="m12 3 2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6-4.5-4.1 6-.7z"/></svg>`;
let projectQuery = '';
let projectStatus = 'all'; // all | published | offline | draft
// Publicado: no site. Offline: já foi publicado e saiu do ar. Rascunho: ainda não foi publicado.
const projectState = (p) => (p.published !== false ? 'published' : p.offline ? 'offline' : 'draft');
// estado do projeto → filtro da seção Tags
const TAG_STATE = { published: 'online', offline: 'offline', draft: 'rascunho' };
// quantos projetos de cada estado usam a tag
function tagUse(t) {
  const use = { published: 0, offline: 0, draft: 0 };
  DATA.projects.forEach((p) => { if (p.tag_ids?.includes(t.id)) use[projectState(p)]++; });
  return use;
}
const STATE_BADGE = { offline: '<span class="badge badge--off">Offline</span>', draft: '<span class="badge badge--draft">Rascunho</span>', published: '' };

function renderProjects() {
  const list = [...DATA.projects].sort(bySort);
  $('#section-actions').innerHTML = `${dateSortButtons('projects', list, 'project_date')}${sortToggle(list.length)}<button class="btn btn--primary" type="button" id="new-project">Adicionar projeto</button>`;
  $('#new-project').onclick = () => editProject({ published: false, media: [], links: [], tag_ids: [] });
  const count = (st) => list.filter((p) => projectState(p) === st).length;
  const tagName = (id) => DATA.tags.find((t) => t.id === id)?.name;
  const featured = list.find((p) => p.id === DATA.settings.featured_project_id);
  // capa, ou a primeira imagem das mídias (projeto só com vídeo fica sem miniatura)
  const thumb = (p) => {
    const src = p.cover_url || p.media.find((m) => mediaKind(m) === 'image')?.url;
    return src ? `<img src="${esc(safeUrl(src))}" alt="" loading="lazy" decoding="async">` : '—';
  };

  content.innerHTML = list.length
    ? `<div class="projects-bar">
        <label class="search">
          <svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <span class="visually-hidden">Pesquisar projetos</span>
          <input type="search" id="project-search" placeholder="Pesquisar por nome, tag ou descrição" value="${esc(projectQuery)}" autocomplete="off">
        </label>
        <div class="seg" role="group" aria-label="Mostrar">
          ${[['all', 'Todos', list.length], ['published', 'Publicados', count('published')], ['offline', 'Offline', count('offline')], ['draft', 'Rascunhos', count('draft')]]
            .map(([v, l, n]) => `<button type="button" data-status="${v}" aria-pressed="${projectStatus === v}">${l} <span class="badge">${n}</span></button>`).join('')}
        </div>
        <p class="feat-now">${featured
          ? `${STAR(true)}<span>Destaque: <strong>${esc(featured.title)}</strong></span>`
          : `${STAR(false)}<span>Nenhum destaque</span>`}${tip('Clique na estrela de um projeto para ele virar o destaque do site.')}</p>
      </div>
      <div class="cards" id="project-rows">${list.map((p, i) => {
        const on = p.id === DATA.settings.featured_project_id;
        const hay = normalizeText([p.title, p.short_description, ...p.tag_ids.map(tagName)].join(' '));
        return `
      <div class="row tile${on ? ' is-featured' : ''}${p.published === false ? ' is-draft' : ''}" data-hay="${esc(hay)}" data-status="${projectState(p)}">
        <div class="tile__frame">${thumb(p)}
          <span class="tile__badges">${STATE_BADGE[projectState(p)]}</span>
          <div class="row__tools">
            <button class="btn btn--icon btn--sm btn--ghost star${on ? ' is-on' : ''}" type="button" data-feature="${esc(p.id)}" aria-pressed="${on}" aria-label="${on ? 'Tirar do destaque' : 'Colocar em destaque'}" title="${on ? 'Tirar do destaque' : 'Colocar em destaque'}">${STAR(on)}</button>
            ${reorderButtons(i, list.length)}${editButton(p.id)}${deleteButton(p.id)}
          </div>
        </div>
        <p class="tile__title" title="${esc(p.title)}">${esc(p.title)}</p>
        <p class="tile__meta">${esc([formatDate(p.project_date), p.tag_ids.map(tagName).filter(Boolean).slice(0, 3).join(', ')].filter(Boolean).join(' · '))}</p>
      </div>`;
      }).join('')}</div>
      <div class="empty-state" id="project-none" hidden><h3>Nenhum projeto encontrado</h3><p>Tente outro nome ou tag.</p></div>
      <nav class="pager" id="pager" aria-label="Páginas" hidden></nav>`
    : '<div class="empty-state"><h3>Nenhum projeto ainda</h3><p>Adicione seu primeiro trabalho com imagens, vídeos e links.</p><button class="btn btn--primary" type="button" data-new>Adicionar projeto</button></div>';

  // Pesquisa: filtra a lista na hora (sem acento, todas as palavras)
  const search = $('#project-search');
  const filter = () => {
    projectQuery = search.value;
    // no modo de posições a lista aparece completa (sem busca nem filtro)
    const terms = sorting ? [] : normalizeText(projectQuery.trim()).split(/\s+/).filter(Boolean);
    const rows = $$('#project-rows .row').filter((row) => {
      const ok = terms.every((t) => row.dataset.hay.includes(t)) && (sorting || projectStatus === 'all' || row.dataset.status === projectStatus);
      row.hidden = !ok;
      return ok;
    });
    $('#project-none').hidden = rows.length > 0;
    paginate(rows, 'projetos', filter);
    $('#project-none h3').textContent = terms.length ? 'Nenhum projeto encontrado' : { draft: 'Nenhum rascunho', offline: 'Nenhum projeto offline' }[projectStatus] || 'Nenhum projeto encontrado';
  };
  $$('.seg [data-status]').forEach((b) => b.addEventListener('click', () => {
    projectStatus = b.dataset.status;
    listPages.projetos = 0;
    $$('.seg [data-status]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    filter();
  }));
  if (search) { search.addEventListener('input', () => { listPages.projetos = 0; filter(); }); filter(); }

  content.onclick = async (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) editProject(list.find((p) => p.id === ed.dataset.edit));
    if (e.target.closest('[data-new]')) $('#new-project').click();
    const mv = e.target.closest('[data-move]');
    if (mv) move('projects', list, Number(mv.dataset.index), Number(mv.dataset.move));
    const del = e.target.closest('[data-delete]');
    if (del) removeRow('projects', list.find((p) => p.id === del.dataset.delete), 'projeto');
    // Estrela: escolhe o projeto destaque do site (clicar de novo tira)
    const st = e.target.closest('[data-feature]');
    if (st) {
      const id = st.dataset.feature;
      const next = DATA.settings.featured_project_id === id ? null : id;
      if (next && list.find((p) => p.id === id)?.published === false) return toast('Publique o projeto antes de colocá-lo em destaque.', 'error');
      try {
        await db.saveSettings({ featured_project_id: next });
        toast(next ? 'Projeto colocado em destaque' : 'Destaque removido');
        renderProjects();
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    }
  };
}

// Divididos em duas abas para o editor caber na tela sem rolagem.
const PROJECT_INFO_FIELDS = [
  f('title', 'Nome do projeto', 'text', { required: true }),
  f('project_date', 'Data de realização', 'date'),
  f('short_description', 'Descrição curta', 'textarea', { full: true, rows: 3 }),
];
const PROJECT_LOOK_FIELDS = [
  f('cover_url', 'Capa', 'image', { full: true, folder: 'projetos', help: 'Aparece no card. Sem capa, usa a primeira imagem da galeria.' }),
  f('accent_color', 'Cor do projeto', 'color', { help: 'Cor do brilho do card.' }),
  f('slug', 'Slug', 'text', { help: 'Link direto: #projeto/slug. Vazio = gerado pelo nome.' }),
];
const PROJECT_FIELDS = [...PROJECT_INFO_FIELDS, ...PROJECT_LOOK_FIELDS];

function editProject(p) {
  const isNew = !p.id;
  const state = isNew ? 'draft' : projectState(p);
  const draft = state !== 'published';
  const media = structuredClone(p.media || []);
  const links = structuredClone(p.links || []);
  // Tags escolhidas: as que já existem (com id) e as novas (só nome + cor)
  const chosen = DATA.tags.filter((t) => p.tag_ids?.includes(t.id));
  const TAG_COLORS = ['#2f7bff', '#00c2ff', '#5b6cff', '#38bdf8', '#7fb2ff', '#0ea5e9', '#8b5cf6', '#1e40af'];

  openDrawer({
    title: isNew ? 'Adicionar projeto' : `Editar “${p.title}”`,
    // Rascunho e offline ficam só no painel; publicar manda para o site.
    // Novo, rascunho ou offline: [Salvar como rascunho] [Publicar]. Publicado: [Tirar do ar] [Salvar].
    saveLabel: draft ? 'Publicar no site' : 'Salvar projeto',
    altLabel: draft ? 'Salvar como rascunho' : 'Tirar do ar',
    status: isNew ? null : { published: { label: 'Publicado', kind: 'live' }, offline: { label: 'Offline', kind: 'off' }, draft: { label: 'Rascunho', kind: 'draft' } }[state],
    // Abas: cada parte cabe na gaveta sem precisar rolar.
    body: `
      <div class="tabs" role="tablist" aria-label="Partes do projeto">
        <button type="button" role="tab" data-tab="info" aria-selected="true">Informações</button>
        <button type="button" role="tab" data-tab="look" aria-selected="false">Capa &amp; tags</button>
        <button type="button" role="tab" data-tab="media" aria-selected="false">Mídias <span class="badge" id="count-media"></span></button>
        <button type="button" role="tab" data-tab="links" aria-selected="false">Links <span class="badge" id="count-links"></span></button>
      </div>
      <section class="pane" data-pane="info" role="tabpanel">
        <div class="form-grid">${PROJECT_INFO_FIELDS.map((fd) => fieldHtml(fd, p[fd.key])).join('')}</div>
      </section>
      <section class="pane" data-pane="look" role="tabpanel" hidden>
        <div class="form-grid">${PROJECT_LOOK_FIELDS.map((fd) => fieldHtml(fd, p[fd.key])).join('')}</div>
        <div class="field tags-field">
          <span class="field-label">Tags${tip('Digite para achar uma tag que já existe; se não existir, aperte Enter para criar.')}</span>
          <div class="tag-bar">
            <div class="tag-combo">
              <label class="search">
                <svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.4"/></svg>
                <input type="text" id="tag-new" placeholder="Buscar ou criar tag" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="tag-suggest" aria-label="Buscar ou criar tag">
              </label>
              <div class="tag-pop" id="tag-suggest" role="listbox" hidden></div>
            </div>
            <div class="tag-combo">
              <button class="btn btn--ghost tag-all-btn" type="button" id="tag-all-btn" aria-expanded="false" aria-controls="tag-all">
                <svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>Todas as tags
              </button>
              <div class="tag-pop tag-pop--all" id="tag-all" hidden></div>
            </div>
          </div>
          <div class="tag-chosen" id="tag-chips" aria-live="polite"></div>
        </div>
      </section>
      <section class="pane" data-pane="media" role="tabpanel" hidden>
        <div class="media-add">
          <button class="media-add__drop" type="button" id="add-files" data-dropzone>
            ${UPLOAD_ICON}<strong>Enviar imagens ou vídeos</strong><small>ou arraste até aqui</small>
          </button>
          <div class="media-add__yt">
            <label class="search yt-input"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="4"/><path d="m10 9.5 5 2.5-5 2.5z"/></svg>
              <input type="url" id="yt-url" placeholder="Cole o link do vídeo do YouTube" aria-label="Link do vídeo do YouTube"></label>
            <button class="btn btn--primary" type="button" id="add-yt">Adicionar vídeo</button>
          </div>
        </div>
        <div class="pane-head pane-head--end"><button class="btn btn--ghost btn--sm" type="button" data-sort-rep="rep-media" aria-pressed="false">${ICON.sort}Editar posições</button></div>
        <div class="repeater repeater--grid" id="rep-media"></div>
      </section>
      <section class="pane" data-pane="links" role="tabpanel" hidden>
        <div class="pane-head"><button class="btn btn--primary btn--sm" type="button" id="add-link">Adicionar link</button>${tip('Cole o link: a rede é reconhecida pelo endereço e o botão no site ganha o texto “Ver no Behance”, “Ver no LinkedIn”…')}
          <button class="btn btn--ghost btn--sm" type="button" data-sort-rep="rep-links" aria-pressed="false">${ICON.sort}Editar posições</button></div>
        <div class="repeater" id="rep-links"></div>
      </section>`,
    onSave: async (form, { alt }) => {
      const fields = readFields(form, PROJECT_FIELDS);
      // botão principal publica (ou mantém publicado); o secundário tira do ar
      // (publicado → offline) ou guarda como rascunho (novo/rascunho/offline → rascunho)
      const published = !alt;
      const offline = alt && state === 'published';
      // tags novas digitadas aqui viram tags de verdade antes de salvar o projeto
      const tag_ids = [];
      for (const t of chosen) {
        if (t.id) { tag_ids.push(t.id); continue; }
        const created = await db.saveRow('tags', { name: t.name, slug: slugify(t.name), color: t.color });
        t.id = created.id; // se o projeto falhar ao salvar, a nova tentativa reaproveita a tag
        tag_ids.push(created.id);
      }
      const payload = {
        ...(isNew ? {} : { id: p.id }),
        ...fields,
        slug: fields.slug || '',
        published,
        offline,
        tag_ids,
        media: media.filter((m) => m.url),
        links: links.filter((l) => l.url),
      };
      await db.saveProject(payload);
      toast(offline ? 'Projeto tirado do ar — está offline' : !published ? 'Rascunho salvo — não aparece no site' : draft ? 'Projeto publicado no site' : 'Projeto salvo');
      // o destaque precisa ser um projeto publicado: se ele saiu do ar, sai do destaque
      if (!published && !isNew && DATA.settings.featured_project_id === p.id) {
        await db.saveSettings({ featured_project_id: null });
        toast('Ele era o projeto em destaque: o destaque foi removido do site.');
      }
    },
  });

  const repMedia = $('#rep-media');
  const repLinks = $('#rep-links');
  const tools = (i, n) => `<div class="rep-item__tools">
    <button class="btn btn--icon btn--sm btn--ghost" type="button" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Subir">${ICON.up}</button>
    <button class="btn btn--icon btn--sm btn--ghost" type="button" data-down="${i}" ${i === n - 1 ? 'disabled' : ''} aria-label="Descer">${ICON.down}</button>
    <button class="btn btn--icon btn--sm btn--danger" type="button" data-remove="${i}" aria-label="Remover">${ICON.x}</button></div>`;

  let drawMedia = () => {
    repMedia.innerHTML = media.length ? media.map((m, i) => `
      <div class="rep-item" data-i="${i}">
        <div class="rep-item__thumb">${previewHtml(m.url, m.type === 'video' ? 'video' : undefined)}
          <span class="rep-item__kind">${m.type === 'embed' || youtubeId(m.url) ? 'YouTube' : m.type === 'video' ? 'Vídeo' : 'Imagem'}</span></div>
        <input class="input" type="text" data-k="caption" value="${esc(m.caption || '')}" placeholder="Legenda (opcional)" aria-label="Legenda">
        ${tools(i, media.length)}
      </div>`).join('') : '<p class="muted">Nenhuma mídia ainda.</p>';
  };

  let drawLinks = () => {
    repLinks.innerHTML = links.length ? links.map((l, i) => `
      <div class="rep-item rep-item--link" data-i="${i}">
        <select class="input" data-k="platform" aria-label="Plataforma">
          ${platformOptions().map((o) => `<option value="${o.value}" ${l.platform === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
        <div class="rep-item__fields">
          <input class="input" type="url" data-k="url" value="${esc(l.url)}" placeholder="Cole o link (Behance, LinkedIn, Instagram, site…)" aria-label="Link">
        </div>
        ${tools(i, links.length)}
      </div>`).join('') : '<p class="muted">Nenhum link ainda.</p>';
  };

  const bindRepeater = (el, arr, draw) => {
    el.addEventListener('input', (e) => {
      const item = e.target.closest('[data-i]');
      const k = e.target.dataset.k;
      if (!item || !k) return;
      const obj = arr[Number(item.dataset.i)];
      obj[k] = e.target.value;
      if (arr === links && k === 'url' && !obj.platformTouched) {
        obj.platform = guessPlatform(e.target.value);
        $('[data-k="platform"]', item).value = obj.platform;
      }
      if (arr === links && k === 'platform') obj.platformTouched = true;
      // o texto do botão no site é automático: segue a rede escolhida
      if (arr === links) obj.label = '';
    });
    el.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT') e.target.dispatchEvent(new Event('input', { bubbles: true })); });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-up], [data-down], [data-remove]');
      if (!b) return;
      if (b.dataset.remove !== undefined) arr.splice(Number(b.dataset.remove), 1);
      const i = Number(b.dataset.up ?? b.dataset.down);
      const j = b.dataset.up !== undefined ? i - 1 : i + 1;
      if (b.dataset.remove === undefined) [arr[i], arr[j]] = [arr[j], arr[i]];
      draw();
    });
  };
  // Contadores nas abas
  const baseMedia = drawMedia, baseLinks = drawLinks;
  // o botão "Editar posições" só aparece com 2 itens ou mais
  const sortBtn = (id, n) => { const b = $(`[data-sort-rep="${id}"]`); b.hidden = n < 2; };
  drawMedia = () => { baseMedia(); $('#count-media').textContent = media.length || ''; sortBtn('rep-media', media.length); };
  drawLinks = () => { baseLinks(); $('#count-links').textContent = links.length || ''; sortBtn('rep-links', links.length); };
  bindRepeater(repMedia, media, () => drawMedia());
  bindRepeater(repLinks, links, () => drawLinks());
  drawMedia();
  drawLinks();

  $('#add-link').onclick = () => { links.push({ platform: 'website', url: '', label: '' }); drawLinks(); $$('[data-k="url"]', repLinks).at(-1).focus(); };

  // Vídeo do YouTube: só o link
  const addYoutube = () => {
    const input = $('#yt-url');
    const id = youtubeId(input.value.trim());
    if (!id) { toast('Esse link não parece ser de um vídeo do YouTube.', 'error'); input.focus(); return; }
    media.push({ type: 'embed', url: `https://www.youtube.com/watch?v=${id}`, caption: '' });
    input.value = '';
    drawMedia();
  };
  $('#add-yt').onclick = addYoutube;
  $('#yt-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addYoutube(); } });

  // Imagens e vídeos: arquivos (clicando ou arrastando)
  const addFiles = async (files) => {
    const drop = $('#add-files');
    const title = $('strong', drop);
    drop.disabled = true;
    for (const [k, file] of [...files].entries()) {
      title.textContent = `Enviando ${k + 1} de ${files.length}…`;
      try {
        const url = await db.upload(file, 'projetos', 'image/*,video/*');
        media.push({ type: file.type.startsWith('video') ? 'video' : 'image', url, caption: '' });
        drawerDirty = true;
        drawMedia();
      } catch (err) {
        toast(`${file.name}: ${errorMessage(err)}`, 'error');
      }
    }
    drop.disabled = false;
    title.textContent = 'Enviar imagens ou vídeos';
  };
  $('#add-files').onclick = () => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*,video/*', multiple: true });
    input.onchange = () => addFiles(input.files);
    input.click();
  };
  $('#add-files').addEventListener('drop', (e) => {
    e.preventDefault();
    e.currentTarget.classList.remove('is-over');
    addFiles(e.dataTransfer.files);
  });

  // Tags: barra para buscar/criar + botão com todas as tags; as do projeto
  // ficam listadas embaixo, cada uma com o × para tirar.
  const tagNew = $('#tag-new');
  const suggest = $('#tag-suggest');
  const allPop = $('#tag-all');
  const allBtn = $('#tag-all-btn');
  let hi = 0; // sugestão destacada (setas ↑ ↓)
  const isChosen = (t) => chosen.some((c) => (c.id ? c.id === t.id : normalizeText(c.name) === normalizeText(t.name)));
  const tagChip = (t) => `<span class="chip" style="--chip:${esc(t.color)}">${esc(t.name)}</span>`;

  const drawChosen = () => {
    $('#tag-chips').innerHTML = chosen.length
      ? chosen.map((t, i) => `<span class="chip" style="--chip:${esc(t.color)}">${esc(t.name)}${t.id ? '' : ' <em>nova</em>'}<button type="button" data-tag-remove="${i}" aria-label="Tirar ${esc(t.name)}">${ICON.x}</button></span>`).join('')
      : '<span class="muted small">Nenhuma tag no projeto ainda.</span>';
    allBtn.innerHTML = `${allBtn.querySelector('svg').outerHTML}Todas as tags${DATA.tags.length ? ` <span class="badge">${DATA.tags.length}</span>` : ''}`;
  };
  const drawSuggest = () => {
    const raw = tagNew.value.trim();
    const q = normalizeText(raw);
    if (!q) { suggest.hidden = true; tagNew.setAttribute('aria-expanded', 'false'); return; }
    const hits = DATA.tags.filter((t) => normalizeText(t.name).includes(q));
    const exact = DATA.tags.some((t) => normalizeText(t.name) === q) || chosen.some((t) => normalizeText(t.name) === q);
    const items = [
      ...hits.map((t) => ({ t, done: isChosen(t) })),
      ...(exact ? [] : [{ create: raw }]),
    ];
    hi = Math.min(hi, items.length - 1);
    suggest.innerHTML = items.map((it, i) => (it.create
      ? `<button type="button" role="option" class="tag-opt${i === hi ? ' is-hi' : ''}" data-tag-create="${esc(it.create)}"><span class="tag-opt__plus">+</span>Criar tag “${esc(it.create)}”</button>`
      : `<button type="button" role="option" class="tag-opt${i === hi ? ' is-hi' : ''}" data-tag-add="${esc(it.t.id)}" ${it.done ? 'disabled' : ''}>${tagChip(it.t)}${it.done ? '<span class="tag-opt__note">já no projeto</span>' : ''}</button>`)).join('');
    suggest.hidden = !items.length;
    tagNew.setAttribute('aria-expanded', String(!suggest.hidden));
  };
  const drawAll = () => {
    allPop.innerHTML = DATA.tags.length
      ? DATA.tags.map((t) => `<label class="tag-check"><input type="checkbox" value="${esc(t.id)}" ${isChosen(t) ? 'checked' : ''}>${tagChip(t)}</label>`).join('')
      : '<p class="muted small">Ainda não existe nenhuma tag. Digite o nome na barra ao lado para criar a primeira.</p>';
  };
  const redraw = () => { drawChosen(); drawSuggest(); if (!allPop.hidden) drawAll(); };

  const addExisting = (id) => {
    const t = DATA.tags.find((x) => x.id === id);
    if (t && !isChosen(t)) chosen.push(t);
  };
  const createTag = (name) => {
    name = name.trim();
    const key = normalizeText(name);
    if (!name || chosen.some((t) => normalizeText(t.name) === key)) return;
    const existing = DATA.tags.find((t) => normalizeText(t.name) === key);
    chosen.push(existing || { name, color: TAG_COLORS[(DATA.tags.length + chosen.length) % TAG_COLORS.length] });
  };
  const pick = (btn) => {
    if (btn.dataset.tagCreate !== undefined) createTag(btn.dataset.tagCreate);
    else addExisting(btn.dataset.tagAdd);
    tagNew.value = '';
    hi = 0;
    redraw();
    tagNew.focus();
  };

  tagNew.addEventListener('input', () => { hi = 0; drawSuggest(); });
  tagNew.addEventListener('focus', drawSuggest);
  tagNew.addEventListener('keydown', (e) => {
    const opts = $$('.tag-opt:not(:disabled)', suggest);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const all = $$('.tag-opt', suggest);
      if (!all.length) return;
      hi = (hi + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length;
      drawSuggest();
    } else if (e.key === 'Enter') {
      e.preventDefault(); // Enter nunca envia o formulário daqui
      const cur = $('.tag-opt.is-hi:not(:disabled)', suggest) || opts[0];
      if (cur && !suggest.hidden) pick(cur);
    } else if (e.key === 'Escape' && !suggest.hidden) {
      e.stopPropagation();
      suggest.hidden = true;
    }
  });
  suggest.addEventListener('mousedown', (e) => e.preventDefault()); // não tira o foco da barra
  suggest.addEventListener('click', (e) => { const b = e.target.closest('.tag-opt'); if (b && !b.disabled) pick(b); });

  allBtn.addEventListener('click', () => {
    const open = allPop.hidden;
    allPop.hidden = !open;
    allBtn.setAttribute('aria-expanded', String(open));
    if (open) drawAll();
  });
  allPop.addEventListener('change', (e) => {
    const t = DATA.tags.find((x) => x.id === e.target.value);
    if (!t) return;
    if (e.target.checked) addExisting(t.id);
    else chosen.splice(chosen.findIndex((c) => c.id === t.id), 1);
    drawChosen();
  });
  $('#tag-chips').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-tag-remove]');
    if (!rm) return;
    chosen.splice(Number(rm.dataset.tagRemove), 1);
    redraw();
  });
  // clicar fora fecha as listas (o listener da gaveta é um só; aqui só troca a ação)
  tagOutside = (e) => {
    if (!e.target.closest('.tag-combo')) { suggest.hidden = true; allPop.hidden = true; allBtn.setAttribute('aria-expanded', 'false'); }
  };
  drawChosen();
}

// ---------------------------------------------------------------------
//  Meu perfil: trocar e-mail e senha
// ---------------------------------------------------------------------
let currentUser = null;

$('#open-profile').addEventListener('click', async () => {
  if (!(await leaveSettings())) return;
  currentId = 'perfil';
  sorting = false;
  history.replaceState(null, '', '#perfil');
  renderSection();
});

function renderProfile() {
  const email = currentUser?.email || '';
  $('#section-actions').innerHTML = `<button class="btn btn--ghost" type="button" id="profile-logout"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4"/></svg>Sair</button>`;
  $('#profile-logout').onclick = logout;
  content.innerHTML = `
    ${DEMO_MODE ? '<p class="banner banner--inline"><span class="banner__dot" aria-hidden="true"></span>Login de teste: e-mail e senha ficam só neste navegador. Com o Supabase conectado, viram o login de verdade.</p>' : ''}
    <div class="form form--groups">
      <form class="card-box" id="email-form" novalidate>
        <h3>E-mail de acesso</h3>
        <div class="form-grid">
          <label class="field"><span>E-mail atual</span><input class="input" type="email" value="${esc(email)}" disabled></label>
          <label class="field"><span>Novo e-mail${tip('Enviamos um link de confirmação para o novo e-mail. A troca só vale depois que você clicar nele.')}</span>
            <input class="input" type="email" name="email" autocomplete="email" required></label>
        </div>
        <div class="card-actions"><button class="btn btn--primary" type="submit">Trocar e-mail</button></div>
      </form>
      <form class="card-box" id="password-form" novalidate>
        <h3>Senha</h3>
        <div class="form-grid">
          <input type="email" name="username" value="${esc(email)}" autocomplete="username" hidden>
          <label class="field"><span>Senha atual</span><input class="input" type="password" name="current" autocomplete="current-password" required></label>
          <label class="field"><span>Nova senha${tip('Pelo menos 8 caracteres.')}</span><input class="input" type="password" name="password" autocomplete="new-password" minlength="8" required></label>
          <label class="field"><span>Repita a nova senha</span><input class="input" type="password" name="confirm" autocomplete="new-password" minlength="8" required></label>
        </div>
        <div class="card-actions"><button class="btn btn--primary" type="submit">Trocar senha</button></div>
      </form>
    </div>`;

  $('#email-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.checkValidity()) return form.reportValidity();
    const next = form.email.value.trim();
    if (next.toLowerCase() === email.toLowerCase()) return toast('Esse já é o seu e-mail.', 'error');
    if (DEMO_MODE) {
      demoAuth.save({ ...demoAuth.creds(), email: next });
      currentUser = { email: next };
      toast('E-mail trocado');
      return renderProfile();
    }
    const btn = $('button[type="submit"]', form);
    btn.disabled = true;
    const { error } = await sb.auth.updateUser({ email: next }, { emailRedirectTo: ADMIN_URL });
    btn.disabled = false;
    if (error) return toast(`Não foi possível trocar o e-mail: ${error.message}`, 'error');
    form.reset();
    toast(`Enviamos um link para ${next}. Clique nele para confirmar a troca.`);
  });

  $('#password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.checkValidity()) return form.reportValidity();
    if (form.password.value !== form.confirm.value) return toast('As duas senhas novas não são iguais.', 'error');
    if (DEMO_MODE) {
      const creds = demoAuth.creds();
      if (form.current.value !== creds.password) return toast('A senha atual está incorreta.', 'error');
      demoAuth.save({ ...creds, password: form.password.value });
      form.reset();
      return toast('Senha alterada');
    }
    const btn = $('button[type="submit"]', form);
    btn.disabled = true;
    // confere a senha atual antes de trocar (quem achar o painel aberto não troca sozinho)
    const check = await sb.auth.signInWithPassword({ email, password: form.current.value });
    if (check.error) { btn.disabled = false; return toast('A senha atual está incorreta.', 'error'); }
    const { error } = await sb.auth.updateUser({ password: form.password.value });
    btn.disabled = false;
    if (error) return toast(`Não foi possível trocar a senha: ${error.message}`, 'error');
    form.reset();
    toast('Senha alterada');
  });
}

// ---------------------------------------------------------------------
//  Autenticação e inicialização
// ---------------------------------------------------------------------
// Modo demonstração: login de teste (admin/demo-login.js). Os dados ficam só neste
// navegador; a sessão acaba ao fechar a aba.
const demoAuth = {
  creds() { try { return JSON.parse(localStorage.getItem('pf-demo-login')) || DEMO_LOGIN; } catch { return DEMO_LOGIN; } },
  save(c) { try { localStorage.setItem('pf-demo-login', JSON.stringify(c)); } catch { /* sem armazenamento: vale só agora */ } },
  get on() { try { return sessionStorage.getItem('pf-demo-on') === '1'; } catch { return false; } },
  set on(v) { try { if (v) sessionStorage.setItem('pf-demo-on', '1'); else sessionStorage.removeItem('pf-demo-on'); } catch { /* idem */ } },
};

async function logout() {
  if (!DEMO_MODE) return sb.auth.signOut();
  demoAuth.on = false;
  currentUser = null;
  authMode('login');
}

// Endereço do painel: para onde voltam os links de e-mail (senha nova, troca de e-mail)
const ADMIN_URL = `${location.origin}${location.pathname}`;
// Entrar / Esqueci a senha / Nova senha: o mesmo cartão, um formulário por vez
function authMode(mode) {
  // a gaveta, a confirmação e o seletor de cor ficam fora da tela do painel:
  // fecha tudo para nada ficar por cima do login
  if (!drawer.hidden) closeDrawer();
  if ($('#confirm').open) $('#confirm').close('cancel');
  closePicker();
  hideTip();
  show('login');
  startAuthSpace();
  $('#view-login .auth__card').classList.remove('is-leaving');
  ['login', 'forgot', 'recovery'].forEach((m) => { $(`#${m}-form`).hidden = m !== mode; });
  $$('#view-login .form-error, #view-login .form-ok').forEach((p) => { p.hidden = true; });
  $(`#${mode}-form input:not([hidden])`)?.focus();
}
// Fundo do login: o buraco negro do hero (carregado só quando o login aparece).
// Mouse mexe o disco; segurar o clique no fundo faz ele "puxar", soltar faz a onda.
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let authSpace = null;
function startAuthSpace() {
  // já existe (ex.: voltou depois de sair): remede o canvas, que ficou escondido
  if (authSpace?.setPointer) return dispatchEvent(new Event('resize'));
  if (authSpace) return;
  authSpace = import('../assets/blackhole.js')
    .then(({ createBlackHole }) => (authSpace = createBlackHole($('.auth__space'), { reduced: reducedMotion })))
    .catch(() => null);
}
const loginView = $('#view-login'), loginCard = $('#view-login .auth__card');
loginView.addEventListener('pointermove', (e) => {
  authSpace?.setPointer?.(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5);
  // brilho do vidro acompanha o mouse (como na barra flutuante do site)
  const r = loginCard.getBoundingClientRect();
  loginCard.style.setProperty('--gx', `${e.clientX - r.left}px`);
  loginCard.style.setProperty('--gy', `${e.clientY - r.top}px`);
});
let pulling = false;
loginView.addEventListener('pointerdown', (e) => { if (e.target.matches('.auth__space')) { pulling = true; authSpace?.capture?.(); } });
addEventListener('pointerup', () => { if (pulling) { pulling = false; authSpace?.release?.(); } });
// Entrou: o cartão é "engolido" pelo buraco antes do painel abrir
function swallowLogin() {
  authSpace?.capture?.();
  loginCard.classList.add('is-leaving');
  return new Promise((r) => setTimeout(r, reducedMotion ? 0 : 650));
}

const authError = (form, msg) => { const p = $('.form-error', form); p.textContent = msg; p.hidden = false; };
$('#view-login').addEventListener('click', (e) => {
  const b = e.target.closest('[data-auth]');
  if (!b) return;
  const email = $('#login-form').email.value;
  authMode(b.dataset.auth);
  if (b.dataset.auth === 'forgot' && email) $('#forgot-form').email.value = email;
});
function show(view) {
  ['login', 'notice', 'app'].forEach((v) => { $(`#view-${v}`).hidden = v !== view; });
}

async function startApp() {
  content.innerHTML = '<div class="spinner" role="status" aria-label="Carregando"></div>';
  show('app');
  try {
    DATA = await db.load();
    applyColors(DATA.settings);
    currentId = SECTIONS.some((s) => s.id === location.hash.slice(1)) ? location.hash.slice(1) : 'identidade';
    renderSection();
  } catch (err) {
    console.error(err);
    content.innerHTML = `<div class="empty-state"><h3>Não foi possível carregar os dados</h3><p>${esc(errorMessage(err))}</p><p>Confira se o arquivo <code>supabase/schema.sql</code> foi executado no seu projeto.</p></div>`;
  }
}

async function checkAccess(session) {
  currentUser = session?.user || null;
  if (!session) return authMode('login');
  const { data, error } = await sb.from('admins').select('user_id').eq('user_id', session.user.id).maybeSingle();
  if (error) {
    // falha de rede ou do banco: não é o mesmo que "não é administrador"
    $('#notice-body').innerHTML = `
      <p class="eyebrow">Sem conexão</p>
      <h1>Não foi possível conferir seu acesso</h1>
      <p class="muted">${esc(errorMessage(error).replace(/^Não foi possível salvar: /, ''))}</p>
      <button class="btn btn--primary" type="button" id="notice-retry">Tentar de novo</button>
      <button class="btn btn--ghost" type="button" id="notice-logout">Sair</button>`;
  } else if (!data) {
    $('#notice-body').innerHTML = `
      <p class="eyebrow">Acesso negado</p>
      <h1>Seu usuário ainda não é administrador</h1>
      <p class="muted">Logado como <strong>${esc(session.user.email)}</strong>. No SQL Editor do Supabase, rode:</p>
      <pre>insert into public.admins (user_id)\nvalues ('${esc(session.user.id)}');</pre>
      <button class="btn btn--primary" type="button" id="notice-retry">Já rodei, tentar de novo</button>
      <button class="btn btn--ghost" type="button" id="notice-logout">Sair</button>`;
  }
  if (error || !data) {
    $('#notice-retry').onclick = () => checkAccess(session);
    $('#notice-logout').onclick = () => sb.auth.signOut();
    return show('notice');
  }
  startApp();
}

$('#theme-toggle').addEventListener('click', toggleTheme);
$('#login-theme').addEventListener('click', toggleTheme);

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  $('.form-error', form).hidden = true;
  if (!form.checkValidity()) return form.reportValidity();
  if (DEMO_MODE) {
    const creds = demoAuth.creds();
    if (!creds) return authError(form, 'Modo demonstração sem login de teste: crie admin/demo-login.js ou configure o Supabase.');
    if (form.email.value.trim().toLowerCase() !== creds.email.toLowerCase() || form.password.value !== creds.password) return authError(form, 'E-mail ou senha incorretos.');
    demoAuth.on = true;
    currentUser = { email: creds.email };
    form.reset();
    await swallowLogin();
    authSpace?.release?.();
    return startApp();
  }
  const btn = $('button[type="submit"]', form);
  btn.disabled = true;
  btn.textContent = 'Entrando…';
  const { error } = await sb.auth.signInWithPassword({ email: form.email.value.trim(), password: form.password.value });
  btn.disabled = false;
  btn.textContent = 'Entrar';
  if (error) authError(form, /invalid/i.test(error.message) ? 'E-mail ou senha incorretos.' : `Não foi possível entrar: ${error.message}`);
});

$('#forgot-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  $('.form-error', form).hidden = true;
  if (!form.checkValidity()) return form.reportValidity();
  if (DEMO_MODE) return authError(form, 'No modo demonstração não há envio de e-mail. O login de teste fica em shared/config.js.');
  const btn = $('button[type="submit"]', form);
  btn.disabled = true;
  const { error } = await sb.auth.resetPasswordForEmail(form.email.value.trim(), { redirectTo: `${ADMIN_URL}?recuperar=1` });
  btn.disabled = false;
  if (error) return authError(form, `Não foi possível enviar: ${error.message}`);
  // mesma resposta exista ou não a conta (não revela quais e-mails estão cadastrados)
  const ok = $('.form-ok', form);
  ok.textContent = 'Se esse e-mail tiver acesso ao painel, o link chega em alguns minutos. Confira também o spam.';
  ok.hidden = false;
});

$('#recovery-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  $('.form-error', form).hidden = true;
  if (!form.checkValidity()) return form.reportValidity();
  if (form.password.value !== form.confirm.value) return authError(form, 'As duas senhas não são iguais.');
  const btn = $('button[type="submit"]', form);
  btn.disabled = true;
  const { data, error } = await sb.auth.updateUser({ password: form.password.value });
  btn.disabled = false;
  if (error) return authError(form, `Não foi possível salvar: ${error.message}`);
  history.replaceState(null, '', ADMIN_URL); // tira o "?recuperar=1" e os tokens do endereço
  toast('Senha nova salva');
  checkAccess({ user: data.user });
});

$('#logout').addEventListener('click', logout);

async function init() {
  if (DEMO_MODE) {
    $('#demo-banner').hidden = false;
    if (!demoAuth.on) return authMode('login');
    currentUser = { email: demoAuth.creds()?.email || "" };
    return startApp();
  }
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
  // veio pelo link "criar senha nova" do e-mail?
  const recovering = /type=recovery/.test(location.hash) || new URLSearchParams(location.search).has('recuperar');
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  let started = false;
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      // caiu a sessão (ou saiu em outra aba) com o painel aberto: avisa
      if (!$('#view-app').hidden) toast('Sua sessão terminou. Entre de novo para continuar.', 'error');
      started = false; currentUser = null;
      return authMode('login');
    }
    if (event === 'USER_UPDATED' && session) currentUser = session.user;
    if (event === 'PASSWORD_RECOVERY' || (recovering && session && !started)) {
      started = true;
      return authMode('recovery');
    }
    if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && !started) {
      started = Boolean(session);
      // Fora do callback: o SDK não permite chamadas ao banco dentro dele.
      setTimeout(() => checkAccess(session), 0);
    }
  });
}

init();
