// Funções pequenas e puras usadas em todo o app: datas, dinheiro, ids e escape.
// Datas são sempre strings locais 'AAAA-MM-DD' e meses 'AAAA-MM' — nunca UTC.

const pad = (n) => String(n).padStart(2, '0');

export function today(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const ymOf = (date) => date.slice(0, 7);
export const dayOf = (date) => Number(date.slice(8, 10));

export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/** Quantos meses de `a` até `b` (b - a). */
export function monthDiff(a, b) {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

export function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** Data dentro do mês, ajustando dia 31 para o último dia de meses curtos. */
export function dateIn(ym, day) {
  const d = Math.min(Math.max(1, Number(day) || 1), daysInMonth(ym));
  return `${ym}-${pad(d)}`;
}

/** Dias de `a` até `b` (b - a). */
export function diffDays(a, b) {
  const toUtc = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86400000);
}

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const sum = (list, fn = (x) => x) => round2(list.reduce((s, x) => s + (fn(x) || 0), 0));

// crypto.randomUUID não existe em http fora do localhost (celular na rede de casa).
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const byId = (list) => new Map(list.map((x) => [x.id, x]));

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = (n) => BRL.format(round2(n || 0));

/** Separa "R$ 5.304,28" em parte inteira e centavos para destacar o número. */
export function moneyParts(n) {
  const text = money(Math.abs(n || 0)).replace(/^R\$\s?/, '');
  const [whole, cents] = text.split(',');
  return { sign: n < 0 ? '−' : '', whole, cents };
}

/** Aceita "1.234,56", "1234.56", "12,5" e "R$ 10". Devolve NaN se não for número. */
export function parseMoney(text) {
  let s = String(text ?? '').replace(/[^\d,.-]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  return round2(Number(s));
}

export const percent = (n) => `${Math.round((n || 0) * 100)}%`;

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export function fmtMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} de ${y}`;
}
export function fmtMonthShort(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS_SHORT[m - 1]}/${String(y).slice(2)}`;
}
export function fmtDay(date) {
  const [, m, d] = date.split('-').map(Number);
  return `${pad(d)} ${MONTHS_SHORT[m - 1]}`;
}
export function fmtDate(date) {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}
export function fmtWeekday(date) {
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
}

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
