// Visão geral: quanto sobra no mês, o que vence, a divisão da casa, cartões,
// orçamento e os próximos meses.

import { exportBackup, openAccountForm, openBalanceSetup, openItem, payItem, receiveLoan } from '../actions.js';
import { accountBalance, accountsNeedingBalance, cardInvoice, dailyAllowance, expensesByCategory, houseSplit, isCard, isMoneyAccount, isOverdue, leftover, monthItems, openLoans, projection, splitShares, budgetStatus } from '../model.js';
import { bar, icon } from '../ui.js';
import { daySeed, funLine } from '../fun.js';
import { byId, diffDays, esc, fmtDate, fmtDay, fmtMonth, fmtMonthShort, money, percent, sum } from '../util.js';
import { getMode } from '../store.js';
import { bigMoney, empty, findItem, itemRow, lookups, personDot, sectionHead } from './shared.js';

// Dia de vencimento escolhido em "Contas a pagar" ('' = todas).
let dueFilter = '';
// Quantas vezes "outra" foi apertado (soma ao sorteio do dia).
let funOffset = 0;

function balances(ctx) {
  const accounts = ctx.state.accounts.filter(isMoneyAccount);
  if (!accounts.length) return `<section class="card">${sectionHead('Saldo calculado das contas')}${empty('Cadastre sua conta', 'Informe o saldo inicial para acompanhar o que entrou e saiu, sem conectar ao banco.', '<button type="button" class="btn primary" data-action="new-account">Cadastrar conta</button>')}</section>`;
  const unset = accountsNeedingBalance(ctx.state);
  if (unset.length) {
    return `<section class="card balance-card">${sectionHead('Saldo das contas')}
      <p class="notice">Informe quanto tem hoje em cada conta para ver o saldo real. Sem isso, o total não bate com o banco.</p>
      <div class="button-row">${unset.map((a) => `<button type="button" class="btn small primary" data-action="balance" data-id="${esc(a.id)}">Informar saldo de ${esc(a.name)}</button>`).join('')}</div></section>`;
  }
  const rows = accounts.map((account) => ({ account, balance: accountBalance(ctx.state, account, ctx.today) }));
  const total = sum(rows, (row) => row.balance);
  const partial = rows.some((row) => row.balance === null);
  const list = rows.map(({ account, balance }) => `<li class="row"><button type="button" class="row-body" data-action="account" data-id="${esc(account.id)}"><span class="row-main"><span class="row-title">${esc(account.name)}${account.archived ? ' <span class="tag">arquivada</span>' : ''}</span><span class="row-sub">${account.openingDate ? `Desde o início de ${esc(fmtDate(account.openingDate))}` : 'Saldo inicial sem data · histórico completo'}</span></span><span class="row-side">${balance === null ? '<small>Data inicial futura</small>' : `<strong class="${balance < 0 ? 'neg' : ''}">${esc(money(balance))}</strong>`}</span></button></li>`).join('');
  return `<section class="card balance-card">
    ${sectionHead(partial ? 'Saldo parcial das contas' : 'Saldo calculado das contas', `<span class="muted">Hoje · ${esc(fmtDate(ctx.today))}</span>`)}
    ${bigMoney(total, total < 0 ? 'neg' : '')}
    ${partial ? '<p class="notice">Há conta com saldo inicial em data futura. Ela não está incluída no total; confira a data no cadastro.</p>' : ''}
    <p class="muted">Total da casa conforme os lançamentos até hoje.</p>
    <ul class="rows">${list}</ul>
    <details class="hint"><summary>Como este saldo é calculado</summary>
      <p>Bancos e dinheiro de toda a casa, conforme os pagamentos e recebimentos registrados até hoje. Independente do mês ou pessoa selecionados; não é o valor livre para gastar.</p>
      <p>Não sincronizado com o banco. Confira o saldo inicial e os lançamentos. Aportes em metas são tratados como saídas; acertos da casa só alteram este saldo quando a movimentação é lançada na conta.</p>
    </details>
    <a class="more-link" href="#/ajustes">Gerenciar contas e saldos iniciais</a>
  </section>`;
}

