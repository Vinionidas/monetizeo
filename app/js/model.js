// Regras financeiras do Monetizeo. Tudo aqui é função pura sobre o estado:
// nada toca em DOM, rede ou relógio (a data de hoje sempre entra por parâmetro).
//
// Princípio central: NÃO existem contadores guardados. Parcela paga, saldo de
// dívida, valor guardado em meta e saldo de conta são sempre calculados a
// partir dos lançamentos. Apagar ou corrigir um lançamento conserta todo o resto.

import { addMonths, byId, dateIn, dayOf, daysInMonth, monthDiff, round2, sum, ymOf } from './util.js';

export const SCHEMA = 1;

export const ACCOUNT_TYPES = {
  bank: 'Conta bancária',
  cash: 'Dinheiro',
  benefit: 'Vale-alimentação / benefício',
  card: 'Cartão de crédito',
  credit: 'Crediário / financiamento',
};

export const GROUPS = { need: 'Necessidade', want: 'Desejo', invest: 'Reserva' };

export function emptyState() {
  return {
    schema: SCHEMA,
    people: [],
    accounts: [],
    categories: [],
    entries: [],
    recurring: [],
    installments: [],
    goals: [],
    debts: [],
    invoicePayments: [],
    settlements: [],
    ofxPending: [],
    ofxIgnored: [],
    split: { mode: 'equal', shares: {} },
  };
}

/** Garante que um estado carregado (backup antigo, edição manual) tem todos os campos. */
export function normalize(state) {
  const base = emptyState();
  const out = { ...base, ...state, schema: SCHEMA };
  for (const key of Object.keys(base)) {
    if (Array.isArray(base[key]) && !Array.isArray(out[key])) out[key] = [];
  }
  out.split = { ...base.split, ...(state.split || {}) };
  return out;
}

/**
 * Empréstimo a alguém e a devolução dele são dinheiro que sai e volta: mexem no
 * saldo da conta, mas não são gasto nem renda, então ficam fora das somas do mês.
 */
// `transfer: true` marca dinheiro que só passou pela conta (empréstimo recebido ou devolvido, acerto entre o casal).
export const isTransfer = (entry) => !!entry.loan || entry.transfer === true || entry.source?.kind === 'loan';

// Contas com saldo próprio: banco, dinheiro e benefício (VA/VR), que recebe recarga e paga compras.
export const isMoneyAccount = (account) => !!account && (account.type === 'bank' || account.type === 'cash' || account.type === 'benefit');
export const isCard = (account) => !!account && account.type === 'card';

/**
 * Crédito no cartão (estorno) e devolução de um gasto (`refund`, ex.: troco de
 * uma feira que voltou por Pix) não são renda: abatem o gasto da categoria.
 * Estas funções são a única forma de somar valores do mês.
 */
export const isRefund = (item) => item.type === 'income' && (!!item.cardCredit || item.refund === true);
export const expenseValue = (item) => (item.transfer ? 0 : item.type === 'expense' ? item.amount : isRefund(item) ? -item.amount : 0);
export const incomeValue = (item) => (item.transfer || isRefund(item) || item.type !== 'income' ? 0 : item.amount);

// ---------------------------------------------------------------- cartões

/** Mês da fatura (mês do vencimento) em que uma compra feita em `date` cai. */
export function invoiceMonthFor(card, date) {
  const closing = Number(card.closingDay) || 0;
  const due = Number(card.dueDay) || 0;
  if (!closing || !due) return ymOf(date);
  const afterClosing = dayOf(date) > closing ? 1 : 0;
  const dueNextMonth = due > closing ? 0 : 1;
  return addMonths(ymOf(date), afterClosing + dueNextMonth);
}

export function invoicePayment(state, cardId, ym) {
  return state.invoicePayments.find((p) => p.cardId === cardId && p.month === ym) || null;
}

// ------------------------------------------------------------ recorrentes

/** Configuração de um recorrente valendo no mês: aplica as alterações "a partir de". */
export function recurringConfig(recurring, ym) {
  const changes = (recurring.changes || [])
    .filter((c) => c.from <= ym)
    .sort((a, b) => a.from.localeCompare(b.from));
  const { changes: _ignored, ...base } = recurring;
  return changes.reduce((cfg, { from: _from, ...change }) => ({ ...cfg, ...change }), base);
}

export function recurringActiveIn(recurring, ym) {
  if (!recurring.active) return false;
  if (recurring.start && ym < recurring.start) return false;
  if (recurring.end && ym > recurring.end) return false;
  return !(recurring.skips || []).includes(ym);
}

