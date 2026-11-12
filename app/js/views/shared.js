// Pedaços de tela usados por mais de uma visão.

import { isOverdue, monthItems } from '../model.js';
import { icon } from '../ui.js';
import { byId, diffDays, esc, fmtDay, money, moneyParts } from '../util.js';

export function lookups(state) {
  return { people: byId(state.people), accounts: byId(state.accounts), categories: byId(state.categories) };
}

export function personDot(person, title) {
  if (!person) return `<span class="dot joint" title="${esc(title || 'Casal')}"></span>`;
  return `<span class="dot" style="--c:${esc(person.color || '#888')}" title="${esc(title || person.name)}"></span>`;
}

/** Número grande com os centavos menores, como em "R$ 5.304,28". */
export function bigMoneyInner(value) {
  const { sign, whole, cents } = moneyParts(value);
  return `<small>R$</small>${sign}${esc(whole)}<small>,${esc(cents)}</small>`;
}

export function bigMoney(value, className = '') {
  return `<span class="big ${className}" data-count="${Number(value) || 0}">${bigMoneyInner(value)}</span>`;
}

export function dueLabel(item, today) {
  if (item.paid) return item.type === 'income' ? 'Recebido' : 'Pago';
  if (item.onCard) return 'Na fatura';
  const days = diffDays(today, item.date);
  if (item.type === 'income') return days < 0 ? 'Previsto' : days === 0 ? 'Previsto para hoje' : `Previsto para ${fmtDay(item.date)}`;
  if (days < 0) return days === -1 ? 'Atrasada há 1 dia' : `Atrasada há ${-days} dias`;
  if (days === 0) return 'Vence hoje';
  if (days === 1) return 'Vence amanhã';
  return days <= 7 ? `Vence em ${days} dias` : `Vence ${fmtDay(item.date)}`;
}

/**
 * Linha de um item do mês. O círculo à esquerda confirma o pagamento;
 * o resto da linha abre o item para ver ou editar.
 */
export function itemRow(ctx, item, look, { showDate = false } = {}) {
  const person = look.people.get(item.personId);
  const overdue = isOverdue(item, ctx.today);
  const category = look.categories.get(item.categoryId)?.name || 'Sem categoria';
  const account = look.accounts.get(item.accountId)?.name || '';
  const tags = [
    item.kind === 'recurring' ? '<span class="tag">recorrente</span>' : '',
    item.kind === 'installment' || item.source?.kind === 'installment' ? '<span class="tag">parcela</span>' : '',
    item.scope === 'house' && item.type === 'expense' ? '<span class="tag house">casa</span>' : '',
    item.loan ? '<span class="tag">emprestado</span>' : '',
    item.source?.kind === 'loan' ? '<span class="tag">devolução</span>' : '',
    item.transfer && !item.loan && item.source?.kind !== 'loan' ? '<span class="tag">transferência</span>' : '',
    item.cardCredit ? '<span class="tag">crédito</span>' : '',
  ].join('');
  // Em conta da casa, mostra quanto cabe a quem está usando este aparelho.
  const myShare = look.shares && ctx.me && item.scope === 'house' && item.type === 'expense' && !item.transfer && !item.variable
    ? ` · sua parte ${money(item.amount * (look.shares[ctx.me] || 0))}` : '';
  const check = item.paid
    ? `<span class="check done" title="${item.type === 'income' ? 'Recebido' : 'Pago'}">${icon('check', 14)}</span>`
    : item.onCard
      ? `<span class="check oncard" title="Entra na fatura do cartão">${icon('card', 14)}</span>`
      : `<button type="button" class="check" data-action="pay" data-key="${esc(item.key)}" data-month="${esc(ctx.ym)}" aria-label="Confirmar ${item.type === 'income' ? 'recebimento' : 'pagamento'} de ${esc(item.description)}"></button>`;
  const amount = item.variable ? 'valor variável' : `${item.type === 'income' ? '+' : '−'} ${esc(money(item.amount))}`;
  return `
    <li class="row${item.paid ? ' paid' : ''}${overdue ? ' overdue' : ''}${item.projected ? ' projected' : ''}">
      ${check}
      <button type="button" class="row-body" data-action="item" data-key="${esc(item.key)}" data-month="${esc(ctx.ym)}">
        <span class="row-main">
          <span class="row-title">${esc(item.description)}${tags}</span>
          <span class="row-sub">${personDot(person)}${esc(person ? person.name : 'Casal')} · ${esc(category)}${account ? ` · ${esc(account)}` : ''}${esc(myShare)}</span>
        </span>
        <span class="row-side">
          <strong class="${item.type === 'income' ? 'pos' : ''}">${amount}</strong>
          <small class="${overdue ? 'neg' : ''}">${showDate ? `${esc(fmtDay(item.date))} · ` : ''}${esc(dueLabel(item, ctx.today))}</small>
        </span>
      </button>
    </li>`;
}

export function findItem(state, el) {
  return monthItems(state, el.dataset.month).find((i) => i.key === el.dataset.key) || null;
}

export function empty(title, text, action = '') {
  return `<div class="empty"><strong>${esc(title)}</strong><p>${esc(text)}</p>${action}</div>`;
}

export function sectionHead(title, aside = '') {
  return `<header class="card-head"><h2>${esc(title)}</h2>${aside}</header>`;
}
