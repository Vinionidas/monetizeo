// Cartões e contas: um cartão visual por conta (crédito, banco, VA, dinheiro),
// e o extrato do escolhido, com a importação do OFX feita ali mesmo.

import { CARD_COLORS, importOfxFile, openAccountForm, openInstallmentForm, openItem, payInvoice, payItem, reviewOfx, undoInvoicePayment } from '../actions.js';
import { ACCOUNT_TYPES, accountBalance, cardCommitted, cardInvoice, installmentStatus, isCard, isMoneyAccount, monthItems } from '../model.js';
import { bar, icon } from '../ui.js';
import { addMonths, byId, diffDays, esc, fmtDate, fmtDay, fmtMonth, fmtMonthShort, fmtWeekday, money, round2, sum } from '../util.js';
import { bigMoney, empty, findItem, itemRow, lookups, personDot, sectionHead } from './shared.js';

const DEFAULT_COLOR = { card: 'graphite', bank: 'blue', benefit: 'orange', cash: 'emerald', credit: 'purple', financing: 'blue' };
const colorOf = (account) => (CARD_COLORS[account.color] ? account.color : DEFAULT_COLOR[account.type] || 'graphite');

// Conta escolhida nesta aba (fica escolhida ao trocar de mês).
let selected = null;

const visible = (state) => state.accounts.filter((a) => !a.archived);
// Só cartão de crédito, conta de banco e benefício têm cartão de plástico de verdade.
const isPlastic = (a) => isCard(a) || a.type === 'bank' || a.type === 'benefit';
// Crediário (compras parceladas na loja) e financiamento (contrato com prestações):
// os dois são dívidas pagas em parcelas, com a mesma tela, mas cada um com seu nome.
const isCredit = (a) => a.type === 'credit' || a.type === 'financing';
const WORDS = {
  credit: { items: 'Compras', item: 'compra', add: 'Nova compra no crediário', hint: 'cada compra parcelada aparece aqui' },
  financing: { items: 'Contratos', item: 'contrato', add: 'Novo financiamento', hint: 'prestações do contrato' },
};

/** "fecha em 18 dias · vence 05 dez", ou a data já passada. */
function cycleText(invoice, today) {
  const rel = (date, future, past) => {
    const days = diffDays(today, date);
    if (days === 0) return `${future} hoje`;
    return days > 0 ? `${future} em ${days} ${days === 1 ? 'dia' : 'dias'}` : `${past} ${fmtDay(date)}`;
  };
  return [invoice.closingDate && rel(invoice.closingDate, 'fecha', 'fechou'), invoice.dueDate && rel(invoice.dueDate, 'vence', 'venceu')].filter(Boolean).join(' · ');
}

function invoiceStatus(invoice, today) {
  if (invoice.paid) return { label: 'Paga', tone: 'ok' };
  if (invoice.total <= 0) return { label: 'Sem compras', tone: '' };
  if (invoice.dueDate && invoice.dueDate < today) return { label: 'Vencida', tone: 'bad' };
  if (invoice.closingDate && invoice.closingDate < today) return { label: 'Fechada', tone: 'warn' };
  return { label: 'Aberta', tone: 'info' };
}

// ------------------------------------------------------------ cartão visual

function plastic(ctx, account, look) {
  const owner = look.people.get(account.personId);
  let foot;
  if (isCard(account)) {
    const invoice = cardInvoice(ctx.state, account, ctx.ym);
    const free = account.limit > 0 ? Math.max(0, round2(account.limit - cardCommitted(ctx.state, account, ctx.currentYm))) : null;
    foot = `<span><small>Fatura ${esc(fmtMonthShort(ctx.ym))}</small><strong>${esc(money(invoice.total))}</strong></span>
      <span class="right"><small>${free === null ? (invoice.dueDate ? 'Vence' : '') : 'Limite livre'}</small><strong>${free === null ? esc(invoice.dueDate ? fmtDate(invoice.dueDate).slice(0, 5) : '') : esc(money(free))}</strong></span>`;
  } else {
    const balance = accountBalance(ctx.state, account, ctx.today);
    foot = `<span><small>Saldo hoje</small><strong>${balance === null ? '—' : esc(money(balance))}</strong></span>`;
  }
  const pending = ctx.state.ofxPending.filter((r) => r.accountId === account.id).length;
  return `
    <button type="button" class="plastic c-${colorOf(account)}${account.id === selected ? ' on' : ''}" data-action="pick" data-id="${esc(account.id)}" aria-pressed="${account.id === selected}">
      <span class="plastic-top"><span class="plastic-type">${esc(ACCOUNT_TYPES[account.type] || '')}</span>${pending ? `<span class="plastic-badge" title="Extrato aguardando revisão">${pending}</span>` : ''}</span>
      <span class="plastic-chip" aria-hidden="true"></span>
      <span class="plastic-name">${esc(account.name)}</span>
      <span class="plastic-owner">${owner ? esc(owner.name) : 'Casal'}</span>
      <span class="plastic-foot">${foot}</span>
    </button>`;
}

