// Comparações bobas para a sobra por dia. Preços aproximados de mercado, só
// para dar escala ("dá pra comprar 3 kg de batata"), sem pretensão de precisão.
// Função pura: o sorteio vem de `seed` (o dia), então a frase muda uma vez por
// dia e o botão "outra" só avança o seed.

const n = (q, one, many) => `${q.toLocaleString('pt-BR')} ${q === 1 ? one : many}`;

/** [preço, singular, plural, piada]. A piada recebe a quantidade. */
export const FUN_ITEMS = [
  [0.25, 'bala Juquinha', 'balas Juquinha', () => 'Dente agradece? Não. Mas a alma sim.'],
  [0.5, 'pirulito', 'pirulitos', () => 'Doce como a vida de quem não tem boleto.'],
  [0.5, 'chiclete', 'chicletes', (q) => (q > 10 ? 'Dá pra fazer uma bola do tamanho da Yamaha.' : 'Mastigue devagar, é investimento.')],
  [0.5, 'banana', 'bananas', (q) => (q >= 12 ? 'Isso é uma penca. Você é oficialmente um macaco próspero.' : 'Potássio é riqueza também.')],
  [0.7, 'paçoca', 'paçocas', () => 'Se esfarelar, ainda conta.'],
  [0.8, 'pão francês', 'pães franceses', (q) => (q >= 10 ? 'A padaria vai te chamar pelo nome.' : 'Quentinho, de preferência às 6 da manhã.')],
  [0.9, 'ovo', 'ovos', (q) => (q >= 12 ? 'Uma dúzia por dia. Academia em casa, sem pagar academia.' : 'Fritinho, com gema mole.')],
  [1, 'caixa de fósforo', 'caixas de fósforo', () => 'Pra acender o fogão e a esperança.'],
  [1, 'dindin', 'dindins', () => 'Geladinho de saquinho: tecnologia nordestina de ponta.'],
  [1, 'bala de goma', 'balas de goma', () => 'Mole por fora, mole por dentro. Igual a gente na segunda.'],
  [1.5, 'figurinha', 'figurinhas', (q) => (q > 1 ? 'Uma vai sair repetida. Sempre sai.' : 'Torcendo pra não ser repetida.')],
  [2, 'bombom', 'bombons', () => 'Escondido, pra não ter que dividir.'],
  [2, 'pão de queijo', 'pães de queijo', () => 'Mineiro ficaria orgulhoso.'],
  [2.5, 'caldo de cana pequeno', 'caldos de cana pequenos', () => 'Pastel vendido separadamente.'],
  [2, 'rolo de papel higiênico', 'rolos de papel higiênico', () => 'Luxo é ter estoque.'],
  [3, 'pacote de flocão', 'pacotes de flocão', () => 'Cuscuz todo dia: patrimônio cultural nordestino garantido.'],
  [4, 'cafezinho', 'cafezinhos', (q) => (q >= 3 ? 'Sono? Não conheço.' : 'Expresso, igual o salário indo embora.')],
  [4, 'picolé de fruta', 'picolés de fruta', () => 'Calor de Imperatriz não perdoa, você também não.'],
  [4.25, 'passagem de ônibus', 'passagens de ônibus', () => 'Dá pra passear e voltar. Ou só ir, se for corajoso.'],
  [5, 'Guaraná Jesus lata', 'latas de Guaraná Jesus', () => 'Rosa, doce e maranhense. Como deve ser.'],
  [6, 'kg de batata', 'kg de batata', () => 'Frita, cozida ou purê: a escolha é sua.'],
  [6, 'coxinha', 'coxinhas', (q) => (q >= 3 ? 'Almoço, lanche e janta resolvidos com respeito.' : 'Com catupiry? Aí já é ambição.')],
  [6, 'espetinho', 'espetinhos', () => 'Com farofa e vinagrete, senão não vale.'],
  [6.3, 'litro de gasolina', 'litros de gasolina', (q) => `Uns ${Math.round(q * 40)} km de moto. Vruum.`],
  [7, 'tapioca', 'tapiocas', () => 'De queijo coalho, por favor.'],
  [3.5, 'cuscuz de rua', 'cuscuz de rua', () => 'Com ovo e calabresa, café da manhã de campeão.'],
  [10, 'quilo de manga na feira', 'quilos de manga', () => 'Época de manga é época de fartura.'],
  [18, 'x-tudo', 'x-tudos', () => 'Tudo mesmo. Até o que você não pediu.'],
  [8, 'pastel de feira', 'pastéis de feira', () => 'Com caldo de cana, pra ficar completo.'],
  [12, 'kg de frango', 'kg de frango', () => 'Proteína nível marombeiro.'],
  [15, 'açaí de 300 ml', 'açaís de 300 ml', () => 'Com granola e leite em pó. Sem moderação.'],
  [25, 'pizza pequena', 'pizzas pequenas', () => 'Sexta-feira mora em você agora.'],
  [70, 'kg de picanha', 'kg de picanha', () => 'Churrasco numa terça-feira, porque pode.'],
  [0.1, 'grampo de cabelo', 'grampos de cabelo', () => 'Some um por dia mesmo, então tá na conta.'],
  [0.3, 'prego', 'pregos', (q) => (q >= 10 ? 'Dá pra pendurar todos os quadros que vocês nunca penduraram.' : 'Pendura aquele quadro, vai.')],
  [0.6, 'bala de café', 'balas de café', () => 'Cafeína em formato portátil.'],
  [1.2, 'pacote de miojo (meio)', 'pacotes de miojo (meio)', () => 'Tempero inteiro, claro. Ninguém é de ferro.'],
  [1.5, 'limão', 'limões', (q) => (q >= 6 ? 'Quando a vida der limões, faça uma caipirinha.' : 'Suco, tempero ou chá pra gripe.')],
  [2.5, 'pacote de miojo', 'pacotes de miojo', () => 'Três minutos de felicidade, comprovado pela ciência.'],
  [3, 'bolo de pote (fatia)', 'fatias de bolo de pote', () => 'Doce com colher: o auge da civilização.'],
  [4.5, 'pacote de bolacha recheada', 'pacotes de bolacha recheada', () => 'Abre e come o recheio primeiro, sem julgamento.'],
  [5, 'dúzia de laranja', 'dúzias de laranja', () => 'Vitamina C pra espantar até boleto.'],
  [5.5, 'cuscuz completo no ponto', 'cuscuz completos', () => 'Com carne de sol, porque a gente merece.'],
  [6.5, 'sacolé de açaí', 'sacolés de açaí', () => 'Açaí de pobre é açaí também.'],
  [7.5, 'litro de leite', 'litros de leite', () => 'Pro café com leite e pro cuscuz molhado.'],
  [9, 'pacote de café de 250 g', 'pacotes de café de 250 g', () => 'Combustível oficial de segunda a sexta.'],
  [11, 'sorvete de massa (pote pequeno)', 'potes de sorvete de massa', () => 'Assistindo série, debaixo do ventilador.'],
  [13, 'baião de dois (marmita)', 'marmitas de baião de dois', () => 'Arroz, feijão e felicidade no mesmo pote.'],
  [20, 'rodízio de pastel (meio)', 'rodízios de pastel (meio)', () => 'Sai rolando, mas sai feliz.'],
  [35, 'pizza grande', 'pizzas grandes', () => 'Metade calabresa, metade frango com catupiry. Clássico.'],
  [50, 'tanque cheio da Yamaha', 'tanques cheios da Yamaha', () => 'Estrada liberada. Vruum ao quadrado.'],
];

