// Leitura de extratos OFX (formato SGML dos bancos brasileiros e o XML mais novo).
// Interpreta o arquivo e prepara vínculos explícitos de fatura; a fila de revisão confirma.

import { cardInvoice, effectiveMonth, isCard, isMoneyAccount } from './model.js';
import { addMonths, round2, ymOf } from './util.js';

/** Bancos costumam exportar em Windows-1252; alguns já usam UTF-8. */
export function decodeOfx(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

function tag(block, name) {
  const match = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i'));
  return match ? match[1].trim() : '';
}

function parseAmount(raw) {
  const text = raw.replace(/\s/g, '');
  // "1.234,56" (pt-BR) ou "-1234.56" (padrão OFX)
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  return Number(normalized);
}

/**
 * Devolve as transações do extrato:
 * { importId, date, description, memo, amount (sempre positivo), type }.
 */
export function parseOfx(text) {
  // Nem todo banco fecha a tag </STMTTRN>, então cortamos pelo início de cada uma.
  const blocks = text.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0]);
  const rows = [];
  blocks.forEach((block, index) => {
    const amount = parseAmount(tag(block, 'TRNAMT'));
    const posted = tag(block, 'DTPOSTED').slice(0, 8);
    if (!Number.isFinite(amount) || amount === 0 || !/^\d{8}$/.test(posted)) return;
    const date = `${posted.slice(0, 4)}-${posted.slice(4, 6)}-${posted.slice(6, 8)}`;
    const memo = tag(block, 'MEMO');
    const name = tag(block, 'NAME');
    const description = (name || memo || 'Transação do extrato').replace(/\s+/g, ' ').replace(/^"(.*)"$/, '$1').trim();
    const fitid = tag(block, 'FITID');
    rows.push({
      importId: fitid ? `ofx:${fitid}` : `ofx:${date}:${amount}:${index}`,
      date,
      description,
      memo: memo && memo !== description ? memo : '',
      amount: Math.abs(amount),
      type: amount > 0 ? 'income' : 'expense',
    });
  });
  return rows;
}

/** Separa o que é novo do que já foi importado, está na fila ou foi ignorado. */
export function splitNewOfx(state, rows) {
  const known = new Set([
    ...state.entries.map((e) => e.importId),
    ...state.invoicePayments.map((p) => p.importId),
    ...state.ofxPending.map((e) => e.importId),
    ...state.ofxIgnored,
  ].filter(Boolean));
  const fresh = [];
  let duplicates = 0;
  for (const row of rows) {
    if (known.has(row.importId)) duplicates++;
    else {
      known.add(row.importId);
      fresh.push(row);
    }
  }
  return { fresh, duplicates };
}

/** Opções explícitas: nunca escolhe uma fatura pelo valor ou descrição do extrato. */
export function invoiceImportTargets(state, row) {
  if (row.type !== 'expense') return [];
  const targets = state.invoicePayments.filter((p) => !p.importId).map((payment) => ({
    key: `payment:${payment.id}`, payment, cardId: payment.cardId, month: payment.month, amount: payment.amount,
  }));
  const months = new Set([-1, 0, 1].map((offset) => addMonths(ymOf(row.date), offset)));
  for (const entry of state.entries) {
    if (isCard(state.accounts.find((a) => a.id === entry.accountId))) months.add(effectiveMonth(state, entry));
  }
  for (const card of state.accounts.filter(isCard)) {
    for (const month of [...months].sort()) {
      const invoice = cardInvoice(state, card, month);
      if (invoice.total > 0 && !invoice.paid) targets.push({ key: `invoice:${card.id}:${month}`, cardId: card.id, month, amount: invoice.total });
    }
  }
  return targets;
}

/** Prepara uma única saída de caixa, vinculando o OFX à fatura em vez de criar despesa. */
export function invoiceImportChange(state, row, data, key, paymentId) {
  const target = invoiceImportTargets(state, row).find((candidate) => candidate.key === key);
  if (!target || !state.ofxPending.some((pending) => pending.id === row.id)) throw new Error('A transação ou a fatura mudou. Reabra a revisão.');
  if (splitNewOfx({ ...state, ofxPending: [] }, [row]).duplicates) throw new Error('Esta transação já foi confirmada ou ignorada.');
  if (data.type !== 'expense' || !isMoneyAccount(state.accounts.find((a) => a.id === data.accountId))) throw new Error('Pagamento de fatura precisa sair de uma conta bancária ou dinheiro.');
  if (round2(data.amount) !== round2(row.amount) || round2(data.amount) !== round2(target.amount)) throw new Error('O valor do extrato precisa ser igual ao pagamento da fatura. Confira a fatura antes de vincular.');
  const payment = {
    ...(target.payment || { id: paymentId, cardId: target.cardId, month: target.month }),
    amount: data.amount, date: data.date, fromAccountId: data.accountId, importId: row.importId, ofxRow: { ...row },
  };
  return {
    invoicePayments: [...state.invoicePayments.filter((p) => p.id !== payment.id), payment],
    ofxPending: state.ofxPending.filter((pending) => pending.id !== row.id),
  };
}

/** Desfazer a fatura devolve seu extrato à fila, onde pode ser revisto sem duplicar. */
export function withoutInvoicePayment(state, paymentId) {
  const payment = state.invoicePayments.find((p) => p.id === paymentId);
  const invoicePayments = state.invoicePayments.filter((p) => p.id !== paymentId);
  let ofxPending = state.ofxPending;
  if (payment?.ofxRow && !splitNewOfx({ ...state, invoicePayments }, [payment.ofxRow]).duplicates) ofxPending = [...ofxPending, payment.ofxRow];
  return { invoicePayments, ofxPending };
}
