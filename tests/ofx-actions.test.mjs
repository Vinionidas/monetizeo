// Exercita os handlers reais; apenas formulário e persistência são substituídos.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { accountBalance, cardInvoice, emptyState } from '../app/js/model.js';
import { splitNewOfx } from '../app/js/ofx.js';

const harness = { state: null, form: null, previous: null };
globalThis.__monetizeoActionTest = harness;
after(() => { delete globalThis.__monetizeoActionTest; });
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const stubs = {
  './store.js': moduleUrl(`
    const h = globalThis.__monetizeoActionTest;
    export const getState = () => h.state;
    export const update = (fn) => { h.previous = structuredClone(h.state); fn(h.state); };
    export const undo = () => { h.state = h.previous; return true; };
    export const replaceAll = (state) => { h.state = state; };
  `),
  './ui.js': moduleUrl(`
    const h = globalThis.__monetizeoActionTest;
    export const openForm = (form) => { h.form = form; };
    export const toast = () => {};
    export const confirmDialog = async () => true;
    export const openDialog = () => {};
  `),
};
const actionUrl = new URL('../app/js/actions.js', import.meta.url);
const source = (await readFile(actionUrl, 'utf8')).replace(/from '(\.\/[^']+)'/g,
  (_, path) => `from '${stubs[path] || new URL(path, actionUrl).href}'`);
const { payInvoice, reviewOfx, undoInvoicePayment } = await import(moduleUrl(source));
const ctx = { today: '2026-11-11', ym: '2026-11', currentYm: '2026-11', me: null };

function fixture(paid = false) {
  const state = emptyState();
  state.accounts = [
    { id: 'bank', name: 'Banco', type: 'bank', opening: 1000 },
    { id: 'card', name: 'Cartão', type: 'card', closingDay: 5, dueDay: 10 },
  ];
  state.categories = [{ id: 'expense', name: 'Compras', kind: 'expense' }];
  state.entries = [{ id: 'purchase', accountId: 'card', type: 'expense', amount: 300, date: '2026-11-01', description: 'Compra', categoryId: 'expense' }];
  if (paid) state.invoicePayments = [{ id: 'payment', cardId: 'card', month: '2026-11', amount: 300, fromAccountId: 'bank', date: '2026-11-10' }];
  const row = { id: 'pending', importId: 'ofx:synthetic-payment', accountId: 'bank', type: 'expense', amount: 300, date: '2026-11-10', description: 'Pagamento cartão' };
  state.ofxPending = [row];
  harness.state = state;
  harness.form = null;
  return { state, row, bank: state.accounts[0], card: state.accounts[1] };
}

function submission(link, overrides = {}) {
  return { ...harness.form.values, expenseCategory: 'expense', scope: 'personal', link, ...overrides };
}

test('handler OFX exige escolha explícita e vincula pagamento existente sem duplicar', () => {
  const { state, row, bank } = fixture(true);
  reviewOfx(ctx, row);
  assert.equal(harness.form.values.link, '');
  assert.ok(harness.form.fields.find((f) => f.name === 'link').options.some((o) => o.value === 'payment:payment'));
  assert.equal(harness.form.onSubmit(submission('payment:payment')), undefined);
  assert.equal(state.entries.length, 1);
  assert.equal(state.invoicePayments.length, 1);
  assert.equal(state.ofxPending.length, 0);
  assert.equal(state.invoicePayments[0].importId, row.importId);
  assert.equal(accountBalance(state, bank, ctx.today), 700);
  assert.equal(splitNewOfx(state, [row]).duplicates, 1);
});

