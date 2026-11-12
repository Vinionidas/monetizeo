// Converte dados do formato antigo ("Casa em Ordem", onde tudo era texto solto)
// para o formato atual, com pessoas, contas e categorias cadastradas por id.
// Também é o caminho de entrada da planilha: tools/importar_planilha.py gera
// esse formato antigo com um bloco `extras` (metas, tipo de conta, cartão).

import { emptyState } from './model.js';
import { norm, round2, uid, ymOf } from './util.js';

const PERSON_COLORS = ['#2f6fed', '#d6457b', '#0b7a5c', '#a15c00'];
const JOINT = new Set(['casal', 'casa', 'ambos', 'os dois', '']);
// Categorias que normalmente são contas da casa; o usuário ajusta depois.
const HOUSE_CATEGORIES = new Set(['moradia', 'alimentacao', 'casa e compras', 'comunicacao']);
const WANT_CATEGORIES = new Set(['casa e compras', 'assinaturas', 'lazer', 'outras despesas', 'outros']);

export const isLegacy = (data) => !!data && !data.schema && Array.isArray(data.entries) && Array.isArray(data.recurring);

function guessAccountType(name) {
  const n = norm(name);
  if (/cartao/.test(n)) return 'card';
  if (/financ|emprestimo/.test(n)) return 'financing';
  if (/crediario|carne/.test(n)) return 'credit';
  if (/carteira|dinheiro|especie/.test(n)) return 'cash';
  return 'bank';
}

function guessCategory(name) {
  const n = norm(name);
  if (/renda|receita|salario/.test(n)) return { kind: 'income', group: null };
  if (/reserva|invest|metas/.test(n)) return { kind: 'expense', group: 'invest' };
  return { kind: 'expense', group: WANT_CATEGORIES.has(n) ? 'want' : 'need' };
}

