// Ajustes: este aparelho, pessoas, contas e cartões, categorias e backup.

import { downloadRescued, exportBackup, importBackup, openAccountForm, openCategoryForm, openPersonForm, openSplitForm } from '../actions.js';
import { ACCOUNT_TYPES, GROUPS, accountBalance, isMoneyAccount } from '../model.js';
import * as cloud from '../cloud.js';
import { getHousehold, getMode, hasUnsynced, listRescued, removeRescued, signOut } from '../store.js';
import { confirmDialog } from '../ui.js';
import { esc, fmtDate, money } from '../util.js';
import { personDot, sectionHead } from './shared.js';

const SPLIT = { equal: 'Meio a meio', income: 'Proporcional à renda', custom: 'Percentual fixo' };

function deviceSection(ctx) {
  const { state } = ctx;
  const theme = ctx.theme;
  const who = state.people.map((p) => `<button type="button" data-action="me" data-id="${esc(p.id)}" class="${ctx.me === p.id ? 'on' : ''}">${esc(p.name)}</button>`).join('');
  const themes = [['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']].map(([v, l]) => `<button type="button" data-action="theme" data-value="${v}" class="${theme === v ? 'on' : ''}">${l}</button>`).join('');
  return `
    <section class="card">
      ${sectionHead('Este aparelho')}
      <div class="setting"><div><strong>Quem usa este aparelho</strong><small class="muted">Novos lançamentos já saem no seu nome.</small></div><div class="segmented compact">${who}</div></div>
      <div class="setting"><div><strong>Aparência</strong><small class="muted">Automático segue o tema do aparelho.</small></div><div class="segmented compact">${themes}</div></div>
    </section>`;
}

function peopleSection(ctx) {
  const { state } = ctx;
  const rows = state.people.map((p) => `<li class="row"><button type="button" class="row-body" data-action="person" data-id="${esc(p.id)}"><span class="row-main"><span class="row-title">${personDot(p)}${esc(p.name)}</span></span><span class="row-side"><small>editar</small></span></button></li>`).join('');
  return `
    <section class="card">
      ${sectionHead('Casal')}
      <ul class="rows">${rows}</ul>
      <div class="setting"><div><strong>Divisão das contas da casa</strong><small class="muted">${esc(SPLIT[state.split.mode])}</small></div><button type="button" class="btn small" data-action="split">Mudar</button></div>
    </section>`;
}

function accountsSection(ctx) {
  const { state } = ctx;
  const rows = state.accounts.map((a) => {
    const detail = a.type === 'card' ? `fecha dia ${a.closingDay || '?'} · vence dia ${a.dueDay || '?'}${a.limit > 0 ? ` · limite ${money(a.limit)}` : ''}` : ACCOUNT_TYPES[a.type];
    const balance = isMoneyAccount(a) ? accountBalance(state, a, ctx.today) : null;
    const side = isMoneyAccount(a) ? `${balance === null ? '<small>Data inicial futura</small>' : `<strong class="${balance < 0 ? 'neg' : ''}">${esc(money(balance))}</strong>`}<small>saldo calculado hoje</small>` : `<small>${esc(ACCOUNT_TYPES[a.type])}</small>`;
    return `<li class="row${a.archived ? ' paid' : ''}"><button type="button" class="row-body" data-action="account" data-id="${esc(a.id)}"><span class="row-main"><span class="row-title">${esc(a.name)}${a.archived ? '<span class="tag">arquivada</span>' : ''}</span><span class="row-sub">${esc(detail)}</span></span><span class="row-side">${side}</span></button></li>`;
  }).join('');
  return `
    <section class="card">
      <header class="card-head"><h2>Contas e cartões</h2><button type="button" class="btn small primary" data-action="new-account">Nova conta</button></header>
      <p class="muted">Saldo calculado até ${esc(fmtDate(ctx.today))}: saldo inicial mais entradas e saídas pagas, incluindo faturas. Edite a conta para informar a data inicial; sem ela, todo o histórico é somado.</p>
      <ul class="rows">${rows}</ul>
    </section>`;
}

function categoriesSection(ctx) {
  const { state } = ctx;
  const row = (c) => {
    const notes = [c.kind === 'income' ? 'Receita' : GROUPS[c.group] || 'Despesa', c.budget > 0 ? `teto ${money(c.budget)}` : '', c.budget > 0 && c.estimate > 0 ? `sobre-teto ${money(c.estimate)}` : ''].filter(Boolean).join(' · ');
    return `<li class="row${c.archived ? ' paid' : ''}"><button type="button" class="row-body" data-action="category" data-id="${esc(c.id)}"><span class="row-main"><span class="row-title">${esc(c.name)}${c.archived ? '<span class="tag">arquivada</span>' : ''}</span><span class="row-sub">${esc(notes)}</span></span><span class="row-side"><small>editar</small></span></button></li>`;
  };
  const sorted = [...state.categories].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'income' ? -1 : 1));
  return `
    <section class="card">
      <header class="card-head"><h2>Categorias</h2><button type="button" class="btn small primary" data-action="new-category">Nova categoria</button></header>
      <ul class="rows">${sorted.map(row).join('')}</ul>
    </section>`;
}

