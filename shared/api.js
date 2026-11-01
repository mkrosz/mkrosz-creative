// Camada de dados LEVE do site público: nada de SDK, só fetch.
// Uma única chamada à função SQL get_portfolio() traz tudo (settings, redes,
// tags, projetos com mídias/links e trajetória) em um JSON.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const CACHE_KEY = 'pf-data-v1';

export function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY));
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    /* modo privado / quota: segue sem cache */
  }
}

export async function fetchPortfolio() {
  if (!isConfigured) {
    const { DEMO } = await import('./demo-data.js');
    return DEMO;
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_portfolio`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!res.ok) throw new Error(`Supabase respondeu ${res.status}`);
  const data = normalize(await res.json());
  writeCache(data);
  return data;
}

// Deixa o formato igual ao dos dados de demonstração.
export function normalize(raw) {
  const tags = raw.tags || [];
  const tagMap = new Map(tags.map((t) => [t.id, t]));
  return {
    settings: raw.settings || {},
    socials: raw.socials || [],
    tags,
    education: raw.education || [],
    projects: (raw.projects || []).map((p) => ({
      ...p,
      tags: (p.tag_ids || []).map((id) => tagMap.get(id)).filter(Boolean),
      media: p.media || [],
      links: p.links || [],
    })),
  };
}

// --- Helpers compartilhados com o painel --------------------------------

export function mediaKind(item) {
  if (item.type === 'embed') return 'embed';
  if (toEmbedUrl(item.url)) return 'embed';
  if (item.type === 'video' || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(item.url)) return 'video';
  return 'image';
}

// Converte links do YouTube/Vimeo em URL de embed.
// id do vídeo num link do YouTube (watch, shorts, embed ou youtu.be)
export const youtubeId = (url = '') => url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/)?.[1];

// texto sem acento e minúsculo, para pesquisas
export const normalizeText = (v = '') => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function toEmbedUrl(url = '') {
  const yt = youtubeId(url);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt}?rel=0`;
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return null;
}

export function formatDate(value, opts = { month: 'long', year: 'numeric' }) {
  if (!value) return '';
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  const s = d.toLocaleDateString('pt-BR', opts);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Só aceita http(s), mailto e data:image — evita javascript: vindo do banco.
export function safeUrl(url = '') {
  const u = String(url || '').trim();
  return /^(https?:|mailto:|data:image\/|\.{0,2}\/)/i.test(u) ? u : '#';
}
