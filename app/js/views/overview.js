// Visão geral: quanto sobra no mês, o que vence, a divisão da casa, cartões,
// orçamento e os próximos meses.

import { openItem, payItem, receiveLoan } from '../actions.js';
import { cardInvoice, dailyAllowance, expensesByCategory, houseSplit, isCard, isOverdue, leftover, monthItems, openLoans, projection, splitShares } from '../model.js';
import { bar } from '../ui.js';
import { byId, esc, fmtDate, fmtDay, fmtMonth, fmtMonthShort, money, percent, sum } from '../util.js';

// Dia de vencimento escolhido em "Contas a pagar" ('' = todas).
let dueFilter = '';
import { bigMoney, empty, findItem, itemRow, lookups, personDot, sectionHead } from './shared.js';

function hero(ctx, items) {
  const { state } = ctx;
  const person = state.people.find((p) => p.id === ctx.viewPerson) || null;
  const lo = leftover(state, ctx.ym, person?.id || null, items);
  const spent = lo.house + lo.personal;
  const base = Math.max(lo.income, spent, 0.01);
  const seg = (value, cls) => (value > 0 ? `<i class="${cls}" style="width:${((value / base) * 100).toFixed(2)}%"></i>` : '');
  const rate = lo.income > 0 ? lo.left / lo.income : 0;
  const note = lo.income <= 0
    ? 'Nenhuma receita prevista neste mês.'
    : lo.left >= 0 ? `${percent(rate)} da renda fica livre depois de todas as contas.` : `As contas passam da renda em ${money(-lo.left)}.`;
  const toggle = state.people.length > 1 ? `
    <div class="segmented compact" role="group" aria-label="Ver por pessoa">
      <button type="button" data-action="view" data-person="" class="${person ? '' : 'on'}">Casal</button>
      ${state.people.map((p) => `<button type="button" data-action="view" data-person="${esc(p.id)}" class="${person?.id === p.id ? 'on' : ''}">${esc(p.name)}</button>`).join('')}
    </div>` : '';
  const daily = dailyAllowance(lo.left, ctx.today, ctx.ym);
  const dailyLine = daily
    ? `<p class="daily">Dá para gastar até <strong>${esc(money(daily.perDay))} por dia</strong> ${daily.days === 1 ? 'hoje, último dia do mês' : `nos ${daily.days} dias que faltam`}, sem mexer no que já está reservado para as contas.</p>`
    : '';
  const legend = (cls, label, value, share) => `<div class="legend-item"><span><i class="swatch ${cls}"></i>${esc(label)}</span><strong>${esc(money(value))}</strong><small>${share}</small></div>`;
  return `
    <section class="card hero">
      <header class="card-head"><h2>${person ? `Sobra de ${esc(person.name)}` : 'Sobra prevista do mês'}</h2>${toggle}</header>
      <div class="hero-figure">${bigMoney(lo.left, lo.left < 0 ? 'neg' : '')}<p class="${lo.left < 0 ? 'neg' : 'muted'}">${esc(note)}</p>${dailyLine}</div>
      <div class="stack" role="img" aria-label="Divisão da renda entre contas da casa, gastos pessoais e sobra">
        ${seg(lo.house, 'house')}${seg(lo.personal, 'personal')}${seg(Math.max(0, lo.left), 'left')}
      </div>
      <div class="legend">
        ${legend('income', 'Renda', lo.income, '')}
        ${legend('house', person ? 'Sua parte da casa' : 'Contas da casa', lo.house, lo.income > 0 ? percent(lo.house / lo.income) : '')}
        ${legend('personal', 'Gastos pessoais', lo.personal, lo.income > 0 ? percent(lo.personal / lo.income) : '')}
        ${legend('left', lo.left >= 0 ? 'Sobra' : 'Falta', Math.abs(lo.left), lo.income > 0 ? percent(Math.abs(rate)) : '')}
      </div>
    </section>`;
}