/** Carteira e crediário: bloco simples, sem desenho de cartão. */
function tile(ctx, account) {
  let label;
  let value;
  if (isCredit(account)) {
    const insts = ctx.state.installments.filter((i) => i.accountId === account.id);
    label = 'Saldo devedor';
    value = sum(insts, (i) => installmentStatus(ctx.state, i).remainingAmount);
  } else {
    label = 'Saldo hoje';
    value = accountBalance(ctx.state, account, ctx.today);
  }
  return `
    <button type="button" class="tile${account.id === selected ? ' on' : ''}" data-action="pick" data-id="${esc(account.id)}" aria-pressed="${account.id === selected}">
      <span class="tile-icon">${icon(isCredit(account) ? 'list' : 'wallet', 18)}</span>
      <span class="tile-main"><strong>${esc(account.name)}</strong><small>${esc(isCredit(account) ? ACCOUNT_TYPES[account.type] : 'Carteira')}</small></span>
      <span class="tile-side"><small>${label}</small><strong>${value === null ? '—' : esc(money(value))}</strong></span>
    </button>`;
}

// --------------------------------------------------------------- resumo

function summary(ctx, accounts) {
  const cards = accounts.filter(isCard);
  const money_ = accounts.filter(isMoneyAccount);
  const credits = accounts.filter(isCredit);
  const owed = sum(ctx.state.installments.filter((i) => credits.some((c) => c.id === i.accountId)), (i) => installmentStatus(ctx.state, i).remainingAmount);
  const invoices = sum(cards, (c) => cardInvoice(ctx.state, c, ctx.ym).total);
  const balances = money_.map((a) => accountBalance(ctx.state, a, ctx.today)).filter((b) => b !== null);
  return `
    <div class="cards-summary">
      ${cards.length ? `<section class="card">
        <p class="muted">Cartões de crédito</p>
        ${bigMoney(invoices)}
        <small class="muted">total das faturas que vencem em ${esc(fmtMonth(ctx.ym))}</small>
      </section>` : ''}
      <section class="card">
        <p class="muted">Contas e benefícios</p>
        ${bigMoney(sum(balances, (b) => b), sum(balances, (b) => b) < 0 ? 'neg' : '')}
        <small class="muted">saldo calculado hoje, pelos lançamentos</small>
      </section>
      ${credits.length ? `<section class="card">
        <p class="muted">Crediários e financiamentos</p>
        ${bigMoney(owed)}
        <small class="muted">saldo devedor das parcelas que faltam</small>
      </section>` : ''}
    </div>`;
}

// ------------------------------------------------------ extrato pendente

function queue(ctx, account) {
  const rows = ctx.state.ofxPending.filter((r) => r.accountId === account.id).sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) return '';
  return `
    <div class="queue-inline">
      <p><strong>${rows.length} ${rows.length === 1 ? 'transação' : 'transações'} do extrato aguardando revisão.</strong> <span class="muted">Nada conta nos totais até você confirmar cada uma.</span></p>
      <ul class="rows">${rows.map((r) => `
        <li class="row"><button type="button" class="row-body" data-action="review" data-id="${esc(r.id)}">
          <span class="row-main"><span class="row-title">${esc(r.description)}</span><span class="row-sub">${esc(fmtDate(r.date))}${r.memo ? ` · ${esc(r.memo)}` : ''}</span></span>
          <span class="row-side"><strong class="${r.type === 'income' ? 'pos' : ''}">${r.type === 'income' ? '+' : '−'} ${esc(money(r.amount))}</strong><small>Revisar</small></span>
        </button></li>`).join('')}</ul>
    </div>`;
}

const importButton = (account) => `<label class="btn small file-btn">${icon('upload', 15)} Importar OFX<input type="file" accept=".ofx,.qfx" data-ofx="${esc(account.id)}" hidden></label>`;