const TEMPLATES = [
  (what) => `Dá pra comprar ${what} por dia.`,
  (what) => `Boa! Sobrou grana pra ${what} por dia.`,
  (what) => `Orçamento oficial do dia: ${what}.`,
  (what) => `Hoje você é rico em ${what}.`,
  (what) => `Ostentação diária liberada: ${what}.`,
  (what) => `Sua sobra diária, convertida: ${what}.`,
  (what) => `Patrocinador oficial do seu dia: ${what}.`,
  (what) => `Relatório financeiro: ${what} por dia, e olhe lá.`,
  (what) => `O economista dentro de você recomenda ${what} por dia.`,
  (what) => `Se fosse moeda, você teria ${what} por dia.`,
];

const NEGATIVE = [
  'Sobra negativa: hoje o cardápio é vento com farofa de esperança.',
  'O mês tá mais apertado que calça de 2009. Bora rever umas contas?',
  'Modo sobrevivência ativado: água da torneira é gourmet.',
  'O saldo foi passear e esqueceu de voltar. Hora de cortar alguma coisa.',
  'Se dinheiro fosse bateria, o celular já tinha desligado.',
  'O boleto venceu a batalha, mas a guerra ainda não acabou.',
  'Hoje o lanche é o cheiro da padaria quando passar na frente.',
  'Conta no vermelho: até o Guaraná Jesus ficou mais rosa de vergonha.',
  'Hora de vender a ideia de um churrasco onde cada um leva o seu.',
]; 

const TINY = [
  'Dá pra comprar uma bala e olhar pra ela com carinho.',
  'Isso compra um pensamento positivo. Usado.',
  'Rico em experiências, pobre em centavos.',
  'Dá pra comprar um grampo de cabelo e torcer pra não perder.',
]; 

/**
 * Frase do dia. `perDay` pode ser null (sobra zerada ou negativa).
 * Devolve só o texto; a tela escolhe onde mostrar.
 */
export function funLine(perDay, seed = 0) {
  const pick = (list) => list[((seed % list.length) + list.length) % list.length];
  if (perDay === null || !(perDay > 0)) return pick(NEGATIVE);
  if (perDay < 0.25) return pick(TINY);
  // Só itens que dão de 1 a 40 unidades: "0,3 pizza" e "900 balas" perdem a graça.
  const fits = FUN_ITEMS.filter(([price]) => perDay / price >= 1 && perDay / price <= 40);
  const options = fits.length ? fits : [FUN_ITEMS.reduce((a, b) => (perDay / b[0] >= 1 ? b : a))];
  const [price, one, many, joke] = pick(options);
  const q = Math.floor(perDay / price);
  // O começo da frase varia num ritmo diferente do item, pra não repetir o par.
  const opening = TEMPLATES[Math.floor(Math.abs(seed) / options.length) % TEMPLATES.length];
  return `${opening(n(q, one, many))} ${joke(q)}`;
}

/** Número do dia (muda à meia-noite), base do sorteio. */
export const daySeed = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
};