// ----------------------------------------------------------- parcelamentos

export const installmentMonth = (inst, index) => addMonths(ymOf(inst.first), index);

/** Índices das parcelas que têm lançamento real (pago ou não). */
function installmentEntries(state, instId) {
  const map = new Map();
  for (const e of state.entries) {
    if (e.source?.kind === 'installment' && e.source.id === instId) map.set(e.source.index, e);
  }
  return map;
}

export function installmentStatus(state, inst) {
  const linked = installmentEntries(state, inst.id);
  const before = Math.min(inst.paidBefore || 0, inst.count);
  const rows = [];
  let paidCount = 0;
  let paidTotal = 0;
  for (let index = 0; index < inst.count; index++) {
    const entry = linked.get(index) || null;
    const paid = index < before || !!entry?.paid;
    if (paid) {
      paidCount++;
      paidTotal += entry ? entry.amount : inst.amount;
    }
    rows.push({ index, month: installmentMonth(inst, index), entry, paid, historical: index < before && !entry });
  }
  const next = rows.find((r) => !r.paid) || null;
  return {
    rows,
    paidCount,
    paidTotal: round2(paidTotal),
    remaining: inst.count - paidCount,
    remainingAmount: round2((inst.count - paidCount) * inst.amount),
    next,
  };
}

// ------------------------------------------------------------ itens do mês

/** Mês de competência de um lançamento (o mês em que ele "conta"). */
export function effectiveMonth(state, entry, lookups = buildLookups(state)) {
  const src = entry.source;
  if (src?.kind === 'installment') {
    const inst = lookups.installments.get(src.id);
    if (inst) return installmentMonth(inst, src.index);
  }
  // No cartão vale a fatura em que a cobrança cai, inclusive para assinatura.
  const account = lookups.accounts.get(entry.accountId);
  if (isCard(account)) return invoiceMonthFor(account, entry.date);
  if (src?.kind === 'recurring' && src.period) return src.period;
  return ymOf(entry.date);
}

function buildLookups(state) {
  return { accounts: byId(state.accounts), installments: byId(state.installments) };
}

/**
 * Tudo o que entra e sai em um mês: lançamentos reais + projeções de
 * recorrentes e parcelas que ainda não viraram lançamento.
 *
 * Cada item tem: key, kind ('entry' | 'recurring' | 'installment'), projected,
 * date, description, amount, type, categoryId, accountId, personId, scope,
 * paid, onCard, variable.
 */
export function monthItems(state, ym) {
  const lookups = buildLookups(state);
  const linked = new Set();
  const items = [];

  const withCard = (item) => {
    const account = lookups.accounts.get(item.accountId);
    if (isCard(account)) {
      item.onCard = true;
      item.cardCredit = item.type === 'income';
      item.paid = !!invoicePayment(state, account.id, ym);
    } else {
      item.onCard = false;
      item.cardCredit = false;
    }
    return item;
  };

  for (const e of state.entries) {
    if (e.source?.kind === 'recurring') linked.add(`r:${e.source.id}:${e.source.period}`);
    if (e.source?.kind === 'installment') linked.add(`i:${e.source.id}:${e.source.index}`);
    if (effectiveMonth(state, e, lookups) === ym) {
      items.push(withCard({ ...e, key: `e:${e.id}`, kind: 'entry', projected: false, paid: !!e.paid, transfer: isTransfer(e) }));
    }
  }

  for (const r of state.recurring) {
    // `period` é o mês da cobrança. No cartão, a cobrança de um mês pode cair na
    // fatura do mês seguinte (ou do outro), então procuramos quais caem nesta.
    const periods = [];
    for (const back of [0, 1, 2]) {
      const period = addMonths(ym, -back);
      const cfg = recurringConfig(r, period);
      const card = lookups.accounts.get(cfg.accountId);
      const month = isCard(card) && cfg.type === 'expense' ? invoiceMonthFor(card, dateIn(period, cfg.day)) : period;
      if (month === ym) periods.push(period);
    }
    for (const period of periods) {
      if (!recurringActiveIn(r, period) || linked.has(`r:${r.id}:${period}`)) continue;
      const cfg = recurringConfig(r, period);
      items.push(withCard({
        key: `r:${r.id}:${period}`, kind: 'recurring', projected: true, refId: r.id, period,
        date: dateIn(period, cfg.day), description: cfg.description, amount: cfg.amount || 0,
        type: cfg.type, categoryId: cfg.categoryId, accountId: cfg.accountId,
        personId: cfg.personId ?? null, scope: cfg.scope || 'personal',
        paid: false, variable: !(cfg.amount > 0),
      }));
    }
  }

  for (const inst of state.installments) {
    const index = monthDiff(ymOf(inst.first), ym);
    if (index < (inst.paidBefore || 0) || index >= inst.count || linked.has(`i:${inst.id}:${index}`)) continue;
    items.push(withCard({
      key: `i:${inst.id}:${index}`, kind: 'installment', projected: true, refId: inst.id, index,
      date: dateIn(ym, dayOf(inst.first)), description: `${inst.description} (${index + 1}/${inst.count})`,
      amount: inst.amount, type: 'expense', categoryId: inst.categoryId, accountId: inst.accountId,
      personId: inst.personId ?? null, scope: inst.scope || 'personal', paid: false, variable: false,
    }));
  }

  return items.sort((a, b) => a.date.localeCompare(b.date) || a.description.localeCompare(b.description));
}

