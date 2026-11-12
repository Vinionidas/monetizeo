// Testes das regras financeiras, com dados fictícios. Rode com: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLegacy, migrateLegacy } from '../app/js/migrate.js';
import {
  accountBalance, accountsNeedingBalance, openingForBalance, cardCommitted, cardInvoice, dailyAllowance, debtBalance, emptyState, goalPlan, houseSplit, installmentStatus,
  invoiceMonthFor, isOverdue, leftover, loanStatus, monthItems, openLoans, projection, recurringConfig, summarize,
} from '../app/js/model.js';
import { decodeOfx, invoiceImportChange, invoiceImportTargets, parseOfx, splitNewOfx, withoutInvoicePayment } from '../app/js/ofx.js';
import { addMonths, dateIn, monthDiff, parseMoney, today } from '../app/js/util.js';

function fixture() {
  const s = emptyState();
  s.people = [{ id: 'ana', name: 'Ana' }, { id: 'beto', name: 'Beto' }];
  s.accounts = [
    { id: 'banco', name: 'Banco', type: 'bank', opening: 100 },
    { id: 'cartao', name: 'Cartão', type: 'card', closingDay: 5, dueDay: 10, limit: 2000 },
    { id: 'carne', name: 'Carnê', type: 'credit' },
  ];
  s.categories = [
    { id: 'renda', name: 'Renda', kind: 'income' },
    { id: 'moradia', name: 'Moradia', kind: 'expense', group: 'need', budget: 1000 },
    { id: 'mercado', name: 'Mercado', kind: 'expense', group: 'need', estimate: 800 },
    { id: 'lazer', name: 'Lazer', kind: 'expense', group: 'want' },
  ];
  s.recurring = [
    { id: 'sal-ana', description: 'Salário Ana', amount: 6000, type: 'income', categoryId: 'renda', accountId: 'banco', personId: 'ana', scope: 'personal', day: 5, active: true },
    { id: 'sal-beto', description: 'Salário Beto', amount: 2000, type: 'income', categoryId: 'renda', accountId: 'banco', personId: 'beto', scope: 'personal', day: 5, active: true },
    { id: 'aluguel', description: 'Aluguel', amount: 1000, type: 'expense', categoryId: 'moradia', accountId: 'banco', personId: 'ana', scope: 'house', day: 31, active: true },
    { id: 'stream', description: 'Streaming', amount: 50, type: 'expense', categoryId: 'lazer', accountId: 'cartao', personId: 'beto', scope: 'personal', day: 12, active: true },
  ];
  s.installments = [
    { id: 'moto', description: 'Moto', amount: 500, count: 10, first: '2026-01-15', categoryId: 'lazer', accountId: 'carne', personId: 'beto', scope: 'personal', paidBefore: 2 },
  ];
  return s;
}

test('datas: meses, último dia e hoje no fuso local', () => {
  assert.equal(addMonths('2026-11', 3), '2027-02');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(monthDiff('2026-11', '2027-02'), 3);
  assert.equal(dateIn('2027-02', 31), '2027-02-28');
  // 23h30 no horário local continua sendo o mesmo dia (o bug antigo usava UTC).
  assert.equal(today(new Date(2026, 10, 10, 23, 30)), '2026-11-10');
});

test('valores digitados em formato brasileiro', () => {
  assert.equal(parseMoney('1.234,56'), 1234.56);
  assert.equal(parseMoney('R$ 10'), 10);
  assert.equal(parseMoney('12,5'), 12.5);
  assert.equal(parseMoney('1234.56'), 1234.56);
  assert.ok(Number.isNaN(parseMoney('')));
});

test('o mês junta lançamentos reais e previsões', () => {
  const s = fixture();
  const items = monthItems(s, '2026-03');
  assert.deepEqual(items.map((i) => i.description).sort(), ['Aluguel', 'Moto (3/10)', 'Salário Ana', 'Salário Beto', 'Streaming']);
  assert.deepEqual(summarize(items), { income: 8000, expense: 1550, paid: 0, pending: 1550, balance: 6450 });
  // dia 31 em mês curto cai no último dia
  assert.equal(monthItems(s, '2027-02').find((i) => i.description === 'Aluguel').date, '2027-02-28');
});

