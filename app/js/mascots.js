// Mascotes para o perfil: desenhos originais, simples, que ficam sobre um
// círculo na cor da pessoa. Todos usam o mesmo viewBox 0 0 64 64.

const svg = (body) => `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">${body}</svg>`;
const eyes = (y, x1, x2, r = 2.6) => `<circle cx="${x1}" cy="${y}" r="${r}" fill="#24170e"/><circle cx="${x2}" cy="${y}" r="${r}" fill="#24170e"/><circle cx="${x1 + 0.9}" cy="${y - 0.9}" r="0.8" fill="#fff"/><circle cx="${x2 + 0.9}" cy="${y - 0.9}" r="0.8" fill="#fff"/>`;

export const MASCOTS = {
  capivara: {
    name: 'Capivara',
    svg: svg(`
      <circle cx="20" cy="20" r="5" fill="#7a5233"/><circle cx="44" cy="20" r="5" fill="#7a5233"/>
      <rect x="13" y="18" width="38" height="36" rx="15" fill="#a0714a"/>
      <rect x="21" y="35" width="22" height="15" rx="7.5" fill="#7a5233"/>
      <circle cx="28" cy="40" r="1.4" fill="#24170e"/><circle cx="36" cy="40" r="1.4" fill="#24170e"/>
      <path d="M28 45.5q4 2.5 8 0" stroke="#24170e" stroke-width="1.4" fill="none" stroke-linecap="round"/>
      ${eyes(29, 24, 40)}
      <circle cx="32" cy="13" r="6" fill="#f28c28"/><path d="M32 7.5q3-3 6-1-2 3-6 1" fill="#3f9a4c"/>`),
  },
  tatu: {
    name: 'Tatu',
    svg: svg(`
      <path d="M18 22l-4-12 9 7z" fill="#b48a7a"/><path d="M46 22l4-12-9 7z" fill="#b48a7a"/>
      <ellipse cx="32" cy="36" rx="18" ry="17" fill="#c9a597"/>
      <path d="M15 31q17-14 34 0" fill="#8b6f66"/><path d="M14.5 31q17.5-9 35 0" stroke="#6f5650" stroke-width="1.5" fill="none"/>
      <path d="M17 25q15-9 30 0" stroke="#6f5650" stroke-width="1.5" fill="none"/>
      ${eyes(37, 25, 39)}
      <ellipse cx="32" cy="46" rx="6" ry="4.5" fill="#b48a7a"/><ellipse cx="32" cy="45" rx="2.2" ry="1.5" fill="#24170e"/>`),
  },
  gato: {
    name: 'Gato',
    svg: svg(`
      <path d="M14 30L16 10l12 10z" fill="#f0a24a"/><path d="M50 30L48 10 36 20z" fill="#f0a24a"/>
      <path d="M18 24l1-8 5 5z" fill="#f7c6c9"/><path d="M46 24l-1-8-5 5z" fill="#f7c6c9"/>
      <circle cx="32" cy="36" r="19" fill="#f0a24a"/>
      <path d="M26 18q6 4 12 0" stroke="#d7802a" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      ${eyes(34, 24, 40, 3)}
      <path d="M30 41h4l-2 2.4z" fill="#e2697a"/>
      <path d="M32 43.4q-2 3-5 2M32 43.4q2 3 5 2" stroke="#24170e" stroke-width="1.3" fill="none" stroke-linecap="round"/>
      <path d="M12 38l9 1M12 43l9-1M52 38l-9 1M52 43l-9-1" stroke="#24170e" stroke-width="1" stroke-linecap="round" opacity=".6"/>`),
  },
  coruja: {
    name: 'Coruja',
    svg: svg(`
      <path d="M16 18l4 8 6-4zM48 18l-4 8-6-4z" fill="#6e4a2e"/>
      <ellipse cx="32" cy="37" rx="18" ry="20" fill="#8a5f3c"/>
      <ellipse cx="32" cy="44" rx="11" ry="11" fill="#d9b88f"/>
      <circle cx="24" cy="31" r="7.5" fill="#fff"/><circle cx="40" cy="31" r="7.5" fill="#fff"/>
      ${eyes(31, 24, 40, 3.6)}
      <path d="M29 37h6l-3 5z" fill="#f2a33a"/>
      <path d="M26 47q2 2 4 0M34 47q2 2 4 0M30 51q2 2 4 0" stroke="#a4805a" stroke-width="1.2" fill="none"/>`),
  },
  tucano: {
    name: 'Tucano',
    svg: svg(`
      <circle cx="28" cy="34" r="18" fill="#1f2326"/>
      <ellipse cx="25" cy="42" rx="9" ry="8" fill="#fff4d6"/>
      <circle cx="29" cy="28" r="5.5" fill="#4fb3e8"/>
      <circle cx="29" cy="28" r="2.6" fill="#24170e"/><circle cx="30" cy="27" r=".8" fill="#fff"/>
      <path d="M33 30q20-6 25 6-10 3-25 2z" fill="#f59a23"/>
      <path d="M33 34q12 1 25 2-10 4-25 4z" fill="#e85c27"/>
      <circle cx="56" cy="36" r="2.2" fill="#24170e"/>`),
  },
  jabuti: {
    name: 'Jabuti',
    svg: svg(`
      <circle cx="32" cy="20" r="9" fill="#9cc56b"/>
      ${eyes(19, 28, 36, 2.2)}
      <path d="M29 23q3 2 6 0" stroke="#24170e" stroke-width="1.3" fill="none" stroke-linecap="round"/>
      <path d="M10 46q0-20 22-20t22 20z" fill="#5f8f3a"/>
      <path d="M20 46l5-12h14l5 12M25 34l7-6 7 6M32 28v18" stroke="#3f6a25" stroke-width="1.6" fill="none" stroke-linejoin="round"/>
      <rect x="8" y="45" width="48" height="5" rx="2.5" fill="#3f6a25"/>
      <ellipse cx="16" cy="52" rx="4" ry="3" fill="#9cc56b"/><ellipse cx="48" cy="52" rx="4" ry="3" fill="#9cc56b"/>`),
  },
  caramelo: {
    name: 'Caramelo',
    svg: svg(`
      <path d="M13 20q-3 18 6 22 3-14 2-20z" fill="#9a5a24"/><path d="M51 20q3 18-6 22-3-14-2-20z" fill="#9a5a24"/>
      <ellipse cx="32" cy="34" rx="16" ry="18" fill="#d68a3c"/>
      <ellipse cx="32" cy="43" rx="10" ry="8" fill="#f3d9b5"/>
      ${eyes(31, 25, 39, 2.8)}
      <ellipse cx="32" cy="39.5" rx="3.8" ry="2.8" fill="#24170e"/>
      <path d="M32 42.3v2.5M28.5 45q3.5 2.5 7 0" stroke="#24170e" stroke-width="1.3" fill="none" stroke-linecap="round"/>
      <path d="M30 46q2 6 4 0z" fill="#e2697a"/>`),
  },
  calango: {
    name: 'Calango',
    svg: svg(`
      <ellipse cx="32" cy="38" rx="21" ry="15" fill="#6dbb5a"/>
      <circle cx="21" cy="25" r="7.5" fill="#6dbb5a"/><circle cx="43" cy="25" r="7.5" fill="#6dbb5a"/>
      <circle cx="21" cy="24" r="4.6" fill="#fff"/><circle cx="43" cy="24" r="4.6" fill="#fff"/>
      ${eyes(24.5, 22, 42, 2.4)}
      <path d="M17 41q15 9 30 0" stroke="#24170e" stroke-width="1.6" fill="none" stroke-linecap="round"/>
      <circle cx="28" cy="34" r="1" fill="#2f6b26"/><circle cx="36" cy="34" r="1" fill="#2f6b26"/>
      <circle cx="16" cy="36" r="1.6" fill="#f2a33a"/><circle cx="48" cy="36" r="1.6" fill="#f2a33a"/>`),
  },
};