export function isOverdue(item, todayDate) {
  return !item.paid && !item.onCard && item.type === 'expense' && item.date < todayDate;
}

export function summarize(all) {
  const income = round2(sum(all, incomeValue));
  const expense = round2(sum(all, expenseValue));
  const paid = round2(sum(all.filter((i) => i.paid), expenseValue));
  return { income, expense, paid, pending: round2(expense - paid), balance: round2(income - expense) };
}

export function expensesByCategory(state, items) {
  const totals = new Map();
  for (const item of items) {
    const value = expenseValue(item);
    if (!value) continue;
    totals.set(item.categoryId, round2((totals.get(item.categoryId) || 0) + value));
  }
  const categories = byId(state.categories);
  return [...totals.entries()]
    .filter(([, total]) => total > 0)
    .map(([id, total]) => ({ category: categories.get(id) || { id, name: 'Sem categoria', budget: 0 }, total }))
    .sort((a, b) => b.total - a.total);
}

// ------------------------------------------------------- divisão da casa

/** Fração de cada pessoa nas contas da casa, no mês. Soma sempre 1. */
export function splitShares(state, items) {
  const people = state.people;
  if (!people.length) return {};
  const equal = Object.fromEntries(people.map((p) => [p.id, 1 / people.length]));
  const fromWeights = (weights) => {
    const total = people.reduce((s, p) => s + (weights[p.id] > 0 ? weights[p.id] : 0), 0);
    if (!(total > 0)) return equal;
    return Object.fromEntries(people.map((p) => [p.id, (weights[p.id] > 0 ? weights[p.id] : 0) / total]));
  };
  if (state.split.mode === 'custom') return fromWeights(state.split.shares || {});
  if (state.split.mode === 'income') {
    const incomes = {};
    for (const item of items) {
      if (item.personId && incomeValue(item)) incomes[item.personId] = (incomes[item.personId] || 0) + item.amount;
    }
    return fromWeights(incomes);
  }
  return equal;
}

/**
 * Quem pagou o quê das contas da casa e quem deve acertar com quem.
 * Só entram no acerto contas já pagas e com pagador definido: conta ainda
 * em aberto não gera dívida entre o casal.
 */
export function houseSplit(state, ym, items = monthItems(state, ym)) {
  const bills = items.filter((i) => i.scope === 'house' && expenseValue(i) !== 0);
  const total = round2(sum(bills, expenseValue));
  const shares = splitShares(state, items);
  const paidBills = bills.filter((i) => i.paid && i.personId);
  const paidBase = round2(sum(paidBills, expenseValue));
  const settlements = state.settlements.filter((s) => s.month === ym);

  const people = state.people.map((p) => {
    const paid = sum(paidBills.filter((i) => i.personId === p.id), expenseValue);
    const share = shares[p.id] || 0;
    let net = paid - share * paidBase;
    for (const s of settlements) {
      if (s.from === p.id) net += s.amount;
      if (s.to === p.id) net -= s.amount;
    }
    return { person: p, share, planned: round2(share * total), paid, net: round2(net) };
  });

  // Quem está negativo paga a quem está positivo, do maior para o menor.
  const debtors = people.filter((p) => p.net < -0.004).map((p) => ({ id: p.person.id, left: -p.net }));
  const creditors = people.filter((p) => p.net > 0.004).map((p) => ({ id: p.person.id, left: p.net }));
  const transfers = [];
  for (const d of debtors) {
    for (const c of creditors) {
      const amount = round2(Math.min(d.left, c.left));
      if (amount <= 0) continue;
      transfers.push({ from: d.id, to: c.id, amount });
      d.left = round2(d.left - amount);
      c.left = round2(c.left - amount);
    }
  }
  return { bills, total, paidBase, shares, people, transfers, settlements };
}