test('pagar uma previsão troca a projeção pelo lançamento, sem duplicar', () => {
  const s = fixture();
  s.entries.push({ id: 'e1', date: '2026-03-30', description: 'Aluguel', amount: 1040, type: 'expense', categoryId: 'moradia', accountId: 'banco', personId: 'ana', scope: 'house', paid: true, source: { kind: 'recurring', id: 'aluguel', period: '2026-03' } });
  const rents = monthItems(s, '2026-03').filter((i) => i.description === 'Aluguel');
  assert.equal(rents.length, 1);
  assert.equal(rents[0].amount, 1040);
  assert.equal(rents[0].paid, true);
  // um lançamento com o mesmo nome, mas sem vínculo, NÃO apaga a previsão
  s.entries.push({ id: 'e2', date: '2026-04-02', description: 'Aluguel', amount: 10, type: 'expense', categoryId: 'moradia', accountId: 'banco', paid: true });
  assert.equal(monthItems(s, '2026-04').filter((i) => i.description === 'Aluguel').length, 2);
  // apagar o lançamento vinculado devolve a previsão
  s.entries = s.entries.filter((e) => e.id !== 'e1');
  assert.equal(monthItems(s, '2026-03').find((i) => i.description === 'Aluguel').projected, true);
});

test('recorrente: reajuste a partir de um mês, fim, pausa e mês pulado', () => {
  const s = fixture();
  const rent = s.recurring.find((r) => r.id === 'aluguel');
  rent.changes = [{ from: '2026-06', amount: 1100 }];
  assert.equal(recurringConfig(rent, '2026-05').amount, 1000);
  assert.equal(recurringConfig(rent, '2026-06').amount, 1100);
  rent.end = '2026-08';
  rent.skips = ['2026-07'];
  const has = (ym) => monthItems(s, ym).some((i) => i.description === 'Aluguel');
  assert.deepEqual([has('2026-06'), has('2026-07'), has('2026-08'), has('2026-09')], [true, false, true, false]);
  rent.active = false;
  assert.equal(has('2026-06'), false);
});

test('parcelas: pagas antes do app, pagas pelo app e juros', () => {
  const s = fixture();
  const moto = s.installments[0];
  assert.equal(installmentStatus(s, moto).paidCount, 2);
  assert.equal(installmentStatus(s, moto).next.month, '2026-03');
  s.entries.push({ id: 'p3', date: '2026-03-20', description: 'Moto (3/10)', amount: 530, type: 'expense', categoryId: 'lazer', accountId: 'banco', paid: true, source: { kind: 'installment', id: 'moto', index: 2 } });
  const st = installmentStatus(s, moto);
  assert.equal(st.paidCount, 3);
  assert.equal(st.paidTotal, 1530);
  assert.equal(st.remainingAmount, 3500);
  assert.equal(monthItems(s, '2026-03').filter((i) => i.description.startsWith('Moto')).length, 1);
  // apagar o pagamento volta a parcela para "em aberto": não existe contador para dessincronizar
  s.entries = [];
  assert.equal(installmentStatus(s, moto).paidCount, 2);
  // depois da última parcela, nada mais é projetado
  assert.equal(monthItems(s, '2026-11').some((i) => i.description.startsWith('Moto')), false);
});

test('cartão: compra depois do fechamento cai na fatura seguinte', () => {
  const card = { closingDay: 5, dueDay: 10 };
  assert.equal(invoiceMonthFor(card, '2026-11-03'), '2026-11');
  assert.equal(invoiceMonthFor(card, '2026-11-06'), '2026-12');
  // fechamento no fim do mês, vencimento no começo do mês seguinte
  assert.equal(invoiceMonthFor({ closingDay: 25, dueDay: 2 }, '2026-11-20'), '2026-12');
  assert.equal(invoiceMonthFor({ closingDay: 25, dueDay: 2 }, '2026-11-26'), '2027-01');
});

