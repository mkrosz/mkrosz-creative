// =====================================================================
//  Habilidades do "Sobre mim" em cards com ícone.
//  O ícone é escolhido pelo nome digitado no painel: ferramentas conhecidas
//  usam o logo e a cor da marca; conceitos usam ícones de traço; o resto
//  recebe as iniciais. Carregado só quando o site renderiza o "Sobre".
// =====================================================================
import { TOOL_PATHS } from '../shared/tool-paths.js';
import { BRAND_PATHS } from '../shared/brand-paths.js';
import { escapeHtml as esc, normalizeText } from '../shared/api.js';

// [regex do nome, path do logo, cor da marca]
const TOOLS = [
  [/figma/, BRAND_PATHS.figma, '#F24E1E'],
  [/photoshop|^ps$/, TOOL_PATHS.adobephotoshop, '#31A8FF'],
  [/illustrator|^ai$/, TOOL_PATHS.adobeillustrator, '#FF9A00'],
  [/after ?effects|^ae$/, TOOL_PATHS.adobeaftereffects, '#9999FF'],
  [/(adobe )?xd$/, TOOL_PATHS.adobexd, '#FF61F6'],
  [/indesign/, TOOL_PATHS.adobeindesign, '#FF3366'],
  [/premiere/, TOOL_PATHS.adobepremierepro, '#9999FF'],
  [/lightroom/, TOOL_PATHS.adobelightroom, '#31A8FF'],
  [/blender/, TOOL_PATHS.blender, '#F5792A'],
  [/canva/, TOOL_PATHS.canva, '#00C4CC'],
  [/sketch/, TOOL_PATHS.sketch, '#F7B500'],
  [/framer/, TOOL_PATHS.framer, '#0099FF'],
  [/notion/, TOOL_PATHS.notion, 'var(--fg)'],
  [/miro/, TOOL_PATHS.miro, '#FFD02F'],
  [/webflow/, TOOL_PATHS.webflow, '#4353FF'],
  [/affinity/, TOOL_PATHS.affinitydesigner, '#1B72BE'],
  [/cinema ?4d|c4d/, TOOL_PATHS.cinema4d, '#5B8CFF'],
];

// Conceitos: ícones de traço (stroke)
const CONCEPTS = [
  [/ux|pesquisa|research|usabilidade/, '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8"/><circle cx="10.5" cy="9" r="2"/><path d="M7 14c.8-1.5 2-2.2 3.5-2.2S13.2 12.5 14 14"/>'],
  [/design system|componente|component/, '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="3.75"/><path d="m6.75 13.5 3.75 3.75-3.75 3.75L3 17.25z"/>'],
  [/\bui\b|interface/, '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M8 9v11"/><circle cx="6" cy="6.5" r=".5"/>'],
  [/brand|marca|identidade/, '<path d="M12 3 4 7.5v9L12 21l8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>'],
  [/motion|anima/, '<circle cx="14" cy="12" r="6"/><path d="m12.5 9.5 4 2.5-4 2.5z"/><path d="M2 9h4M3 12h3M2 15h4"/>'],
  [/tipograf|typograph|fonte/, '<path d="M4 20 9.5 5h1L16 20M6 15h8"/><path d="M17 12.5c.6-.9 1.4-1.3 2.4-1.3 1.6 0 2.6 1 2.6 2.6V20M22 16.5c-3.5 0-5 .7-5 2.1 0 .9.7 1.6 1.9 1.6 1.6 0 3.1-1.2 3.1-3"/>'],
  [/ilustra|illustration|desenho|drawing/, '<path d="m12 19 7-7 3 3-7 7z"/><path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18z"/><path d="m2 2 7.6 7.6"/><circle cx="11" cy="11" r="2"/>'],
  [/protot/, '<path d="M4 4l7.07 17 2.51-7.39L21 11.07z"/>'],
  [/web|site|front/, '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'],
  [/mobile|app/, '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18h2"/>'],
  [/foto|photo/, '<path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="4"/>'],
  [/3d|modelagem/, '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="m3 7 9 5 9-5M12 12v10"/>'],
  [/v[ií]deo|edi[cç][aã]o/, '<rect x="2" y="5" width="15" height="14" rx="2"/><path d="m17 10 5-3v10l-5-3z"/>'],
];

const norm = (v) => normalizeText(v).trim();

function iconFor(name) {
  const n = norm(name);
  const tool = TOOLS.find(([re]) => re.test(n));
  if (tool) return { svg: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${tool[1]}"/></svg>`, color: tool[2] };
  const concept = CONCEPTS.find(([re]) => re.test(n));
  if (concept) return { svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${concept[1]}</svg>`, color: 'var(--accent-2)' };
  // Sem ícone conhecido: iniciais
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return { svg: `<span class="skill__mono" aria-hidden="true">${esc(initials)}</span>`, color: 'var(--accent)' };
}

export function renderSkills(el, skills = []) {
  el.innerHTML = skills
    .map((name, i) => {
      const { svg, color } = iconFor(name);
      return `<li class="skill" style="--i:${i};--brand:${color}"><span class="skill__icon">${svg}</span><span class="skill__name">${esc(name)}</span></li>`;
    })
    .join('');
}
