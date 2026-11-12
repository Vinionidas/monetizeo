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
