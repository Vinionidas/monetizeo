// Casa: as contas compartilhadas do mês, quanto cabe a cada um e o acerto entre o casal.

import { openItem, openSplitForm, payItem, removeSettlement, settle } from '../actions.js';
import { houseSplit, monthItems, splitShares } from '../model.js';
import { byId, esc, fmtDate, money, percent, sum } from '../util.js';
import { bigMoney, empty, findItem, itemRow, lookups, personDot, sectionHead } from './shared.js';

const MODES = { equal: 'meio a meio', income: 'proporcional à renda de cada um', custom: 'percentual fixo' };

export function render(ctx) {
  const { state } = ctx;
  const items = monthItems(state, ctx.ym);
  const split = houseSplit(state, ctx.ym, items);
  const people = byId(state.people);
  const look = lookups(state);
  look.shares = state.people.length > 1 ? splitShares(state, items) : null;
  const open = sum(split.bills.filter((b) => !b.paid), (b) => b.amount);

  const persons = split.people.map((p) => `
    <div class="person-card">
      <header>${personDot(p.person)}<strong>${esc(p.person.name)}</strong><small class="muted">${percent(p.share)}</small></header>
      <dl>
        <div><dt>Parte no mês</dt><dd>${esc(money(p.planned))}</dd></div>
        <div><dt>Já pagou</dt><dd>${esc(money(p.paid))}</dd></div>
        <div><dt>Acerto</dt><dd class="${p.net < -0.004 ? 'neg' : p.net > 0.004 ? 'pos' : ''}">${p.net < -0.004 ? `deve ${esc(money(-p.net))}` : p.net > 0.004 ? `recebe ${esc(money(p.net))}` : 'quite'}</dd></div>
      </dl>
    </div>`).join('');

  const transfers = split.transfers.map((t, i) => `
    <div class="notice action">
      <span>${esc(people.get(t.from).name)} transfere <strong>${esc(money(t.amount))}</strong> para ${esc(people.get(t.to).name)}.</span>
      <button type="button" class="btn small primary" data-action="settle" data-index="${i}">Registrar acerto</button>
    </div>`).join('');

  const settlements = split.settlements.map((s) => `
    <li class="row"><span class="row-body static">
      <span class="row-main"><span class="row-title">${esc(people.get(s.from)?.name || '?')} → ${esc(people.get(s.to)?.name || '?')}</span><span class="row-sub">Acerto em ${esc(fmtDate(s.date))}</span></span>
      <span class="row-side"><strong>${esc(money(s.amount))}</strong><button type="button" class="link" data-action="unsettle" data-id="${esc(s.id)}">remover</button></span>
    </span></li>`).join('');

  return `
    <section class="card hero">
      <header class="card-head"><h2>Contas da casa</h2><button type="button" class="btn small" data-action="split">Mudar divisão</button></header>
      <div class="hero-figure">${bigMoney(split.total)}<p class="muted">${split.bills.length} ${split.bills.length === 1 ? 'conta' : 'contas'} no mês · ${esc(money(open))} ainda em aberto · divisão ${esc(MODES[state.split.mode])}.</p></div>
      <div class="person-cards">${persons}</div>
      ${split.bills.length ? transfers || '<p class="notice ok">Vocês estão quites nas contas já pagas.</p>' : ''}
      <p class="hint">O acerto considera só contas já pagas e com pagador definido. Contas pagas "pelo casal" não geram acerto.</p>
    </section>
    ${settlements ? `<section class="card">${sectionHead('Acertos registrados neste mês')}<ul class="rows">${settlements}</ul></section>` : ''}
    <section class="card">
      ${sectionHead('Contas do mês', '<span class="muted">quem aparece é quem paga</span>')}
      ${split.bills.length ? `<ul class="rows">${split.bills.map((i) => itemRow(ctx, i, look, { showDate: true })).join('')}</ul>` : empty('Nenhuma conta da casa', 'Ao lançar uma despesa, marque "Da casa" para ela entrar na divisão.')}
    </section>`;
}

export const actions = {
  pay: (ctx, el) => { const item = findItem(ctx.state, el); if (item) payItem(ctx, item); },
  item: (ctx, el) => { const item = findItem(ctx.state, el); if (item) openItem(ctx, item); },
  split: () => openSplitForm(),
  settle: (ctx, el) => { const t = houseSplit(ctx.state, ctx.ym).transfers[Number(el.dataset.index)]; if (t) settle(ctx, t); },
  unsettle: (ctx, el) => removeSettlement(el.dataset.id),
};