/** Resumo do mês do ponto de vista de uma pessoa (ou do casal, com personId null). */
export function leftover(state, ym, personId = null, allItems = monthItems(state, ym)) {
  const items = allItems.filter((i) => !i.transfer);
  const house = houseSplit(state, ym, items);
  const personalItems = items.filter((i) => i.scope !== 'house');
  if (!personId) {
    const income = round2(sum(items, incomeValue));
    const personal = round2(sum(personalItems, expenseValue));
    return { income, house: house.total, personal, left: round2(income - house.total - personal) };
  }
  const share = house.shares[personId] || 0;
  // Receita e gasto pessoal sem dono ("do casal") entram pela mesma proporção da casa.
  const mine = (list, value) => round2(sum(list, (i) => (i.personId === personId ? value(i) : i.personId ? 0 : value(i) * share)));
  const income = mine(items, incomeValue);
  const personal = mine(personalItems, expenseValue);
  const houseShare = round2(house.total * share);
  return { income, house: houseShare, personal, left: round2(income - houseShare - personal) };
}

// ------------------------------------------------------------ a receber

/** Quanto de um empréstimo já voltou e quanto falta. */
export function loanStatus(state, entry) {
  const returned = sum(state.entries.filter((e) => e.source?.kind === 'loan' && e.source.id === entry.id), (e) => e.amount);
  return { returned, outstanding: Math.max(0, round2(entry.amount - returned)) };
}

/** Empréstimos ainda não devolvidos por inteiro, do mais antigo para o mais novo. */
export function openLoans(state) {
  return state.entries
    .filter((e) => e.loan)
    .map((entry) => ({ entry, ...loanStatus(state, entry) }))
    .filter((loan) => loan.outstanding > 0)
    .sort((a, b) => a.entry.date.localeCompare(b.entry.date));
}

/**
 * Quanto dá para gastar por dia até o fim do mês sem estourar a sobra.
 * A sobra já desconta todas as contas previstas, então isto é dinheiro livre.
 */
export function dailyAllowance(left, todayDate, ym) {
  if (ymOf(todayDate) !== ym || !(left > 0)) return null;
  const days = daysInMonth(ym) - dayOf(todayDate) + 1;
  return { days, perDay: round2(left / days) };
}

// ---------------------------------------------------------------- cartões

export function cardInvoice(state, card, ym) {
  const items = monthItems(state, ym).filter((i) => i.accountId === card.id);
  const closing = Number(card.closingDay) || 0;
  const due = Number(card.dueDay) || 0;
  const payment = invoicePayment(state, card.id, ym);
  return {
    month: ym,
    items,
    total: round2(sum(items, (i) => (i.cardCredit ? -i.amount : i.amount))),
    payment,
    paid: !!payment,
    dueDate: due ? dateIn(ym, due) : null,
    closingDate: closing ? dateIn(due > closing ? ym : addMonths(ym, -1), closing) : null,
  };
}

/**
 * Quanto do limite está preso: faturas em aberto até o mês atual, mais compras
 * e parcelas já feitas que caem em faturas futuras. Assinaturas futuras não
 * entram, porque ainda não foram cobradas.
 */
export function cardCommitted(state, card, currentYm, horizon = 36) {
  let total = 0;
  // Começa na compra mais antiga do cartão, para fatura antiga esquecida em aberto também contar.
  const months = state.entries.filter((e) => e.accountId === card.id).map((e) => effectiveMonth(state, e));
  const oldest = months.length ? months.reduce((a, b) => (a < b ? a : b)) : currentYm;
  for (let offset = Math.min(0, monthDiff(currentYm, oldest)); offset <= horizon; offset++) {
    const ym = addMonths(currentYm, offset);
    if (invoicePayment(state, card.id, ym)) continue;
    const items = monthItems(state, ym).filter((i) => i.accountId === card.id);
    // Só a fatura do mês atual conta assinaturas: as passadas não têm histórico e as futuras ainda não foram cobradas.
    total += sum(offset === 0 ? items : items.filter((i) => i.kind !== 'recurring'), (i) => (i.cardCredit ? -i.amount : i.amount));
  }
  return round2(total);
}

// ----------------------------------------------------------------- saldos

/** Contas de dinheiro cujo saldo ainda não foi informado (planilha importada, backups antigos). */
export function accountsNeedingBalance(state) {
  return state.accounts.filter((a) => isMoneyAccount(a) && !a.archived && !a.balanceSetup);
}