test('cartão: fatura, pagamento e limite comprometido', () => {
  const s = fixture();
  const card = s.accounts[1];
  s.entries.push({ id: 'c1', date: '2026-03-06', description: 'Tênis', amount: 300, type: 'expense', categoryId: 'lazer', accountId: 'cartao', personId: 'ana', scope: 'personal', paid: false });
  assert.equal(cardInvoice(s, card, '2026-03').total, 50);
  const april = cardInvoice(s, card, '2026-04');
  assert.equal(april.total, 350);
  assert.equal(april.dueDate, '2026-04-10');
  assert.equal(april.closingDate, '2026-04-05');
  assert.equal(cardCommitted(s, card, '2026-03'), 350); // fatura de março (50) + compra já feita que cai em abril (300)
  s.invoicePayments.push({ id: 'pay', cardId: 'cartao', month: '2026-04', amount: 350, date: '2026-04-10', fromAccountId: 'banco' });
  assert.equal(cardInvoice(s, card, '2026-04').paid, true);
  assert.ok(monthItems(s, '2026-04').filter((i) => i.onCard).every((i) => i.paid));
  assert.equal(accountBalance(s, s.accounts[0]), -250); // 100 de saldo inicial − 350 da fatura
});

test('saldo da conta só conta o que já foi pago ou recebido', () => {
  const s = fixture();
  s.entries.push(
    { id: 'a', date: '2026-03-05', description: 'Salário', amount: 1000, type: 'income', accountId: 'banco', paid: true },
    { id: 'b', date: '2026-03-06', description: 'Conta', amount: 200, type: 'expense', accountId: 'banco', paid: true },
    { id: 'c', date: '2026-03-07', description: 'Previsto', amount: 999, type: 'expense', accountId: 'banco', paid: false },
  );
  assert.equal(accountBalance(s, s.accounts[0]), 900);
});

test('saldo datado: inclui o dia inicial, ignora previsões e movimentos depois de hoje', () => {
  const s = fixture();
  const bank = { ...s.accounts[0], opening: -100, openingDate: '2026-03-05' };
  s.entries = [
    { id: 'old', accountId: bank.id, date: '2026-03-04', amount: 999, type: 'income', paid: true },
    { id: 'start', accountId: bank.id, date: '2026-03-05', amount: 400, type: 'income', paid: true },
    { id: 'today', accountId: bank.id, date: '2026-03-10', amount: 50, type: 'expense', paid: true },
    { id: 'future', accountId: bank.id, date: '2026-03-11', amount: 800, type: 'income', paid: true },
    { id: 'pending', accountId: bank.id, date: '2026-03-06', amount: 900, type: 'expense', paid: false },
    { id: 'card', accountId: 'cartao', date: '2026-03-06', amount: 1000, type: 'expense', paid: true },
  ];
  s.invoicePayments = [
    { id: 'before', fromAccountId: bank.id, date: '2026-03-04', amount: 100 },
    { id: 'paid', fromAccountId: bank.id, date: '2026-03-05', amount: 70 },
    { id: 'future', fromAccountId: bank.id, date: '2026-03-11', amount: 300 },
  ];
  assert.equal(accountBalance(s, bank, '2026-03-10'), 180);
  assert.equal(accountBalance(s, bank, '2026-03-04'), null);
  // Sem data inicial, backups antigos continuam incluindo todo o histórico pago.
  assert.equal(accountBalance(s, s.accounts[0], '2026-03-10'), 1279);
  assert.equal(accountBalance(s, s.accounts[0]), 1779);
});

test('saldo acumulado segue a data real de pagamento, não a competência, e transferências se anulam', () => {
  const s = fixture();
  s.accounts.push({ id: 'wallet', type: 'cash', opening: 0 });
  s.entries = [
    { accountId: 'banco', date: '2026-02-20', type: 'income', amount: 500, paid: true },
    { accountId: 'banco', date: '2026-03-01', type: 'expense', amount: 100, paid: true, source: { kind: 'recurring', id: 'aluguel', period: '2026-02' } },
    { accountId: 'banco', date: '2026-03-02', type: 'expense', amount: 50, paid: true },
    { accountId: 'wallet', date: '2026-03-02', type: 'income', amount: 50, paid: true },
  ];
  assert.equal(accountBalance(s, s.accounts[0], '2026-02-28'), 600);
  assert.equal(accountBalance(s, s.accounts[0], '2026-03-02') + accountBalance(s, s.accounts[3], '2026-03-02'), 500);
});