test('handler OFX paga fatura aberta e desfazer devolve transação à fila', async () => {
  const { state, row, bank, card } = fixture();
  reviewOfx(ctx, row);
  const submit = harness.form.onSubmit;
  const values = submission('invoice:card:2026-11');
  assert.equal(submit(values), undefined);
  assert.equal(state.entries.length, 1);
  assert.equal(accountBalance(state, bank, ctx.today), 700);
  assert.equal(typeof submit(values), 'string'); // formulário antigo não confirma duas vezes
  assert.equal(state.invoicePayments.length, 1);
  await undoInvoicePayment(card, cardInvoice(state, card, '2026-11'));
  assert.equal(accountBalance(state, bank, ctx.today), 1000);
  assert.equal(state.invoicePayments.length, 0);
  assert.equal(state.ofxPending.length, 1);
  assert.equal(state.ofxPending[0].importId, row.importId);
});

test('handler OFX rejeita vínculo de fatura com valor divergente sem alterar estado', () => {
  const { state, row } = fixture(true);
  reviewOfx(ctx, row);
  const before = structuredClone(state);
  assert.equal(typeof harness.form.onSubmit(submission('payment:payment', { amount: 299 })), 'string');
  assert.deepEqual(state, before);
});

test('handler OFX normal ainda vincula previsão sem criar outro lançamento mensal', () => {
  const { state, row, bank } = fixture();
  state.entries = [];
  state.recurring = [{ id: 'rent', description: 'Aluguel', type: 'expense', amount: 300, accountId: 'bank', categoryId: 'expense', active: true, day: 10 }];
  reviewOfx(ctx, row);
  const submit = harness.form.onSubmit;
  const values = submission('r:rent:2026-11');
  submit(values);
  assert.equal(state.entries.length, 1);
  assert.deepEqual(state.entries[0].source, { kind: 'recurring', id: 'rent', period: '2026-11' });
  assert.equal(state.ofxPending.length, 0);
  assert.equal(accountBalance(state, bank, ctx.today), 700);
  assert.equal(typeof submit(values), 'string');
  assert.equal(state.entries.length, 1);
});

test('handler manual de fatura desconta apenas no pagamento e permite desfazer', async () => {
  const { state, bank, card } = fixture();
  assert.equal(accountBalance(state, bank, ctx.today), 1000);
  payInvoice(ctx, card, cardInvoice(state, card, '2026-11'));
  const submit = harness.form.onSubmit;
  const values = { date: '2026-11-10', fromAccountId: 'bank' };
  submit(values);
  assert.equal(accountBalance(state, bank, ctx.today), 700);
  assert.equal(state.entries.length, 1);
  assert.equal(typeof submit(values), 'string');
  assert.equal(state.invoicePayments.length, 1);
  await undoInvoicePayment(card, cardInvoice(state, card, '2026-11'));
  assert.equal(accountBalance(state, bank, ctx.today), 1000);
});

// ---------------------------------------------------------- revisão de 12/11

import { emptyState as freshState, monthItems as itemsOf, summarize as totals, cardInvoice as invoiceOf, expensesByCategory as byCategory, cardCommitted as committedOf, isMoneyAccount as moneyAccount } from '../app/js/model.js';
import { reviewCandidates, splitNewOfx as splitNew, transferCandidates } from '../app/js/ofx.js';

function wallet() {
  const s = freshState();
  s.accounts = [
    { id: 'inter', name: 'Inter', type: 'bank', opening: 0 },
    { id: 'cc', name: 'Cartão', type: 'card', closingDay: 5, dueDay: 12 },
    { id: 'va', name: 'VA', type: 'benefit', opening: 0 },
  ];
  s.categories = [{ id: 'merc', name: 'Mercado', kind: 'expense' }, { id: 'renda', name: 'Renda', kind: 'income' }];
  return s;
}

test('crédito no cartão abate a fatura e o gasto, sem virar renda', () => {
  const s = wallet();
  s.entries.push(
    { id: '1', date: '2026-11-03', description: 'Compra', amount: 500, type: 'expense', categoryId: 'merc', accountId: 'cc', paid: true },
    { id: '2', date: '2026-11-04', description: 'Estorno', amount: 120, type: 'income', categoryId: 'merc', accountId: 'cc', paid: true },
  );
  const items = itemsOf(s, '2026-11');
  assert.equal(totals(items).income, 0);
  assert.equal(totals(items).expense, 380);
  assert.equal(invoiceOf(s, s.accounts[1], '2026-11').total, 380);
  assert.deepEqual(byCategory(s, items).map((t) => t.total), [380]);
  assert.equal(committedOf(s, s.accounts[1], '2026-11'), 380);
});

