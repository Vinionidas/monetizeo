// Lançamentos do mês: tudo o que entrou e saiu, com filtros, e a fila de
// revisão do extrato importado.

import { importOfxFile, openItem, payItem, reviewOfx } from '../actions.js';
import { monthItems, summarize } from '../model.js';
import { icon } from '../ui.js';
import { esc, fmtDate, fmtDay, fmtWeekday, money, norm } from '../util.js';
import { empty, findItem, itemRow, lookups, sectionHead } from './shared.js';

const filters = { status: 'all', q: '', person: '', category: '', account: '' };

function applyFilters(items) {
  const q = norm(filters.q);
  return items.filter((i) => {
    if (filters.status === 'open' && i.paid) return false;
    if (filters.status === 'paid' && !i.paid) return false;
    if (filters.person === 'joint' ? i.personId : filters.person && i.personId !== filters.person) return false;
    if (filters.category && i.categoryId !== filters.category) return false;
    if (filters.account && i.accountId !== filters.account) return false;
    return !q || norm(i.description).includes(q);
  });
}

function listHtml(ctx) {
  const look = lookups(ctx.state);
  const all = monthItems(ctx.state, ctx.ym);
  const items = applyFilters(all);
  if (!all.length) return empty('Mês vazio', 'Nenhum lançamento ou previsão neste mês. Use "Adicionar" para começar.');
  if (!items.length) return empty('Nada encontrado', 'Nenhum lançamento combina com os filtros.');

  const byDate = new Map();
  for (const item of [...items].reverse()) {
    if (!byDate.has(item.date)) byDate.set(item.date, []);
    byDate.get(item.date).push(item);
  }
  const groups = [...byDate.entries()].map(([date, list]) => `
    <li class="day"><span>${esc(fmtDay(date))}</span><small>${esc(fmtWeekday(date))}${date === ctx.today ? ' · hoje' : ''}</small></li>
    ${list.map((i) => itemRow(ctx, i, look)).join('')}`).join('');
  const s = summarize(items);
  return `
    <ul class="rows">${groups}</ul>
    <footer class="totals">
      <span>${items.length} ${items.length === 1 ? 'item' : 'itens'}</span>
      <span>Entradas <strong class="pos">${esc(money(s.income))}</strong></span>
      <span>Saídas <strong>${esc(money(s.expense))}</strong></span>
      <span>Em aberto <strong>${esc(money(s.pending))}</strong></span>
    </footer>`;
}

function ofxQueue(ctx) {
  const pendingRows = ctx.state.ofxPending;
  if (!pendingRows.length) return '';
  const accounts = new Map(ctx.state.accounts.map((a) => [a.id, a.name]));
  const rows = [...pendingRows].sort((a, b) => a.date.localeCompare(b.date)).map((r) => `
    <li class="row">
      <button type="button" class="row-body" data-action="review" data-id="${esc(r.id)}">
        <span class="row-main"><span class="row-title">${esc(r.description)}</span><span class="row-sub">${esc(fmtDate(r.date))}${accounts.get(r.accountId) ? ` · ${esc(accounts.get(r.accountId))}` : ''}${r.memo ? ` · ${esc(r.memo)}` : ''}</span></span>
        <span class="row-side"><strong class="${r.type === 'income' ? 'pos' : ''}">${r.type === 'income' ? '+' : '−'} ${esc(money(r.amount))}</strong><small>Revisar</small></span>
      </button>
    </li>`).join('');
  return `
    <section class="card queue">
      ${sectionHead('Extrato aguardando revisão', `<span class="muted">${pendingRows.length} ${pendingRows.length === 1 ? 'transação' : 'transações'}</span>`)}
      <p class="muted">Nada daqui conta nos totais até você confirmar. Abra cada uma para conferir, vincular a uma conta prevista ou ignorar.</p>
      <ul class="rows">${rows}</ul>
    </section>`;
}

export function render(ctx) {
  const { state } = ctx;
  const option = (value, label, current) => `<option value="${esc(value)}" ${current === value ? 'selected' : ''}>${esc(label)}</option>`;
  const status = [['all', 'Tudo'], ['open', 'Em aberto'], ['paid', 'Pago']].map(([value, label]) => `<button type="button" data-action="status" data-value="${value}" class="${filters.status === value ? 'on' : ''}">${label}</button>`).join('');
  return `
    ${ofxQueue(ctx)}
    <section class="card">
      <div class="toolbar">
        <div class="segmented compact" role="group" aria-label="Situação">${status}</div>
        <label class="search">${icon('search', 16)}<input type="search" data-filter="q" placeholder="Buscar descrição" value="${esc(filters.q)}" aria-label="Buscar"></label>
        <select data-filter="person" aria-label="Quem">${option('', 'Todos', filters.person)}${state.people.map((p) => option(p.id, p.name, filters.person)).join('')}${option('joint', 'Casal', filters.person)}</select>
        <select data-filter="category" aria-label="Categoria">${option('', 'Toda categoria', filters.category)}${state.categories.map((c) => option(c.id, c.name, filters.category)).join('')}</select>
        <select data-filter="account" aria-label="Conta">${option('', 'Toda conta', filters.account)}${state.accounts.map((a) => option(a.id, a.name, filters.account)).join('')}</select>
        <label class="btn file-btn">${icon('upload', 16)} Importar extrato<input type="file" accept=".ofx,.qfx" data-ofx hidden></label>
      </div>
      <div data-list>${listHtml(ctx)}</div>
    </section>`;
}

export function mount(root, ctx) {
  root.querySelectorAll('[data-filter]').forEach((control) => {
    control.addEventListener('input', () => {
      filters[control.dataset.filter] = control.value;
      root.querySelector('[data-list]').innerHTML = listHtml(ctx);
    });
  });
  root.querySelector('[data-ofx]')?.addEventListener('change', (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    if (file) importOfxFile(ctx, file);
  });
}

export const actions = {
  pay: (ctx, el) => { const item = findItem(ctx.state, el); if (item) payItem(ctx, item); },
  item: (ctx, el) => { const item = findItem(ctx.state, el); if (item) openItem(ctx, item); },
  status: (ctx, el) => { filters.status = el.dataset.value; ctx.rerender(); },
  review: (ctx, el) => { const row = ctx.state.ofxPending.find((r) => r.id === el.dataset.id); if (row) reviewOfx(ctx, row); },
};