test('OFX vinculado ao pagamento já registrado não duplica débito, reimportação ou despesas', () => {
  const s = fixture();
  const row = { id: 'row', importId: 'ofx:invoice', amount: 350, date: '2026-03-10', type: 'expense', accountId: 'banco', description: 'Fatura' };
  s.ofxPending = [row];
  s.invoicePayments = [{ id: 'payment', cardId: 'cartao', month: '2026-03', amount: 350, date: row.date, fromAccountId: 'banco' }];
  const before = accountBalance(s, s.accounts[0], row.date);
  const data = { type: 'expense', amount: row.amount, date: row.date, accountId: 'banco' };
  const change = invoiceImportChange(s, row, data, 'payment:payment', 'new-id');
  assert.equal(s.invoicePayments[0].importId, undefined); // regra pura não altera o original
  Object.assign(s, change);
  assert.equal(accountBalance(s, s.accounts[0], row.date), before);
  assert.equal(s.entries.length, 0);
  assert.equal(s.invoicePayments.length, 1);
  assert.equal(s.ofxPending.length, 0);
  assert.equal(splitNewOfx(s, [row]).duplicates, 1);
  // Desfazer o pagamento devolve a transação à fila e libera o saldo uma única vez.
  Object.assign(s, withoutInvoicePayment(s, 'payment'));
  assert.equal(accountBalance(s, s.accounts[0], row.date), 100);
  assert.deepEqual(s.ofxPending, [row]);
  assert.equal(splitNewOfx(s, [row]).duplicates, 1);
  Object.assign(s, withoutInvoicePayment(s, 'payment'));
  assert.equal(s.ofxPending.length, 1);
});

test('OFX pode quitar explicitamente fatura aberta; valida valor, conta, tipo e repetição', () => {
  const s = fixture();
  s.recurring = [];
  s.entries = [{ id: 'purchase', date: '2026-03-01', type: 'expense', amount: 200, accountId: 'cartao', paid: false }];
  const row = { id: 'row', importId: 'ofx:new-invoice', date: '2026-03-10', type: 'expense', amount: 200, accountId: 'banco' };
  s.ofxPending = [row];
  const target = invoiceImportTargets(s, row).find((target) => target.month === '2026-03');
  assert.ok(target);
  const data = { ...row };
  assert.throws(() => invoiceImportChange(s, row, { ...data, amount: 100 }, target.key, 'payment'), /valor do extrato/);
  assert.throws(() => invoiceImportChange(s, row, { ...data, accountId: 'cartao' }, target.key, 'payment'), /conta bancária/);
  assert.throws(() => invoiceImportChange(s, row, { ...data, type: 'income' }, target.key, 'payment'), /conta bancária/);
  assert.deepEqual(invoiceImportTargets(s, { ...row, type: 'income' }), []);
  Object.assign(s, invoiceImportChange(s, row, data, target.key, 'payment'));
  assert.equal(cardInvoice(s, s.accounts[1], '2026-03').paid, true);
  assert.equal(accountBalance(s, s.accounts[0], row.date), -100);
  assert.equal(s.entries.length, 1);
  assert.throws(() => invoiceImportChange(s, row, data, target.key, 'second'), /mudou/);
  // Reverter a confirmação inteira (snapshot) recupera exatamente a fila e a fatura aberta.
  Object.assign(s, withoutInvoicePayment(s, 'payment'));
  assert.equal(cardInvoice(s, s.accounts[1], '2026-03').paid, false);
  assert.equal(s.ofxPending[0].importId, row.importId);
});