function rescuedSection() {
  const list = listRescued();
  if (!list.length) return '';
  const rows = list.map((r) => `
    <li class="row"><span class="row-body static">
      <span class="row-main"><span class="row-title">Cópia de ${esc(new Date(r.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }))}</span>
      <span class="row-sub">${esc(r.reason)} · ${r.entries} lançamentos</span></span>
      <span class="row-side"><span class="button-row"><button type="button" class="btn small" data-action="rescued-download" data-at="${r.at}">Baixar</button><button type="button" class="btn small" data-action="rescued-drop" data-at="${r.at}">Descartar</button></span></span>
    </span></li>`).join('');
  return `
    <section class="card wide">
      ${sectionHead('Alterações que não foram salvas')}
      <p class="muted">Quando duas pessoas mexem no mesmo item ao mesmo tempo, fica a versão de quem salvou primeiro. A sua foi guardada aqui para você conferir e, se precisar, refazer. Pode descartar quando não precisar mais.</p>
      <ul class="rows">${rows}</ul>
    </section>`;
}

function lastBackupText() {
  let last = null;
  try {
    last = localStorage.getItem('monetizeo:lastBackup');
  } catch { /* sem armazenamento */ }
  return last ? `Último backup baixado neste aparelho: ${fmtDate(last)}.` : 'Você ainda não baixou um backup neste aparelho.';
}

function dataSection() {
  const mode = getMode();
  const backup = `
      <div class="button-row">
        <button type="button" class="btn" data-action="export">Baixar backup</button>
        <label class="btn file-btn">Restaurar backup<input type="file" accept=".json,application/json" data-backup hidden></label>
      </div>
      <p class="hint">${esc(lastBackupText())}</p>`;
  if (mode === 'cloud') {
    return `
    <section class="card wide">
      ${sectionHead('Dados e conta')}
      <p class="muted">Os dados ficam na nuvem, protegidos pelo login, com uma cópia automática por dia. Qualquer aparelho em que vocês entrarem vê e edita a mesma casa.</p>
      <div class="setting"><div><strong>Código de convite</strong><small class="muted">Quem tem conta e digita este código entra na casa de vocês. Passe só para quem divide as contas.</small></div><code class="invite">${esc(getHousehold()?.invite || '')}</code></div>
      <div class="setting"><div><strong>Conta</strong><small class="muted">${esc(cloud.userEmail())}</small></div><button type="button" class="btn small" data-action="logout">Sair</button></div>
      ${backup}
    </section>`;
  }
  return `
    <section class="card wide">
      ${sectionHead('Dados')}
      <p class="muted">${mode === 'server'
        ? 'Os dados ficam no computador que roda o Monetizeo (pasta <code>data</code>), com uma cópia automática por dia. Quem abrir o app pela rede de casa vê e edita os mesmos dados.'
        : 'O app foi aberto sem o servidor do Monetizeo: os dados estão só neste navegador e não são compartilhados. Inicie pelo <code>iniciar.bat</code> para compartilhar.'}</p>
      ${backup}
    </section>`;
}

export function render(ctx) {
  return `<div class="grid">${deviceSection(ctx)}${peopleSection(ctx)}${accountsSection(ctx)}${categoriesSection(ctx)}${dataSection()}${rescuedSection()}</div>`;
}

export function mount(root) {
  root.querySelector('[data-backup]')?.addEventListener('change', (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    if (file) importBackup(file);
  });
}

const find = (list, el) => list.find((x) => x.id === el.dataset.id);

export const actions = {
  me: (ctx, el) => ctx.setMe(el.dataset.id),
  theme: (ctx, el) => ctx.setTheme(el.dataset.value),
  person: (ctx, el) => openPersonForm(find(ctx.state.people, el)),
  split: () => openSplitForm(),
  'new-account': () => openAccountForm(),
  account: (ctx, el) => openAccountForm(find(ctx.state.accounts, el)),
  'new-category': () => openCategoryForm(),
  category: (ctx, el) => openCategoryForm(find(ctx.state.categories, el)),
  export: () => exportBackup(),
  logout: async () => {
    if (hasUnsynced()) {
      const ok = await confirmDialog({
        title: 'Sair com alterações sem salvar?',
        message: 'Há alterações deste aparelho que ainda não chegaram à nuvem. Elas ficam guardadas aqui e são enviadas quando você entrar de novo.',
        confirmLabel: 'Sair mesmo assim',
      });
      if (!ok) return;
    }
    await signOut();
    location.reload();
  },
  'rescued-download': (ctx, el) => { const r = listRescued().find((x) => String(x.at) === el.dataset.at); if (r) downloadRescued(r); },
  'rescued-drop': (ctx, el) => removeRescued(Number(el.dataset.at)),
};