// Avatares ilustrados: imagens em app/avatars/<arquivo>.webp (256 px, ~6 KB).
// Para acrescentar um, basta pôr a imagem na pasta e uma linha aqui.
const ILLUSTRATED = [
  ['exploradora-espacial', 'Exploradora espacial'],
  ['capivara', 'Capivara'],
];
for (const [file, name] of ILLUSTRATED) {
  MASCOTS[`img-${file}`] = { name, group: 'Ilustrados', img: `avatars/${file}.webp` };
}
for (const m of Object.values(MASCOTS)) m.group ||= 'Desenhos';

/** Conteúdo do avatar (imagem ou desenho), sem o círculo. */
export const mascotArt = (m) => (m.img ? `<img src="${m.img}" alt="" loading="lazy" decoding="async">` : m.svg);

/** Opções do seletor: ilustrados primeiro, depois os desenhos. */
export const mascotOptions = () => Object.entries(MASCOTS)
  .sort(([, a], [, b]) => (a.group === b.group ? 0 : a.group === 'Ilustrados' ? -1 : 1))
  .map(([value, m]) => ({ value, label: m.name, group: m.group, html: mascotArt(m) }));

/** Avatar da pessoa: mascote (ou a inicial) num círculo da cor dela. */
export function avatar(person, size = 28) {
  if (!person) return `<span class="avatar joint" style="--s:${size}px" title="Casal"></span>`;
  const mascot = MASCOTS[person.mascot];
  const inner = mascot ? mascotArt(mascot) : `<b>${(person.nickname || person.name || '?').trim().charAt(0).toUpperCase()}</b>`;
  return `<span class="avatar${mascot?.img ? ' photo' : ''}" style="--c:${person.color || '#888'};--s:${size}px" title="${(person.nickname || person.name || '').replace(/"/g, '&quot;')}">${inner}</span>`;
}

/** Como chamar a pessoa nas telas: apelido, se tiver. */
export const displayName = (person) => (person ? person.nickname || person.name : 'Casal');