test('divisão da casa: meio a meio, proporcional à renda e acerto', () => {
  const s = fixture();
  s.entries.push({ id: 'e1', date: '2026-03-30', description: 'Aluguel', amount: 1000, type: 'expense', categoryId: 'moradia', accountId: 'banco', personId: 'ana', scope: 'house', paid: true, source: { kind: 'recurring', id: 'aluguel', period: '2026-03' } });
  let split = houseSplit(s, '2026-03');
  assert.equal(split.total, 1000);
  assert.deepEqual(split.transfers, [{ from: 'beto', to: 'ana', amount: 500 }]);

  s.split.mode = 'income'; // Ana 6000, Beto 2000 → 75% / 25%
  split = houseSplit(s, '2026-03');
  assert.equal(split.shares.ana, 0.75);
  assert.deepEqual(split.transfers, [{ from: 'beto', to: 'ana', amount: 250 }]);

  s.settlements.push({ id: 's1', month: '2026-03', from: 'beto', to: 'ana', amount: 250, date: '2026-03-31' });
  assert.deepEqual(houseSplit(s, '2026-03').transfers, []);

  // conta ainda não paga não gera acerto
  assert.deepEqual(houseSplit(s, '2026-04').transfers, []);
});

test('sobra do mês: do casal e de cada pessoa fecham entre si', () => {
  const s = fixture();
  const couple = leftover(s, '2026-03');
  const ana = leftover(s, '2026-03', 'ana');
  const beto = leftover(s, '2026-03', 'beto');
  assert.deepEqual(couple, { income: 8000, house: 1000, personal: 550, left: 6450 });
  assert.equal(ana.house + beto.house, couple.house);
  assert.equal(ana.left + beto.left, couple.left);
  assert.equal(beto.personal, 550);
});

test('atrasado: só despesa em aberto, fora do cartão e com data passada', () => {
  const s = fixture();
  const items = monthItems(s, '2026-03');
  const overdue = items.filter((i) => isOverdue(i, '2026-03-20')).map((i) => i.description);
  assert.deepEqual(overdue, ['Moto (3/10)']); // Aluguel vence dia 31; Streaming está no cartão; salário não é despesa
});

test('projeção reserva o gasto variável estimado só nos meses futuros', () => {
  const s = fixture();
  const rows = projection(s, '2026-03', 3, '2026-03');
  assert.equal(rows[0].expense, 1550);
  assert.equal(rows[0].estimated, 0);
  assert.equal(rows[1].expense, 1550 + 800);
  assert.equal(rows[2].accumulated, 6450 + 5650 + 5650);
  // o que já foi lançado na categoria desconta da estimativa
  s.entries.push({ id: 'm', date: '2026-04-03', description: 'Feira', amount: 300, type: 'expense', categoryId: 'mercado', accountId: 'banco', paid: true });
  assert.equal(projection(s, '2026-03', 2, '2026-03')[1].expense, 1550 + 300 + 500);
});

test('metas e dívidas são calculadas pelos lançamentos', () => {
  const s = fixture();
  s.goals = [{ id: 'g', name: 'Viagem', target: 1200, initial: 200, deadline: '2026-07-01' }];
  s.debts = [{ id: 'd', name: 'Banco', initial: 900, payment: 300 }];
  s.entries.push(
    { id: 'g1', date: '2026-03-10', description: 'Reserva', amount: 200, type: 'expense', paid: true, source: { kind: 'goal', id: 'g' } },
    { id: 'd1', date: '2026-03-10', description: 'Pagamento', amount: 300, type: 'expense', paid: true, source: { kind: 'debt', id: 'd' } },
  );
  const plan = goalPlan(s, s.goals[0], '2026-03');
  assert.equal(plan.saved, 400);
  assert.equal(plan.perMonth, 200); // faltam 800 em 4 meses
  assert.equal(debtBalance(s, s.debts[0]), 600);
});

test('OFX: lê SGML sem tag de fechamento, vírgula decimal e descarta duplicadas', () => {
  const text = `<OFX><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261106120000[-3:BRT]<TRNAMT>-150.25<FITID>A1<MEMO>Pix enviado: "LUZ SA"</STMTTRN>
<STMTTRN><DTPOSTED>20261108<TRNAMT>50,00<FITID>A2<MEMO>Pix recebido
<STMTTRN><DTPOSTED>20261109<TRNAMT>-12.30<NAME>Padaria<MEMO>Compra no débito</STMTTRN>
<STMTTRN><DTPOSTED>lixo<TRNAMT>-1.00<FITID>A4</STMTTRN>
</BANKTRANLIST></OFX>`;
  const rows = parseOfx(text);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { importId: 'ofx:A1', date: '2026-11-06', description: 'Pix enviado: "LUZ SA"', memo: '', amount: 150.25, type: 'expense' });
  assert.equal(rows[1].type, 'income');
  assert.equal(rows[1].amount, 50);
  assert.equal(rows[2].description, 'Padaria');
  assert.equal(rows[2].memo, 'Compra no débito');

  const s = fixture();
  s.entries.push({ id: 'x', importId: 'ofx:A1', date: '2026-11-06', amount: 150.25, type: 'expense' });
  s.ofxIgnored.push('ofx:A2');
  const { fresh, duplicates } = splitNewOfx(s, rows);
  assert.equal(duplicates, 2);
  assert.equal(fresh.length, 1);
});

