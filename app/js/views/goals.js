// Metas (o que vocês estão juntando) e dívidas (o que falta quitar).

import { contributeGoal, openDebtForm, openGoalForm, payDebt } from '../actions.js';
import { debtBalance, goalPlan } from '../model.js';
import { bar } from '../ui.js';
import { esc, fmtMonthShort, money, percent, round2, sum, ymOf } from '../util.js';
import { empty } from './shared.js';

function goalsSection(ctx) {
  const { state } = ctx;
  const rows = state.goals.map((goal) => {
    const plan = goalPlan(state, goal, ctx.currentYm);
    const done = plan.missing <= 0;
    const tip = done ? 'Meta alcançada'
      : plan.late ? `prazo passou em ${fmtMonthShort(ymOf(goal.deadline))}`
        : goal.deadline ? `guardar ${money(plan.perMonth)} por mês até ${fmtMonthShort(ymOf(goal.deadline))}` : 'sem prazo';
    return `
      <li class="row${done ? ' paid' : ''}">
        <button type="button" class="row-body" data-action="goal" data-id="${esc(goal.id)}">
          <span class="row-main"><span class="row-title">${esc(goal.name)}</span>
          <span class="row-sub ${plan.late ? 'neg' : ''}">${percent(plan.progress)} · ${esc(tip)}</span>${bar(plan.progress)}</span>
          <span class="row-side"><strong>${esc(money(plan.saved))}</strong><small>de ${esc(money(goal.target))}</small></span>
        </button>
        ${done ? '' : `<button type="button" class="btn small" data-action="contribute" data-id="${esc(goal.id)}">Guardar</button>`}
      </li>`;
  }).join('');
  const perMonth = sum(state.goals, (g) => goalPlan(state, g, ctx.currentYm).perMonth);
  return `
    <section class="card">
      <header class="card-head"><h2>Metas</h2><button type="button" class="btn small primary" data-action="new-goal">Nova meta</button></header>
      ${state.goals.length ? `${perMonth > 0 ? `<p class="muted">Para cumprir todos os prazos: <strong>${esc(money(perMonth))}</strong> por mês.</p>` : ''}<ul class="rows">${rows}</ul>` : empty('Nenhuma meta', 'Crie uma meta com valor e prazo: o app diz quanto guardar por mês.')}
    </section>`;
}

function debtsSection(ctx) {
  const { state } = ctx;
  const rows = state.debts.map((debt) => {
    const balance = debtBalance(state, debt);
    const paid = round2(debt.initial - balance);
    const done = balance <= 0;
    const notes = [
      paid > 0 ? `${money(paid)} já pagos` : 'nenhum pagamento ainda',
      debt.payment > 0 && !done ? `parcela de ${money(debt.payment)}` : '',
      debt.rate > 0 ? `${String(debt.rate).replace('.', ',')}% ao mês` : '',
    ].filter(Boolean).join(' · ');
    return `
      <li class="row${done ? ' paid' : ''}">
        <button type="button" class="row-body" data-action="debt" data-id="${esc(debt.id)}">
          <span class="row-main"><span class="row-title">${esc(debt.name)}</span><span class="row-sub">${esc(notes)}</span>${bar(debt.initial > 0 ? paid / debt.initial : 0)}</span>
          <span class="row-side"><strong>${done ? 'Quitada' : esc(money(balance))}</strong><small>${done ? '' : 'saldo devedor'}</small></span>
        </button>
        ${done ? '' : `<button type="button" class="btn small" data-action="pay-debt" data-id="${esc(debt.id)}">Pagar</button>`}
      </li>`;
  }).join('');
  const total = sum(state.debts, (d) => debtBalance(state, d));
  return `
    <section class="card">
      <header class="card-head"><h2>Dívidas</h2><button type="button" class="btn small primary" data-action="new-debt">Nova dívida</button></header>
      ${state.debts.length ? `<p class="muted">Total devido: <strong>${esc(money(total))}</strong>.</p><ul class="rows">${rows}</ul>` : empty('Nenhuma dívida', 'Cadastre empréstimos e saldos devedores para acompanhar a quitação.')}
    </section>`;
}

export function render(ctx) {
  return `<div class="grid">${goalsSection(ctx)}${debtsSection(ctx)}</div>`;
}

const find = (list, el) => list.find((x) => x.id === el.dataset.id);

export const actions = {
  'new-goal': (ctx) => openGoalForm(ctx),
  goal: (ctx, el) => openGoalForm(ctx, find(ctx.state.goals, el)),
  contribute: (ctx, el) => contributeGoal(ctx, find(ctx.state.goals, el)),
  'new-debt': (ctx) => openDebtForm(ctx),
  debt: (ctx, el) => openDebtForm(ctx, find(ctx.state.debts, el)),
  'pay-debt': (ctx, el) => payDebt(ctx, find(ctx.state.debts, el)),
};
