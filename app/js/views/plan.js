// Planejamento: o que se repete (recorrentes), o que está parcelado e a projeção dos próximos meses.

import { openInstallmentDetail, openInstallmentForm, openRecurringForm } from '../actions.js';
import { installmentStatus, projection, recurringConfig } from '../model.js';
import { bar } from '../ui.js';
import { esc, fmtMonth, fmtMonthShort, money, sum } from '../util.js';
import { empty, lookups, personDot } from './shared.js';

function recurringSection(ctx, look) {
  const { state } = ctx;
  const row = (r) => {
    const cfg = recurringConfig(r, ctx.ym);
    const person = look.people.get(cfg.personId);
    const ended = r.end && r.end < ctx.ym;
    const notes = [
      `dia ${cfg.day}`,
      look.accounts.get(cfg.accountId)?.name,
      r.end ? `até ${fmtMonthShort(r.end)}` : '',
      (r.changes || []).length ? 'com reajuste' : '',
    ].filter(Boolean).join(' · ');
    return `
      <li class="row${!r.active || ended ? ' paid' : ''}">
        <button type="button" class="row-body" data-action="recurring" data-id="${esc(r.id)}">
          <span class="row-main"><span class="row-title">${esc(cfg.description)}${cfg.scope === 'house' && cfg.type === 'expense' ? '<span class="tag house">casa</span>' : ''}${!r.active ? '<span class="tag">pausado</span>' : ended ? '<span class="tag">encerrado</span>' : ''}</span>
          <span class="row-sub">${personDot(person)}${esc(person ? person.name : 'Casal')} · ${esc(notes)}</span></span>
          <span class="row-side"><strong class="${cfg.type === 'income' ? 'pos' : ''}">${cfg.amount > 0 ? `${cfg.type === 'income' ? '+' : '−'} ${esc(money(cfg.amount))}` : 'variável'}</strong><small>por mês</small></span>
        </button>
      </li>`;
  };
  const live = state.recurring.filter((r) => r.active);
  const configs = live.map((r) => recurringConfig(r, ctx.ym));
  const income = sum(configs.filter((c) => c.type === 'income'), (c) => c.amount);
  const expense = sum(configs.filter((c) => c.type === 'expense'), (c) => c.amount);
  const sorted = [...state.recurring].sort((a, b) => Number(b.active) - Number(a.active) || (a.type === b.type ? a.day - b.day : a.type === 'income' ? -1 : 1));
  return `
    <section class="card">
      <header class="card-head"><h2>Recorrentes</h2><button type="button" class="btn small primary" data-action="new-recurring">Novo recorrente</button></header>
      <p class="muted">Fixos por mês: <strong class="pos">${esc(money(income))}</strong> de receita e <strong>${esc(money(expense))}</strong> de despesa.</p>
      ${sorted.length ? `<ul class="rows">${sorted.map(row).join('')}</ul>` : empty('Nenhum recorrente', 'Cadastre salário, aluguel, internet e assinaturas uma vez: eles aparecem sozinhos em todo mês.')}
    </section>`;
}

function installmentSection(ctx, look) {
  const { state } = ctx;
  const rows = state.installments.map((inst) => {
    const st = installmentStatus(state, inst);
    const done = st.remaining === 0;
    return `
      <li class="row${done ? ' paid' : ''}">
        <button type="button" class="row-body" data-action="installment" data-id="${esc(inst.id)}">
          <span class="row-main"><span class="row-title">${esc(inst.description)}${inst.scope === 'house' ? '<span class="tag house">casa</span>' : ''}</span>
          <span class="row-sub">${st.paidCount} de ${inst.count} pagas · ${esc(money(inst.amount))} por mês · ${esc(look.accounts.get(inst.accountId)?.name || '')}${st.next ? ` · próxima em ${esc(fmtMonthShort(st.next.month))}` : ''}</span>
          ${bar(st.paidCount / inst.count)}</span>
          <span class="row-side"><strong>${done ? 'Quitado' : esc(money(st.remainingAmount))}</strong><small>${done ? '' : 'falta pagar'}</small></span>
        </button>
      </li>`;
  }).join('');
  const total = sum(state.installments, (inst) => installmentStatus(state, inst).remainingAmount);
  return `
    <section class="card">
      <header class="card-head"><h2>Parcelamentos</h2><button type="button" class="btn small primary" data-action="new-installment">Novo parcelamento</button></header>
      ${state.installments.length ? `<p class="muted">Total ainda a pagar: <strong>${esc(money(total))}</strong>.</p><ul class="rows">${rows}</ul>` : empty('Nenhum parcelamento', 'Cadastre a compra parcelada uma vez: cada parcela cai no mês certo.')}
    </section>`;
}

function projectionSection(ctx) {
  const rows = projection(ctx.state, ctx.currentYm, 24, ctx.currentYm);
  const body = rows.map((r) => `
    <tr class="${r.month === ctx.ym ? 'current' : ''}">
      <td><a href="#" data-action="month" data-ym="${r.month}">${esc(fmtMonth(r.month))}</a></td>
      <td class="num pos">${esc(money(r.income))}</td>
      <td class="num">${esc(money(r.expense))}${r.estimated > 0 ? '<sup title="Inclui gasto variável estimado">*</sup>' : ''}</td>
      <td class="num ${r.balance < 0 ? 'neg' : ''}">${esc(money(r.balance))}</td>
      <td class="num ${r.accumulated < 0 ? 'neg' : ''}"><strong>${esc(money(r.accumulated))}</strong></td>
    </tr>`).join('');
  return `
    <section class="card wide">
      <header class="card-head"><h2>Projeção de 24 meses</h2></header>
      <p class="muted">Soma lançamentos, recorrentes e parcelas. O acumulado parte de zero no mês atual. <span>* inclui o gasto variável estimado das categorias.</span></p>
      <div class="table-scroll"><table class="table"><thead><tr><th>Mês</th><th class="num">Entradas</th><th class="num">Saídas</th><th class="num">Sobra</th><th class="num">Acumulado</th></tr></thead><tbody>${body}</tbody></table></div>
    </section>`;
}

export function render(ctx) {
  const look = lookups(ctx.state);
  return `<div class="grid">${recurringSection(ctx, look)}${installmentSection(ctx, look)}${projectionSection(ctx)}</div>`;
}

export const actions = {
  'new-recurring': (ctx) => openRecurringForm(ctx),
  recurring: (ctx, el) => openRecurringForm(ctx, ctx.state.recurring.find((r) => r.id === el.dataset.id)),
  'new-installment': (ctx) => openInstallmentForm(ctx),
  installment: (ctx, el) => openInstallmentDetail(ctx, ctx.state.installments.find((p) => p.id === el.dataset.id)),
};