test('OFX: arquivo em Windows-1252 mantém os acentos', () => {
  const bytes = new Uint8Array([0x50, 0x61, 0x64, 0x61, 0x72, 0x69, 0x61, 0x20, 0x53, 0xe3, 0x6f]); // "Padaria São"
  assert.equal(decodeOfx(bytes.buffer), 'Padaria São');
  assert.equal(decodeOfx(new TextEncoder().encode('Pão').buffer), 'Pão');
});

test('migração do formato antigo: cadastros por id, vínculos e parcelas pagas', () => {
  const old = {
    entries: [
      { id: 1, description: 'Salário - Ana', category: 'Renda principal', amount: 2900, account: 'Inter', status: 'Pago', responsible: 'Ana', type: 'income', date: '2026-11-07' },
      { id: 2, description: 'ifood', category: 'Alimentação', amount: 60, account: 'Inter', status: 'Pago', responsible: 'Casal', type: 'expense', date: '2026-11-07' },
      { id: 3, description: 'Sofá (3/5)', category: 'Casa e compras', amount: 100, account: 'Cartão de crédito', status: 'Pago', responsible: 'Casal', type: 'expense', date: '2026-11-05', source: 'installment', sourceId: 1, installmentIndex: 2 },
    ],
    recurring: [{ id: 1, description: 'Salário - Ana', category: 'Renda principal', account: 'Inter', day: 7, amount: 3000, responsible: 'Ana', type: 'income', end: '2026-12-15', active: true }],
    installments: [{ id: 1, description: 'Sofá', category: 'Casa e compras', account: 'Cartão de crédito', first: '2026-09-05', amount: 100, count: 5, paid: 3 }],
    goals: [{ description: 'Férias', target: 3000, saved: 500, deadline: '2027-12-01' }],
    debts: [{ description: 'Nubank', balance: 320.5, payment: 0 }],
  };
  assert.equal(isLegacy(old), true);
  const s = migrateLegacy(old);
  assert.equal(isLegacy(s), false);
  assert.deepEqual(s.people.map((p) => p.name), ['Ana']);
  assert.equal(s.accounts.find((a) => a.name === 'Cartão de crédito').type, 'card');
  assert.equal(s.recurring[0].end, '2026-12');
  // o salário lançado substitui a previsão do mês; o iFood do casal vira conta da casa
  const nov = monthItems(s, '2026-11');
  assert.equal(nov.filter((i) => i.type === 'income').length, 1);
  assert.equal(summarize(nov).income, 2900);
  assert.equal(nov.find((i) => i.description === 'ifood').scope, 'house');
  assert.equal(nov.find((i) => i.description === 'ifood').personId, null);
  // 3 pagas no formato antigo = 2 antes do app + 1 com lançamento
  assert.equal(s.installments[0].paidBefore, 2);
  assert.equal(installmentStatus(s, s.installments[0]).paidCount, 3);
  assert.equal(debtBalance(s, s.debts[0]), 320.5);
});