function pending(ctx, items, look) {
  const open = items.filter((i) => i.type === 'expense' && !i.paid && !i.onCard);
  const overdue = open.filter((i) => isOverdue(i, ctx.today));
  const total = sum(open, (i) => i.amount);
  const aside = open.length ? `<span class="muted">${open.length} em aberto · ${esc(money(total))}</span>` : '';
  const alert = overdue.length ? `<p class="notice neg">${overdue.length === 1 ? '1 conta atrasada' : `${overdue.length} contas atrasadas`}, somando ${esc(money(sum(overdue, (i) => i.amount)))}.</p>` : '';
  const dates = [...new Set(open.map((i) => i.date))];
  if (!dates.includes(dueFilter)) dueFilter = '';
  const shown = dueFilter ? open.filter((i) => i.date === dueFilter) : open.slice(0, 6);
  const chip = (value, top, bottom, late) => `<button type="button" class="chip${dueFilter === value ? ' on' : ''}${late ? ' late' : ''}" data-action="due" data-date="${value}"><strong>${esc(top)}</strong><small>${esc(bottom)}</small></button>`;
  const chips = dates.length > 1
    ? `<div class="chips" role="group" aria-label="Filtrar por dia de vencimento">${chip('', 'Todas', `${open.length} contas`, false)}${dates.map((d) => {
      const ofDay = open.filter((i) => i.date === d);
      return chip(d, fmtDay(d), money(sum(ofDay, (i) => i.amount)), d < ctx.today);
    }).join('')}</div>`
    : '';
  const list = shown.map((i) => itemRow(ctx, i, look, { showDate: !dueFilter })).join('');
  return `
    <section class="card">
      ${sectionHead('Contas a pagar', aside)}
      ${alert}
      ${chips}
      ${open.length ? `<ul class="rows">${list}</ul>` : empty('Tudo pago', 'Nenhuma conta em aberto neste mês.')}
      ${!dueFilter && open.length > 6 ? `<a class="more-link" href="#/lancamentos">Ver as ${open.length} contas</a>` : ''}
    </section>`;
}

function house(ctx, items) {
  const { state } = ctx;
  const split = houseSplit(state, ctx.ym, items);
  if (!split.bills.length) {
    return `<section class="card">${sectionHead('Divisão da casa')}${empty('Sem contas da casa', 'Marque uma despesa como "Da casa" para ela entrar na divisão.')}</section>`;
  }
  const people = byId(state.people);
  const rows = split.people.map((p) => `
    <div class="split-row">
      <span>${personDot(p.person)}${esc(p.person.name)} <small class="muted">${percent(p.share)}</small></span>
      <span class="split-values"><small>parte</small><strong>${esc(money(p.planned))}</strong></span>
      <span class="split-values"><small>já pagou</small><strong>${esc(money(p.paid))}</strong></span>
    </div>`).join('');
  const transfers = split.transfers.length
    ? split.transfers.map((t) => `<p class="notice">${esc(people.get(t.from).name)} deve ${esc(money(t.amount))} a ${esc(people.get(t.to).name)} pelas contas já pagas.</p>`).join('')
    : '<p class="notice ok">Vocês estão quites nas contas já pagas.</p>';
  return `
    <section class="card">
      ${sectionHead('Divisão da casa', `<strong>${esc(money(split.total))}</strong>`)}
      <div class="split">${rows}</div>
      ${transfers}
      <a class="more-link" href="#/casa">Ver contas da casa</a>
    </section>`;
}

function receivables(ctx) {
  const loans = openLoans(ctx.state);
  if (!loans.length) return '';
  const total = sum(loans, (l) => l.outstanding);
  const rows = loans.map(({ entry, returned, outstanding }) => `
    <li class="row">
      <span class="row-body static">
        <span class="row-main">
          <span class="row-title">${esc(entry.loan.to)}</span>
          <span class="row-sub">${esc(entry.description)} · ${esc(fmtDate(entry.date))}${returned > 0 ? ` · já devolveu ${esc(money(returned))}` : ''}</span>
        </span>
        <span class="row-side"><strong class="pos">${esc(money(outstanding))}</strong></span>
      </span>
      <button type="button" class="btn small" data-action="receive" data-id="${esc(entry.id)}">Recebi</button>
    </li>`).join('');
  return `
    <section class="card">
      ${sectionHead('A receber de outras pessoas', `<strong class="pos">${esc(money(total))}</strong>`)}
      <p class="muted">Dinheiro que vocês emprestaram. Não conta como gasto nem entra na sobra até voltar.</p>
      <ul class="rows">${rows}</ul>
    </section>`;
}