/** Lembrete de backup: os dados na nuvem não protegem de perder o projeto. Só no modo nuvem. */
function backupNotice(ctx) {
  if (getMode() !== 'cloud') return '';
  let last = null;
  let snooze = null;
  try {
    last = localStorage.getItem('monetizeo:lastBackup');
    snooze = localStorage.getItem('monetizeo:backupSnooze');
  } catch { /* sem armazenamento */ }
  const days = last ? diffDays(last, ctx.today) : null;
  if (days !== null && days < 30) return '';
  if (snooze && diffDays(snooze, ctx.today) < 7) return '';
  const what = days === null ? 'Você ainda não baixou um backup neste aparelho.' : `Faz ${days} dias que você não baixa um backup.`;
  return `<section class="notice action"><span>${esc(what)} Os dados ficam na nuvem, mas uma cópia no seu aparelho é a única proteção se o projeto for perdido.</span>
    <span class="button-row"><button type="button" class="btn small" data-action="snooze-backup">Depois</button><button type="button" class="btn small primary" data-action="backup">Baixar agora</button></span></section>`;
}

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
  const isNow = ctx.ym === ctx.currentYm;
  const fun = isNow ? funLine(daily?.perDay ?? null, daySeed(ctx.today) + funOffset) : '';
  const dailyLine = isNow ? `
    <div class="daily">
      <p class="fun"><span>${esc(fun)}</span><button type="button" class="icon-btn small" data-action="fun-next" title="Outra" aria-label="Outra frase">${icon('refresh', 15)}</button></p>
    </div>` : '';
  const legend = (cls, label, value, share) => `<div class="legend-item"><span><i class="swatch ${cls}"></i>${esc(label)}</span><strong>${esc(money(value))}</strong><small>${share}</small></div>`;
  return `
    <section class="card hero">
      <header class="card-head"><h2>${person ? `Sobra prevista de ${esc(person.name)}` : 'Sobra prevista do mês'}</h2>${toggle}</header>
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

const DONUT_SLICES = 6; // cores validadas para 6 categorias; o resto vira "Outras"
const DONUT_GAP = 0.8; // respiro entre as fatias, em % da volta

/** Rosca dos gastos do mês: as maiores categorias, com o total no centro. */
function donut(slices, total) {
  let offset = 0;
  const arcs = slices.map((slice) => {
    const share = (slice.total / total) * 100;
    const length = Math.max(share - DONUT_GAP, 0.4);
    const arc = `<circle class="seg" cx="60" cy="60" r="48" pathLength="100" style="stroke:${slice.color};stroke-dasharray:${length.toFixed(2)} ${(100 - length).toFixed(2)};stroke-dashoffset:${(-offset).toFixed(2)}"><title>${esc(slice.name)}: ${esc(money(slice.total))} (${percent(slice.total / total)})</title></circle>`;
    offset += share;
    return arc;
  }).join('');
  const label = `Gastos por categoria: ${slices.map((x) => `${x.name} ${percent(x.total / total)}`).join(', ')}`;
  return `
    <div class="donut">
      <svg viewBox="0 0 120 120" role="img" aria-label="${esc(label)}"><g transform="rotate(-90 60 60)">${arcs}</g></svg>
      <div class="donut-center"><small>Gasto no mês</small><strong>${esc(money(total))}</strong></div>
    </div>`;
}

function budget(ctx, items) {
  const totals = expensesByCategory(ctx.state, items);
  if (!totals.length) return `<section class="card">${sectionHead('Gastos por categoria')}${empty('Nada por aqui', 'Ainda não há despesas neste mês.')}</section>`;
  const total = sum(totals, (t) => t.total);

  // A cor acompanha a ordem do cadastro, não a posição no ranking do mês.
  const order = new Map(ctx.state.categories.map((c, i) => [c.id, i]));
  const top = totals.slice(0, DONUT_SLICES);
  const slot = new Map([...top].sort((a, b) => (order.get(a.category.id) ?? 99) - (order.get(b.category.id) ?? 99)).map((t, i) => [t.category.id, i + 1]));
  const colorOf = (id) => (slot.has(id) ? `var(--cat-${slot.get(id)})` : 'var(--cat-other)');
  const rest = totals.slice(DONUT_SLICES);
  const slices = top.map((t) => ({ name: t.category.name, total: t.total, color: colorOf(t.category.id) }));
  if (rest.length) slices.push({ name: `Outras (${rest.length})`, total: sum(rest, (t) => t.total), color: 'var(--cat-other)' });

  const reds = [];
  const rows = totals.map(({ category, total: spent }) => {
    const st = budgetStatus(category, spent);
    if (st.state === 'red') reds.push({ category, st });
    const detail = {
      none: '',
      ok: `de ${money(st.limit)}${st.margin > 0 ? ` (+${money(st.margin)} sobre-teto)` : ''}`,
      margin: `usando ${money(st.marginUsed)} de ${money(st.margin)} do sobre-teto`,
      red: st.margin > 0 ? `estourou o sobre-teto em ${money(st.overCeiling)}` : `passou ${money(st.overLimit)} do limite`,
    }[st.state];
    const tone = { margin: 'warn', red: 'neg' }[st.state] || '';
    return `
      <div class="budget-row">
        <span class="budget-name"><i class="swatch" style="background:${colorOf(category.id)}"></i>${esc(category.name)} <small class="muted">${percent(spent / total)}</small></span>
        <span class="budget-value"><strong class="${tone}">${esc(money(spent))}</strong> <small class="${tone || 'muted'}">${esc(detail)}</small></span>
        ${st.state !== 'none' ? bar(spent / st.limit, { tone: { margin: 'warn', red: 'over' }[st.state] || '' }) : ''}
      </div>`;
  }).join('');
  const alert = reds.length
    ? `<p class="notice neg">No vermelho: ${esc(reds.map(({ category, st }) => `${category.name} (${money(st.overCeiling)} acima ${st.margin > 0 ? 'do sobre-teto' : 'do limite'})`).join(', '))}. Reduza os próximos gastos ou compense cortando em outra categoria.</p>`
    : '';
  return `<section class="card">${sectionHead('Gastos por categoria', '<a class="muted" href="#/ajustes">definir limites</a>')}${alert}${total > 0 ? donut(slices, total) : ''}<div class="budget">${rows}</div></section>`;
}

function forecast(ctx) {
  const rows = projection(ctx.state, ctx.currentYm, 12);
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
    ${backupNotice(ctx)}
    ${balances(ctx)}
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
  'fun-next': (ctx) => { funOffset++; ctx.rerender(); },
  'new-account': () => openAccountForm(),
  balance: (ctx, el) => { const account = ctx.state.accounts.find((a) => a.id === el.dataset.id); if (account) openBalanceSetup(ctx, account); },
  backup: (ctx) => { exportBackup(); ctx.rerender(); },
  'snooze-backup': (ctx) => { try { localStorage.setItem('monetizeo:backupSnooze', ctx.today); } catch { /* ok */ } ctx.rerender(); },
  account: (ctx, el) => openAccountForm(ctx.state.accounts.find((a) => a.id === el.dataset.id)),
  pay: (ctx, el) => { const item = findItem(ctx.state, el); if (item) payItem(ctx, item); },
  item: (ctx, el) => { const item = findItem(ctx.state, el); if (item) openItem(ctx, item); },
  view: (ctx, el) => ctx.setViewPerson(el.dataset.person || null),
  due: (ctx, el) => { dueFilter = el.dataset.date; ctx.rerender(); },
  receive: (ctx, el) => { const entry = ctx.state.entries.find((e) => e.id === el.dataset.id); if (entry) receiveLoan(ctx, entry); },
};