test('empréstimo a receber fica fora dos gastos e da sobra até voltar', () => {
  const s = fixture();
  s.entries.push({ id: 'l1', date: '2026-03-08', description: 'Emprestado', amount: 300, type: 'expense', categoryId: 'lazer', accountId: 'banco', personId: 'ana', scope: 'personal', paid: true, loan: { to: 'Caio' } });
  const before = leftover(fixture(), '2026-03');
  assert.deepEqual(leftover(s, '2026-03'), before); // não mexe na sobra
  assert.equal(summarize(monthItems(s, '2026-03')).expense, 1550);
  assert.equal(accountBalance(s, s.accounts[0]), -200); // mas o dinheiro saiu da conta
  assert.deepEqual(openLoans(s).map((l) => [l.entry.loan.to, l.outstanding]), [['Caio', 300]]);

  // devolução parcial: entra na conta, não vira renda, e o saldo a receber cai
  s.entries.push({ id: 'r1', date: '2026-03-20', description: 'Devolução', amount: 100, type: 'income', categoryId: 'renda', accountId: 'banco', personId: 'ana', paid: true, source: { kind: 'loan', id: 'l1' } });
  assert.equal(summarize(monthItems(s, '2026-03')).income, 8000);
  assert.equal(loanStatus(s, s.entries[0]).outstanding, 200);
  assert.equal(accountBalance(s, s.accounts[0]), -100);

  // devolvido por inteiro some da lista
  s.entries.push({ id: 'r2', date: '2026-04-02', description: 'Devolução', amount: 200, type: 'income', accountId: 'banco', paid: true, source: { kind: 'loan', id: 'l1' } });
  assert.deepEqual(openLoans(s), []);
});

test('gasto por dia: divide a sobra pelos dias que faltam, só no mês atual', () => {
  assert.deepEqual(dailyAllowance(600, '2026-11-11', '2026-11'), { days: 20, perDay: 30 });
  assert.deepEqual(dailyAllowance(90, '2026-11-30', '2026-11'), { days: 1, perDay: 90 });
  assert.equal(dailyAllowance(600, '2026-11-11', '2026-12'), null); // outro mês
  assert.equal(dailyAllowance(-50, '2026-11-11', '2026-11'), null); // sem sobra
});


test('saldo inicial: contas importadas pedem o saldo; informar o saldo de hoje faz o total bater', () => {
  const s = fixture();
  s.entries.push(
    { id: 'a', date: '2026-03-05', description: 'Salário', amount: 1000, type: 'income', accountId: 'banco', paid: true },
    { id: 'b', date: '2026-03-06', description: 'Conta', amount: 200, type: 'expense', accountId: 'banco', paid: true },
    { id: 'c', date: '2026-04-01', description: 'Futuro', amount: 50, type: 'expense', accountId: 'banco', paid: true },
  );
  // contas vindas de planilha ou backup antigo não têm balanceSetup
  assert.deepEqual(accountsNeedingBalance(s).map((a) => a.id), ['banco']);
  s.accounts[0].balanceSetup = true;
  assert.deepEqual(accountsNeedingBalance(s), []);

  // o banco mostra 2.500 hoje (10/03): o saldo calculado passa a ser exatamente esse
  const { opening, openingDate } = openingForBalance(s, s.accounts[0], 2500, '2026-03-10');
  assert.equal(opening, 1700); // 2500 − (1000 − 200); o lançamento futuro não entra
  Object.assign(s.accounts[0], { opening, openingDate });
  assert.equal(accountBalance(s, s.accounts[0], '2026-03-10'), 2500);
  // e o que for pago depois continua somando por cima
  assert.equal(accountBalance(s, s.accounts[0], '2026-04-01'), 2450);
  // saldo negativo também vale (cheque especial)
  assert.equal(openingForBalance(s, s.accounts[0], -100, '2026-03-10').opening, -900);
  // contas arquivadas e cartões não são cobrados
  s.accounts.push({ id: 'velha', type: 'bank', archived: true }, { id: 'cart', type: 'card' });
  assert.deepEqual(accountsNeedingBalance(s), []);
});

test('transferência marcada à mão fica fora da sobra e do gasto', () => {
  const s = fixture();
  s.entries.push({ id: 't1', date: '2026-03-12', description: 'Devolução', amount: 300, type: 'expense', categoryId: 'lazer', accountId: 'banco', personId: 'ana', scope: 'personal', paid: true, transfer: true });
  assert.equal(summarize(monthItems(s, '2026-03')).expense, 1550);
  assert.equal(accountBalance(s, s.accounts[0]), -200);
});