function cards(ctx) {
  const { state } = ctx;
  const list = state.accounts.filter((a) => isCard(a) && !a.archived);
  if (!list.length) return '';
  const rows = list.map((card) => {
    const inv = cardInvoice(state, card, ctx.ym);
    const status = inv.total <= 0 ? 'sem compras' : inv.paid ? 'paga' : inv.dueDate ? `vence ${fmtDay(inv.dueDate)}` : 'em aberto';
    return `<a class="line" href="#/cartoes"><span><strong>${esc(card.name)}</strong><small class="${inv.paid ? 'pos' : 'muted'}">${esc(status)}</small></span><strong>${esc(money(inv.total))}</strong></a>`;
  }).join('');
  return `<section class="card">${sectionHead('Faturas de ' + fmtMonth(ctx.ym).split(' ')[0])}<div class="lines">${rows}</div></section>`;
}

function budget(ctx, items) {
  const totals = expensesByCategory(ctx.state, items);
  if (!totals.length) return `<section class="card">${sectionHead('Gastos por categoria')}${empty('Nada por aqui', 'Ainda não há despesas neste mês.')}</section>`;
  const max = Math.max(...totals.map((t) => t.total));
  const rows = totals.map(({ category, total }) => {
    const hasBudget = category.budget > 0;
    const over = hasBudget && total > category.budget;
    const detail = hasBudget ? (over ? `passou ${money(total - category.budget)} do limite` : `de ${money(category.budget)}`) : '';
    return `
      <div class="budget-row">
        <span class="budget-name">${esc(category.name)}</span>
        <span class="budget-value"><strong class="${over ? 'neg' : ''}">${esc(money(total))}</strong> <small class="${over ? 'neg' : 'muted'}">${esc(detail)}</small></span>
        ${bar(hasBudget ? total / category.budget : total / max, { tone: over ? 'over' : hasBudget ? '' : 'plain' })}
      </div>`;
  }).join('');
  return `<section class="card">${sectionHead('Gastos por categoria', '<a class="muted" href="#/ajustes">definir limites</a>')}<div class="budget">${rows}</div></section>`;
}

function forecast(ctx) {
  const rows = projection(ctx.state, ctx.currentYm, 12, ctx.currentYm);
  const max = Math.max(...rows.map((r) => Math.abs(r.balance)), 1);
  const firstNegative = rows.find((r) => r.accumulated < 0);
  const cols = rows.map((r) => {
    const h = Math.max(2, (Math.abs(r.balance) / max) * 100);
    return `
      <a class="col${r.month === ctx.ym ? ' current' : ''}" href="#" data-action="month" data-ym="${r.month}" title="${esc(fmtMonth(r.month))}: sobra de ${esc(money(r.balance))}, acumulado ${esc(money(r.accumulated))}">
        <span class="col-up">${r.balance >= 0 ? `<i style="height:${h}%"></i>` : ''}</span>
        <span class="col-down">${r.balance < 0 ? `<i style="height:${h}%"></i>` : ''}</span>
        <small>${esc(fmtMonthShort(r.month).split('/')[0])}</small>
      </a>`;
  }).join('');
  const last = rows[rows.length - 1];
  const note = firstNegative
    ? `<p class="notice neg">Mantendo o ritmo atual, o saldo acumulado fica negativo em ${esc(fmtMonth(firstNegative.month))}.</p>`
    : `<p class="notice ok">Em 12 meses, o saldo acumulado previsto é de ${esc(money(last.accumulated))}.</p>`;
  return `
    <section class="card wide">
      ${sectionHead('Sobra prevista nos próximos 12 meses', '<a class="muted" href="#/plano">ver projeção</a>')}
      <div class="chart" role="img" aria-label="Sobra prevista por mês">${cols}</div>
      ${note}
    </section>`;
}

export function render(ctx) {
  const items = monthItems(ctx.state, ctx.ym);
  const look = lookups(ctx.state);
  look.shares = ctx.state.people.length > 1 ? splitShares(ctx.state, items) : null;
  return `
    ${hero(ctx, items)}
    <div class="grid">
      ${pending(ctx, items, look)}
      ${house(ctx, items)}
      ${receivables(ctx)}
      ${cards(ctx)}
      ${budget(ctx, items)}
      ${forecast(ctx)}
    </div>`;
}

export const actions = {
  pay: (ctx, el) => { const item = findItem(ctx.state, el); if (item) payItem(ctx, item); },
  item: (ctx, el) => { const item = findItem(ctx.state, el); if (item) openItem(ctx, item); },
  view: (ctx, el) => ctx.setViewPerson(el.dataset.person || null),
  due: (ctx, el) => { dueFilter = el.dataset.date; ctx.rerender(); },
  receive: (ctx, el) => { const entry = ctx.state.entries.find((e) => e.id === el.dataset.id); if (entry) receiveLoan(ctx, entry); },
};
