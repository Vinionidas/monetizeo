// Leitura de extratos OFX (formato SGML dos bancos brasileiros e o XML mais novo).
// Interpreta o arquivo e prepara vínculos explícitos de fatura; a fila de revisão confirma.

import { cardInvoice, effectiveMonth, invoiceMonthFor, isCard, isMoneyAccount, isTransfer, monthItems } from './model.js';
import { addMonths, diffDays, round2, ymOf } from './util.js';

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

/**
 * Chave de duplicidade: conta do extrato + identificador da transação. O FITID
 * só é único dentro de um banco, então o mesmo código em extratos de contas
 * diferentes (Inter e VA, por exemplo) não é a mesma transação.
 */
export const importKey = (accountId, importId) => `${accountId || ''}|${importId}`;

/** Separa o que é novo do que já foi importado, está na fila ou foi ignorado nesta conta. */
export function splitNewOfx(state, rows, accountId = null) {
  const known = new Set();
  const add = (account, id) => { if (id) known.add(importKey(account, id)); };
  for (const e of state.entries) add(e.importAccountId || e.accountId, e.importId);
  for (const p of state.invoicePayments) add(p.importAccountId || p.fromAccountId, p.importId);
  for (const p of state.ofxPending) add(p.accountId, p.importId);
  // Ignorados antigos guardavam só o identificador e valem para qualquer conta.
  const legacyIgnored = new Set(state.ofxIgnored.filter((id) => !id.includes('|')));
  for (const id of state.ofxIgnored) if (id.includes('|')) known.add(id);
  const fresh = [];
  let duplicates = 0;
  for (const row of rows) {
    const key = importKey(accountId ?? row.accountId, row.importId);
    if (known.has(key) || legacyIgnored.has(row.importId)) duplicates++;
    else {
      known.add(key);
      fresh.push(row);
    }
  }
  return { fresh, duplicates };
}

/**
 * Contas previstas que esta transação pode estar quitando. No cartão, olha a
 * fatura em que a compra cai (e as vizinhas), para assinatura e parcela do
 * cartão poderem ser vinculadas em vez de duplicadas.
 */
export function reviewCandidates(state, row) {
  const account = state.accounts.find((a) => a.id === row.accountId);
  if (isCard(account)) {
    if (row.type !== 'expense') return [];
    const base = invoiceMonthFor(account, row.date);
    return [0, -1, 1].flatMap((offset) => monthItems(state, addMonths(base, offset)))
      .filter((i) => i.projected && i.accountId === account.id && i.type === 'expense');
  }
  return monthItems(state, ymOf(row.date)).filter((i) => !i.paid && !i.onCard && i.type === row.type);
}

/**
 * Outra ponta de uma transferência entre contas nossas: lançamento real, de
 * tipo oposto, mesmo valor, em outra conta com saldo, até 3 dias de distância.
 */
export function transferCandidates(state, row) {
  return state.entries.filter((e) => {
    if (e.accountId === row.accountId || isTransfer(e) || e.type === row.type) return false;
    if (round2(e.amount) !== round2(row.amount) || Math.abs(diffDays(e.date, row.date)) > 3) return false;
    return isMoneyAccount(state.accounts.find((a) => a.id === e.accountId));
  });
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
    amount: data.amount, date: data.date, fromAccountId: data.accountId, importId: row.importId, importAccountId: row.accountId, ofxRow: { ...row },
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