function grouped(ctx, items, look, extraRows = []) {
  const rows = [...items.map((i) => ({ date: i.date, html: itemRow(ctx, i, look) })), ...extraRows].sort((a, b) => b.date.localeCompare(a.date));
  const byDate = new Map();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r.html);
  }
  return `<ul class="rows">${[...byDate.entries()].map(([date, list]) => `
    <li class="day"><span>${esc(fmtDay(date))}</span><small>${esc(fmtWeekday(date))}${date === ctx.today ? ' · hoje' : ''}</small></li>${list.join('')}`).join('')}</ul>`;
}

// ------------------------------------------------------- cartão de crédito

function cardDetail(ctx, card, look) {
  const { state } = ctx;
  const invoice = cardInvoice(state, card, ctx.ym);
  const status = invoiceStatus(invoice, ctx.today);
  const committed = cardCommitted(state, card, ctx.currentYm);
  const count = invoice.items.filter((i) => !i.cardCredit).length;
  const limit = card.limit > 0
    ? `<div class="limit"><div class="limit-text"><span>Disponível</span><strong class="${committed > card.limit ? 'neg' : 'pos'}">${esc(money(Math.max(0, card.limit - committed)))}</strong></div>${bar(committed / card.limit, { tone: committed > card.limit ? 'over' : '' })}<small class="muted">usado ${esc(money(committed))} de ${esc(money(card.limit))}</small></div>`
    : `<p class="muted">Comprometido em faturas abertas e parcelas: <strong>${esc(money(committed))}</strong>. Cadastre o limite para ver o disponível.</p>`;
  const action = invoice.paid
    ? `<button type="button" class="btn small" data-action="unpay-invoice" data-card="${esc(card.id)}">Desfazer pagamento</button>`
    : invoice.total > 0 ? `<button type="button" class="btn primary" data-action="pay-invoice" data-card="${esc(card.id)}">Pagar fatura</button>` : '';
  const next = Array.from({ length: 6 }, (_, i) => {
    const ym = addMonths(ctx.ym, i);
    const inv = i === 0 ? invoice : cardInvoice(state, card, ym);
    return `<a href="#" class="mini${i === 0 ? ' current' : ''}" data-action="month" data-ym="${ym}"><small>${esc(fmtMonthShort(ym))}</small><strong>${esc(money(inv.total))}</strong><small class="${inv.paid ? 'pos' : 'muted'}">${inv.paid ? 'paga' : inv.total > 0 ? 'aberta' : '—'}</small></a>`;
  }).join('');
  return `
    <section class="card account-detail c-${colorOf(card)}">
      <header class="card-head">
        <div><h2>${esc(card.name)} <span class="pill ${status.tone}">${esc(status.label)}</span></h2><p class="muted">${esc(cycleText(invoice, ctx.today))}</p></div>
        <div class="button-row">${importButton(card)}<button type="button" class="btn small" data-action="edit-account" data-id="${esc(card.id)}">Editar</button></div>
      </header>
      ${queue(ctx, card)}
      <div class="invoice">
        <div>
          <p class="muted">Fatura de ${esc(fmtMonth(ctx.ym))}${invoice.paid ? ` · paga em ${esc(fmtDate(invoice.payment.date))}` : ''}</p>
          ${bigMoney(invoice.total)}
          <small class="muted">${count} ${count === 1 ? 'compra' : 'compras'}</small>
        </div>
        ${action}
      </div>
      ${limit}
      <div><p class="eyebrow">Próximas faturas</p><div class="minis">${next}</div></div>
      ${invoice.items.length ? grouped(ctx, invoice.items, look) : empty('Fatura vazia', 'Nenhuma compra, parcela ou assinatura cai nesta fatura. Importe o OFX do cartão para trazer as compras.')}
    </section>`;
}

// ------------------------------------------------- conta, VA e dinheiro

