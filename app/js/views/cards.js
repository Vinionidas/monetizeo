// Cartões: a fatura do mês de cada cartão, o limite comprometido e as próximas faturas.

import { openAccountForm, openItem, payInvoice, undoInvoicePayment } from '../actions.js';
import { cardCommitted, cardInvoice, isCard } from '../model.js';
import { bar } from '../ui.js';
import { addMonths, esc, fmtDate, fmtMonth, fmtMonthShort, money } from '../util.js';
import { bigMoney, empty, findItem, itemRow, lookups } from './shared.js';

function cardSection(ctx, card, look) {
  const { state } = ctx;
  const invoice = cardInvoice(state, card, ctx.ym);
  const committed = cardCommitted(state, card, ctx.currentYm);
  const limit = card.limit > 0
    ? `<div class="limit"><div class="limit-text"><span>Limite usado</span><span><strong>${esc(money(committed))}</strong> de ${esc(money(card.limit))}</span></div>${bar(committed / card.limit, { tone: committed > card.limit ? 'over' : '' })}<small class="muted">Disponível: ${esc(money(Math.max(0, card.limit - committed)))}</small></div>`
    : `<p class="muted">Comprometido em faturas abertas e parcelas: <strong>${esc(money(committed))}</strong>. Cadastre o limite para acompanhar o quanto está livre.</p>`;
  const status = invoice.total <= 0 ? '<span class="pill">Sem compras</span>'
    : invoice.paid ? `<span class="pill ok">Paga em ${esc(fmtDate(invoice.payment.date))}</span>`
      : invoice.dueDate && invoice.dueDate < ctx.today ? '<span class="pill bad">Vencida</span>' : '<span class="pill">Em aberto</span>';
  const action = invoice.paid
    ? '<button type="button" class="btn small" data-action="unpay-invoice" data-card="' + esc(card.id) + '">Desfazer pagamento</button>'
    : invoice.total > 0 ? '<button type="button" class="btn primary" data-action="pay-invoice" data-card="' + esc(card.id) + '">Pagar fatura</button>' : '';
  const next = Array.from({ length: 6 }, (_, i) => {
    const ym = addMonths(ctx.ym, i);
    const inv = i === 0 ? invoice : cardInvoice(state, card, ym);
    return `<a href="#" class="mini${i === 0 ? ' current' : ''}" data-action="month" data-ym="${ym}"><small>${esc(fmtMonthShort(ym))}</small><strong>${esc(money(inv.total))}</strong><small class="${inv.paid ? 'pos' : 'muted'}">${inv.paid ? 'paga' : inv.total > 0 ? 'aberta' : '—'}</small></a>`;
  }).join('');
  return `
    <section class="card">
      <header class="card-head"><h2>${esc(card.name)}</h2><button type="button" class="btn small" data-action="edit-card" data-card="${esc(card.id)}">Editar cartão</button></header>
      <div class="invoice">
        <div>
          <p class="muted">Fatura de ${esc(fmtMonth(ctx.ym))} ${status}</p>
          ${bigMoney(invoice.total)}
          <p class="muted">${invoice.closingDate ? `Fecha em ${esc(fmtDate(invoice.closingDate))}` : ''}${invoice.dueDate ? ` · vence em ${esc(fmtDate(invoice.dueDate))}` : ''}</p>
        </div>
        ${action}
      </div>
      ${limit}
      <div class="minis">${next}</div>
      ${invoice.items.length ? `<ul class="rows">${invoice.items.map((i) => itemRow(ctx, i, look, { showDate: true })).join('')}</ul>` : empty('Fatura vazia', 'Nenhuma compra, parcela ou assinatura cai nesta fatura.')}
    </section>`;
}

export function render(ctx) {
  const cards = ctx.state.accounts.filter((a) => isCard(a) && !a.archived);
  if (!cards.length) {
    return `<section class="card">${empty('Nenhum cartão cadastrado', 'Cadastre o cartão com fechamento e vencimento: as compras passam a cair na fatura certa.', '<button type="button" class="btn primary" data-action="new-card">Cadastrar cartão</button>')}</section>`;
  }
  const look = lookups(ctx.state);
  return cards.map((card) => cardSection(ctx, card, look)).join('');
}

const cardOf = (ctx, el) => ctx.state.accounts.find((a) => a.id === el.dataset.card);

export const actions = {
  item: (ctx, el) => { const item = findItem(ctx.state, el); if (item) openItem(ctx, item); },
  'new-card': () => openAccountForm(null, 'card'),
  'edit-card': (ctx, el) => openAccountForm(cardOf(ctx, el)),
  'pay-invoice': (ctx, el) => { const card = cardOf(ctx, el); payInvoice(ctx, card, cardInvoice(ctx.state, card, ctx.ym)); },
  'unpay-invoice': (ctx, el) => { const card = cardOf(ctx, el); undoInvoicePayment(card, cardInvoice(ctx.state, card, ctx.ym)); },
};
