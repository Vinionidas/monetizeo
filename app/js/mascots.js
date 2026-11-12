// Avatares do perfil: ilustrações em app/avatars/<arquivo>.webp (256 px, ~6 KB),
// organizadas em abas. Para acrescentar um, ponha a imagem na pasta e uma linha aqui.

export const AVATAR_GROUPS = ['Pessoas', 'Animais', 'Fantasia'];

const LIST = [
  ['exploradora-espacial', 'Exploradora espacial', 'Pessoas'],
  ['chef', 'Chef', 'Pessoas'],
  ['pessoa-minimalista', 'Minimalista', 'Pessoas'],
  ['pessoa-minimalista-feminina', 'Minimalista', 'Pessoas'],
  ['capivara', 'Capivara', 'Animais'],
  ['arara-azul', 'Arara-azul', 'Animais'],
  ['gato-laranja', 'Gato laranja', 'Animais'],
  ['gato-preto', 'Gato preto', 'Animais'],
  ['fenix', 'Fênix', 'Fantasia'],
  ['gato-astronauta', 'Gato astronauta', 'Fantasia'],
];

export const MASCOTS = Object.fromEntries(LIST.map(([file, name, group]) => [`img-${file}`, { name, group, img: `avatars/${file}.webp` }]));

// Desenhos da 0.15 que saíram: quem tinha um deles passa para o ilustrado parecido (ou para a inicial).
const RETIRED = { capivara: 'img-capivara', gato: 'img-gato-laranja' };

/** Valor salvo no perfil, já convertido se era um desenho antigo. */
export const mascotOf = (person) => (MASCOTS[person?.mascot] ? person.mascot : RETIRED[person?.mascot] || '');

export const mascotArt = (m) => `<img src="${m.img}" alt="" loading="lazy" decoding="async">`;

/** Opções do seletor, na ordem das abas. */
export const mascotOptions = () => AVATAR_GROUPS.flatMap((group) => Object.entries(MASCOTS)
  .filter(([, m]) => m.group === group)
  .map(([value, m]) => ({ value, label: m.name, group, html: mascotArt(m) })));

/** Avatar da pessoa: ilustração (ou a inicial) num círculo com a cor dela. */
export function avatar(person, size = 28) {
  if (!person) return `<span class="avatar joint" style="--s:${size}px" title="Casal"></span>`;
  const mascot = MASCOTS[mascotOf(person)];
  const title = (person.nickname || person.name || '').replace(/"/g, '&quot;');
  if (mascot) return `<span class="avatar photo" style="--c:${person.color || '#888'};--s:${size}px" title="${title}">${mascotArt(mascot)}</span>`;
  return `<span class="avatar" style="--c:${person.color || '#888'};--s:${size}px" title="${title}"><b>${(person.nickname || person.name || '?').trim().charAt(0).toUpperCase()}</b></span>`;
}

/** Como chamar a pessoa nas telas: apelido, se tiver. */
export const displayName = (person) => (person ? person.nickname || person.name : 'Casal');