function accountDetail(ctx, account, look) {
  const { state } = ctx;
  const items = monthItems(state, ctx.ym).filter((i) => i.accountId === account.id);
  const cards = byId(state.accounts);
  // Pagamento de fatura não é lançamento, mas é dinheiro que saiu desta conta.
  const payments = state.invoicePayments.filter((p) => p.fromAccountId === account.id && p.date?.slice(0, 7) === ctx.ym);
  const paymentRows = payments.map((p) => ({
    date: p.date,
    html: `<li class="row paid"><span class="check done" title="Pago">${icon('check', 14)}</span><a class="row-body" href="#" data-action="pick" data-id="${esc(p.cardId)}">
      <span class="row-main"><span class="row-title">Fatura ${esc(cards.get(p.cardId)?.name || 'do cartão')}<span class="tag">fatura</span></span><span class="row-sub">referente a ${esc(fmtMonth(p.month))}</span></span>
      <span class="row-side"><strong>− ${esc(money(p.amount))}</strong><small>Pago</small></span></a></li>`,
  }));
  const real = items.filter((i) => i.paid);
  const inflow = sum(real.filter((i) => i.type === 'income'), (i) => i.amount);
  const outflow = sum(real.filter((i) => i.type === 'expense'), (i) => i.amount) + sum(payments, (p) => p.amount);
  const balance = accountBalance(state, account, ctx.today);
  return `
    <section class="card account-detail c-${colorOf(account)}">
      <header class="card-head">
        <div><h2>${esc(account.name)}</h2><p class="muted">${esc(ACCOUNT_TYPES[account.type] || '')}${account.openingDate ? ` · saldo desde ${esc(fmtDate(account.openingDate))}` : ''}</p></div>
        <div class="button-row">${importButton(account)}<button type="button" class="btn small" data-action="edit-account" data-id="${esc(account.id)}">Editar</button></div>
      </header>
      ${queue(ctx, account)}
      <div class="invoice">
        <div><p class="muted">Saldo calculado hoje</p>${balance === null ? '<strong>Data inicial futura</strong>' : bigMoney(balance, balance < 0 ? 'neg' : '')}</div>
      </div>
      <div class="stats">
        <div><small>Entrou em ${esc(fmtMonth(ctx.ym))}</small><strong class="pos">${esc(money(inflow))}</strong></div>
        <div><small>Saiu em ${esc(fmtMonth(ctx.ym))}</small><strong>${esc(money(outflow))}</strong></div>
      </div>
      ${items.length || paymentRows.length ? grouped(ctx, items, look, paymentRows) : empty('Nada neste mês', 'Importe o OFX desta conta ou adicione um lançamento: Pix, débitos e créditos aparecem aqui.')}
    </section>`;
}

// ---------------------------------------------- crediário e financiamento

function creditDetail(ctx, account, look) {
  const { state } = ctx;
  const words = WORDS[account.type] || WORDS.credit;
  const insts = state.installments.filter((i) => i.accountId === account.id);
  const ids = new Set(insts.map((i) => i.id));
  // A parcela paga sai da conta de onde veio o dinheiro (ex.: Inter), mas continua sendo deste crediário.
  const ofThis = (i) => i.accountId === account.id || (i.kind === 'installment' && ids.has(i.refId)) || (i.source?.kind === 'installment' && ids.has(i.source.id));
  const items = monthItems(state, ctx.ym).filter((i) => i.type === 'expense' && ofThis(i));
  const due = sum(items.filter((i) => !i.paid), (i) => i.amount);
  const monthTotal = sum(items, (i) => i.amount);
  const rows = insts.map((inst) => {
    const st = installmentStatus(state, inst);
    const done = st.remaining === 0;
    return `
      <li class="row${done ? ' paid' : ''}"><a class="row-body" href="#/plano">
        <span class="row-main"><span class="row-title">${esc(inst.description)} <span class="tag">${st.paidCount}/${inst.count}</span></span>
        <span class="row-sub">${esc(money(inst.amount))} por mês${st.next ? ` · próxima em ${esc(fmtMonth(st.next.month))}` : ' · quitado'}</span></span>
        <span class="row-side"><strong>${esc(money(st.remainingAmount))}</strong><small>falta</small></span>
      </a>${bar(st.paidCount / inst.count)}</li>`;
  }).join('');
  return `
    <section class="card account-detail c-${colorOf(account)}">
      <header class="card-head">
        <div><h2>${esc(account.name)}</h2><p class="muted">${esc(ACCOUNT_TYPES[account.type])} · ${esc(words.hint)}</p></div>
        <div class="button-row"><button type="button" class="btn small" data-action="new-installment" data-id="${esc(account.id)}">${esc(words.add)}</button><button type="button" class="btn small" data-action="edit-account" data-id="${esc(account.id)}">Editar</button></div>
      </header>
      <div class="stats">
        <div><small>${account.type === 'financing' ? 'Prestação' : 'Parcelas'} de ${esc(fmtMonth(ctx.ym))}</small><strong>${esc(money(monthTotal))}</strong><small class="${due > 0 ? '' : 'pos'}">${monthTotal <= 0 ? 'nada neste mês' : due > 0 ? `${esc(money(due))} em aberto` : 'paga'}</small></div>
        <div><small>Saldo devedor</small><strong>${esc(money(sum(insts, (i) => installmentStatus(state, i).remainingAmount)))}</strong></div>
      </div>
      ${items.length ? `<div><p class="eyebrow">${account.type === 'financing' ? 'Prestação deste mês' : 'Parcelas deste mês'}</p>${grouped(ctx, items, look)}</div>` : ''}
      ${insts.length ? `<div><p class="eyebrow">${esc(words.items)}</p><ul class="rows credit-list">${rows}</ul></div>` : empty(words.item === 'compra' ? 'Nenhuma compra ainda' : 'Nenhum contrato ainda', `Use "${words.add}" para cadastrar valor da parcela, quantidade e primeiro vencimento.`)}
    </section>`;
}