export function migrateLegacy(old) {
  const state = emptyState();
  const extras = old.extras || {};

  // Cadastros são criados sob demanda, na ordem em que aparecem.
  const registry = (list, make) => {
    const index = new Map();
    return (name) => {
      const key = norm(name);
      if (!key) return null;
      if (!index.has(key)) {
        const item = { id: uid(), name: String(name).trim(), ...make(String(name).trim()) };
        list.push(item);
        index.set(key, item);
      }
      return index.get(key).id;
    };
  };

  const personId = registry(state.people, () => ({ color: PERSON_COLORS[state.people.length % PERSON_COLORS.length] }));
  const person = (name) => (JOINT.has(norm(name)) ? null : personId(name));

  const accountExtras = new Map((extras.accounts || []).map((a) => [norm(a.name), a]));
  const accountId = registry(state.accounts, (name) => {
    const extra = accountExtras.get(norm(name)) || {};
    return {
      type: extra.type || guessAccountType(name),
      opening: Number(extra.opening ?? old.catalogs?.openingBalances?.[name]) || 0,
      closingDay: Number(extra.closingDay) || null,
      dueDay: Number(extra.dueDay) || null,
      limit: Number(extra.limit) || 0,
      archived: false,
    };
  });

  const categoryExtras = new Map((extras.categories || []).map((c) => [norm(c.name), c]));
  const categoryId = registry(state.categories, (name) => {
    const extra = categoryExtras.get(norm(name)) || {};
    const guess = guessCategory(name);
    return {
      kind: extra.kind || guess.kind,
      group: extra.group !== undefined ? extra.group : guess.group,
      budget: Number(extra.budget) || 0,
      estimate: Number(extra.estimate) || 0,
      archived: false,
    };
  });

  // Mantém a ordem dos cadastros antigos antes de varrer os lançamentos.
  (extras.people || old.catalogs?.people || []).forEach(person);
  (extras.categories || []).forEach((c) => categoryId(c.name));
  (old.catalogs?.categories || []).forEach(categoryId);
  (extras.accounts || []).forEach((a) => accountId(a.name));
  (old.catalogs?.accounts || []).forEach(accountId);

  const scopeOf = (category, responsible, type) => {
    if (type !== 'expense') return 'personal';
    return HOUSE_CATEGORIES.has(norm(category)) || (JOINT.has(norm(responsible)) && responsible) ? 'house' : 'personal';
  };

  const recurringIds = new Map();
  for (const r of old.recurring || []) {
    const id = uid();
    recurringIds.set(r.id, id);
    state.recurring.push({
      id,
      description: r.description,
      amount: Number(r.amount) || 0,
      type: r.type || 'expense',
      categoryId: categoryId(r.category),
      accountId: accountId(r.account),
      personId: person(r.responsible),
      scope: scopeOf(r.category, r.responsible, r.type || 'expense'),
      day: Number(r.day) || 1,
      start: null,
      end: r.end ? ymOf(r.end) : null,
      active: r.active !== false,
      skips: [],
      changes: (r.changes || []).map((c) => ({
        from: c.from,
        ...(c.description ? { description: c.description } : {}),
        ...(c.amount !== undefined ? { amount: Number(c.amount) || 0 } : {}),
        ...(c.day ? { day: Number(c.day) } : {}),
        ...(c.account ? { accountId: accountId(c.account) } : {}),
        ...(c.category ? { categoryId: categoryId(c.category) } : {}),
      })),
    });
  }

  const installmentIds = new Map();
  for (const p of old.installments || []) {
    const id = uid();
    installmentIds.set(p.id, id);
    const linkedPaid = (old.entries || []).filter((e) => e.source === 'installment' && e.sourceId === p.id && e.status === 'Pago').length;
    state.installments.push({
      id,
      description: p.description,
      amount: Number(p.amount) || 0,
      count: Number(p.count) || 1,
      first: p.first,
      categoryId: categoryId(p.category),
      accountId: accountId(p.account),
      personId: person(p.responsible),
      scope: scopeOf(p.category, p.responsible || '', 'expense'),
      paidBefore: Math.max(0, (Number(p.paid) || 0) - linkedPaid),
    });
  }

  const goalIds = new Map();
  for (const g of old.goals || []) {
    const id = uid();
    goalIds.set(g.description, id);
    const added = (old.entries || []).filter((e) => e.source === 'goal' && e.sourceId === g.description).reduce((s, e) => s + e.amount, 0);
    state.goals.push({ id, name: g.description, target: Number(g.target) || 0, initial: round2((Number(g.saved) || 0) - added), deadline: g.deadline || null });
  }

  for (const d of old.debts || []) {
    state.debts.push({ id: uid(), name: d.description, initial: Number(d.balance) || 0, rate: Number(d.rate) || 0, payment: Number(d.payment) || 0 });
  }

  // No formato antigo o recorrente era "substituído" por um lançamento de mesmo nome no mês.
  const recurringByName = new Map(state.recurring.map((r) => [norm(r.description), r]));

  for (const e of old.entries || []) {
    const entry = {
      id: uid(),
      date: e.date,
      description: String(e.description || '').trim(),
      amount: Number(e.amount) || 0,
      type: e.type === 'income' ? 'income' : 'expense',
      categoryId: categoryId(e.category),
      accountId: accountId(e.account),
      personId: person(e.responsible),
      scope: scopeOf(e.category, e.responsible, e.type),
      paid: e.status === 'Pago',
    };
    if (e.importId) entry.importId = String(e.importId).startsWith('ofx:') ? e.importId : `ofx:${e.importId}`;
    if (e.source === 'installment' && installmentIds.has(e.sourceId)) {
      entry.source = { kind: 'installment', id: installmentIds.get(e.sourceId), index: Number(e.installmentIndex) || 0 };
    } else if (e.source === 'goal' && goalIds.has(e.sourceId)) {
      entry.source = { kind: 'goal', id: goalIds.get(e.sourceId) };
    } else {
      const recurring = e.source === 'recurring' ? state.recurring.find((r) => r.id === recurringIds.get(e.sourceId)) : recurringByName.get(norm(e.description));
      if (recurring) {
        entry.source = { kind: 'recurring', id: recurring.id, period: ymOf(e.date) };
        entry.scope = recurring.scope;
      }
    }
    state.entries.push(entry);
  }

  for (const row of old.ofxPending || []) {
    state.ofxPending.push({
      id: uid(),
      importId: String(row.importId).startsWith('ofx:') ? row.importId : `ofx:${row.importId}`,
      date: row.date,
      description: row.description,
      memo: row.memo || '',
      amount: Number(row.amount) || 0,
      type: row.type === 'income' ? 'income' : 'expense',
    });
  }

  return state;
}