test('limite do cartão conta fatura esquecida em aberto há mais de 6 meses', () => {
  const s = wallet();
  s.entries.push({ id: 'old', date: '2025-12-01', description: 'Antiga', amount: 90, type: 'expense', categoryId: 'merc', accountId: 'cc', paid: true });
  assert.equal(committedOf(s, s.accounts[1], '2026-11'), 90);
});

test('assinatura do cartão aparece para vínculo na revisão do extrato do cartão', () => {
  const s = wallet();
  s.recurring.push({ id: 'net', description: 'Netflix', amount: 40, type: 'expense', categoryId: 'merc', accountId: 'cc', day: 20, active: true });
  const keys = reviewCandidates(s, { accountId: 'cc', type: 'expense', date: '2026-11-20', amount: 40 }).map((i) => i.key);
  assert.ok(keys.includes('r:net:2026-12'));
  // no extrato do banco, conta de cartão não aparece
  assert.equal(reviewCandidates(s, { accountId: 'inter', type: 'expense', date: '2026-11-20', amount: 40 }).length, 0);
});

test('mesmo FITID em contas diferentes não é duplicado; na mesma conta é', () => {
  const s = wallet();
  s.entries.push({ id: 'x', date: '2026-11-05', description: 'X', amount: 10, type: 'expense', accountId: 'inter', importId: 'ofx:0001', paid: true });
  const row = { importId: 'ofx:0001', date: '2026-11-05', amount: 10, type: 'expense' };
  assert.equal(splitNew(s, [row], 'va').fresh.length, 1);
  assert.equal(splitNew(s, [row], 'inter').duplicates, 1);
  // lançamento cuja conta foi trocada na revisão continua protegido pela conta de origem
  s.entries[0].accountId = 'cc';
  s.entries[0].importAccountId = 'inter';
  assert.equal(splitNew(s, [row], 'inter').duplicates, 1);
  // ignorado antigo (sem conta) vale para todas
  assert.equal(splitNew({ ...s, entries: [], ofxIgnored: ['ofx:0001'] }, [row], 'va').duplicates, 1);
});

test('transferência entre contas nossas: acha a outra ponta e sai de gastos e renda', () => {
  const s = wallet();
  s.entries.push({ id: 'out', date: '2026-11-16', description: 'Pix para VA', amount: 200, type: 'expense', categoryId: 'merc', accountId: 'inter', paid: true });
  const pair = transferCandidates(s, { accountId: 'va', type: 'income', amount: 200, date: '2026-11-17' });
  assert.deepEqual(pair.map((e) => e.id), ['out']);
  assert.equal(transferCandidates(s, { accountId: 'va', type: 'income', amount: 200, date: '2026-11-25' }).length, 0);
  s.entries[0].transfer = true;
  s.entries.push({ id: 'in', date: '2026-11-17', description: 'Pix recebido', amount: 200, type: 'income', categoryId: 'renda', accountId: 'va', paid: true, transfer: true });
  assert.deepEqual([totals(itemsOf(s, '2026-11')).income, totals(itemsOf(s, '2026-11')).expense], [0, 0]);
});

test('VA (benefício) tem saldo como conta: recarga é renda, compra é gasto', () => {
  const s = wallet();
  assert.ok(moneyAccount(s.accounts[2]));
  s.entries.push(
    { id: 'r', date: '2026-11-01', description: 'Recarga VA', amount: 800, type: 'income', categoryId: 'renda', accountId: 'va', paid: true },
    { id: 'c', date: '2026-11-02', description: 'Mercado', amount: 300, type: 'expense', categoryId: 'merc', accountId: 'va', paid: true },
  );
  assert.deepEqual([totals(itemsOf(s, '2026-11')).income, totals(itemsOf(s, '2026-11')).expense], [800, 300]);
});
