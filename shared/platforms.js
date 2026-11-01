import { BRAND_PATHS } from './brand-paths.js';

// Plataformas suportadas nos botões de projeto e nas redes sociais.
// color = cor da marca usada no botão do modal.
export const PLATFORMS = {
  behance:   { label: 'Behance',   color: '#1769ff' },
  linkedin:  { label: 'LinkedIn',  color: '#0a66c2' },
  instagram: { label: 'Instagram', color: '#e1306c' },
  dribbble:  { label: 'Dribbble',  color: '#ea4c89' },
  figma:     { label: 'Figma',     color: '#a259ff' },
  github:    { label: 'GitHub',    color: '#6e5494' },
  youtube:   { label: 'YouTube',   color: '#ff0000' },
  vimeo:     { label: 'Vimeo',     color: '#1ab7ea' },
  pinterest: { label: 'Pinterest', color: '#e60023' },
  tiktok:    { label: 'TikTok',    color: '#111111' },
  x:         { label: 'X',         color: '#111111' },
  whatsapp:  { label: 'WhatsApp',  color: '#25d366' },
  email:     { label: 'E-mail',    color: '#6e6e73' },
  website:   { label: 'Site',      color: 'var(--accent)' },
  other:     { label: 'Link',      color: 'var(--accent)' },
};

const STROKE_ICONS = {
  website: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  other: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
};

export const platform = (key) => PLATFORMS[key] || PLATFORMS.other;

export function platformIcon(key, size = 18) {
  if (BRAND_PATHS[key]) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${BRAND_PATHS[key]}"/></svg>`;
  }
  const body = STROKE_ICONS[key] || STROKE_ICONS.other;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

// Descobre a plataforma pela URL — usado no painel para pré-selecionar.
export function guessPlatform(url = '') {
  const u = url.toLowerCase();
  if (u.startsWith('mailto:')) return 'email';
  if (u.includes('twitter.com') || /\/\/(www\.)?x\.com/.test(u)) return 'x';
  if (u.includes('youtu.be')) return 'youtube';
  if (u.includes('wa.me')) return 'whatsapp';
  const hit = Object.keys(BRAND_PATHS).find((k) => k !== 'x' && u.includes(`${k}.`));
  return hit || 'website';
}