/**
 * Saldo inicial que faz o saldo de hoje bater com o valor informado pelo usuário,
 * sem mexer no histórico: o que já foi lançado continua somado por cima dele.
 */
export function openingForBalance(state, account, balance, todayDate) {
  const futureStart = !!account.openingDate && account.openingDate > todayDate;
  const probe = { ...account, opening: 0, openingDate: futureStart ? null : account.openingDate || null };
  return { opening: round2(balance - accountBalance(state, probe, todayDate)), openingDate: probe.openingDate };
}

/** Saldo pago/recebido até asOf (opcional). openingDate é o início do dia; sem ela, mantém todo o histórico dos backups antigos. */
export function accountBalance(state, account, asOf = null) {
  if (asOf && account.openingDate && account.openingDate > asOf) return null;
  const inPeriod = (date) => (!account.openingDate || date >= account.openingDate) && (!asOf || date <= asOf);
  let balance = Number(account.opening) || 0;
  for (const e of state.entries) {
    if (e.accountId !== account.id || !e.paid || !inPeriod(e.date)) continue;
    balance += e.type === 'income' ? e.amount : -e.amount;
  }
  for (const p of state.invoicePayments) {
    if (p.fromAccountId === account.id && inPeriod(p.date)) balance -= p.amount;
  }
  return round2(balance);
}

export function goalSaved(state, goal) {
  const added = sum(state.entries.filter((e) => e.source?.kind === 'goal' && e.source.id === goal.id), (e) => e.amount);
  return round2((Number(goal.initial) || 0) + added);
}

export function goalPlan(state, goal, currentYm) {
  const saved = goalSaved(state, goal);
  const missing = Math.max(0, round2(goal.target - saved));
  const months = goal.deadline ? Math.max(1, monthDiff(currentYm, ymOf(goal.deadline))) : null;
  return {
    saved,
    missing,
    progress: goal.target > 0 ? Math.min(1, saved / goal.target) : 0,
    months,
    perMonth: months && missing > 0 ? round2(missing / months) : 0,
    late: !!goal.deadline && missing > 0 && ymOf(goal.deadline) < currentYm,
  };
}

export function debtBalance(state, debt) {
  const paid = sum(state.entries.filter((e) => e.source?.kind === 'debt' && e.source.id === debt.id), (e) => e.amount);
  return Math.max(0, round2((Number(debt.initial) || 0) - paid));
}

// --------------------------------------------------------------- projeção

/**
 * Fluxo dos próximos meses: só lançamentos, recorrentes e parcelas — a mesma
 * base da sobra do mês, para os dois blocos sempre baterem. O sobre-teto das
 * categorias é margem de tolerância, não previsão, e não entra aqui.
 */
export function projection(state, fromYm, months) {
  const rows = [];
  let accumulated = 0;
  for (let i = 0; i < months; i++) {
    const ym = addMonths(fromYm, i);
    const { income, expense } = summarize(monthItems(state, ym));
    const balance = round2(income - expense);
    accumulated = round2(accumulated + balance);
    rows.push({ month: ym, income, expense, balance, accumulated });
  }
  return rows;
}

/**
 * Situação do gasto de uma categoria contra o teto (limite mensal) e o
 * sobre-teto (margem extra para urgências, campo `estimate`).
 * - none: sem teto definido;
 * - ok: dentro do teto;
 * - margin: passou do teto, mas ainda dentro do sobre-teto;
 * - red: passou do teto + sobre-teto (ou do teto, sem sobre-teto).
 */
export function budgetStatus(category, spent) {
  const limit = Number(category?.budget) || 0;
  const margin = limit > 0 ? Math.max(0, Number(category?.estimate) || 0) : 0;
  const ceiling = round2(limit + margin);
  if (!(limit > 0)) return { state: 'none', limit, margin, ceiling, overLimit: 0, marginUsed: 0, overCeiling: 0 };
  const overLimit = Math.max(0, round2(spent - limit));
  const overCeiling = Math.max(0, round2(spent - ceiling));
  const state = overCeiling > 0 ? 'red' : overLimit > 0 ? 'margin' : 'ok';
  return { state, limit, margin, ceiling, overLimit, marginUsed: Math.min(overLimit, margin), overCeiling };
}

// --------------------------------------------------- referências cruzadas

/** Quantos registros usam uma conta, categoria ou pessoa (para não apagar algo em uso). */
export function usageCount(state, field, id) {
  const lists = [state.entries, state.recurring, state.installments, state.ofxPending];
  return lists.reduce((n, list) => n + list.filter((x) => x[field] === id).length, 0);
}