// ------------------------------------------------------------------ tela

export function render(ctx) {
  const accounts = visible(ctx.state);
  if (!accounts.length) {
    return `<section class="card">${empty('Nenhum cartão ou conta', 'Cadastre seus cartões de crédito, a conta do banco e o VA: cada um ganha seu extrato aqui.', '<button type="button" class="btn primary" data-action="new-account">Cadastrar</button>')}</section>`;
  }
  if (!accounts.some((a) => a.id === selected)) selected = (accounts.find(isCard) || accounts[0]).id;
  const look = lookups(ctx.state);
  const account = accounts.find((a) => a.id === selected);
  const group = (title, list, draw, cls) => (list.length ? `<p class="eyebrow">${esc(title)}</p><div class="${cls}" role="group" aria-label="${esc(title)}">${list.map(draw).join('')}</div>` : '');
  const others = accounts.filter((a) => !isPlastic(a));
  const detail = isCard(account) ? cardDetail(ctx, account, look) : isCredit(account) ? creditDetail(ctx, account, look) : accountDetail(ctx, account, look);
  return `
    ${summary(ctx, accounts)}
    <section class="card plastic-strip-card">
      ${sectionHead('Seus cartões e contas', '<button type="button" class="btn small" data-action="new-account">' + icon('plus', 15) + ' Novo</button>')}
      ${group('Cartões de crédito', accounts.filter(isCard), (a) => plastic(ctx, a, look), 'plastic-strip')}
      ${group('Contas e benefícios', accounts.filter((a) => isPlastic(a) && !isCard(a)), (a) => plastic(ctx, a, look), 'plastic-strip')}
      ${group('Carteira, crediários e financiamentos', others, (a) => tile(ctx, a), 'tiles')}
    </section>
    ${detail}`;
}

export function mount(root, ctx) {
  root.querySelectorAll('[data-ofx]').forEach((input) => {
    input.addEventListener('change', (event) => {
      const file = event.target.files[0];
      event.target.value = '';
      if (file) importOfxFile(ctx, file, input.dataset.ofx);
    });
  });
  root.querySelector('.plastic.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

const accountOf = (ctx, el) => ctx.state.accounts.find((a) => a.id === (el.dataset.card || el.dataset.id));

export const actions = {
  pick: (ctx, el) => { selected = el.dataset.id; ctx.rerender(); },
  item: (ctx, el) => { const item = findItem(ctx.state, el); if (item) openItem(ctx, item); },
  pay: (ctx, el) => { const item = findItem(ctx.state, el); if (item) payItem(ctx, item); },
  review: (ctx, el) => { const row = ctx.state.ofxPending.find((r) => r.id === el.dataset.id); if (row) reviewOfx(ctx, row); },
  'new-account': () => openAccountForm(null, 'card'),
  'edit-account': (ctx, el) => openAccountForm(accountOf(ctx, el)),
  'new-installment': (ctx, el) => openInstallmentForm(ctx, null, { accountId: el.dataset.id }),
  'pay-invoice': (ctx, el) => { const card = accountOf(ctx, el); payInvoice(ctx, card, cardInvoice(ctx.state, card, ctx.ym)); },
  'unpay-invoice': (ctx, el) => { const card = accountOf(ctx, el); undoInvoicePayment(card, cardInvoice(ctx.state, card, ctx.ym)); },
};

/** Para o lançamento rápido: a conta escolhida nesta aba. */
export const selectedAccount = () => selected;
