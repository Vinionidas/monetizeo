// Ponto de entrada: monta a moldura (menu, mês, botão de adicionar), escolhe a
// tela pela URL e redesenha quando os dados mudam.

import { importBackup, openEntryForm } from './actions.js';
import * as cloud from './cloud.js';
import { createCloudHousehold, getMode, getState, getStatus, hasData, joinCloudHousehold, load, onCodeNeeded, readLocalServerState, signOut, subscribe, takeNotice, update } from './store.js';
import { icon, openForm, toast } from './ui.js';
import { addMonths, esc, fmtMonth, today, uid, ymOf } from './util.js';
import * as cards from './views/cards.js';
import * as assistant from './views/assistant.js';
import * as entries from './views/entries.js';
import * as goals from './views/goals.js';
import * as house from './views/house.js';
import * as overview from './views/overview.js';
import * as plan from './views/plan.js';
import * as settings from './views/settings.js';
import { bigMoneyInner } from './views/shared.js';
import { avatar, displayName } from './mascots.js';

const ROUTES = {
  inicio: { title: 'Visão geral', icon: 'home', view: overview, short: 'Início' },
  lancamentos: { title: 'Lançamentos', icon: 'list', view: entries, short: 'Lançamentos' },
  cartoes: { title: 'Cartões e contas', icon: 'card', view: cards, short: 'Cartões' },
  casa: { title: 'Casa', icon: 'house', view: house, short: 'Casa' },
  plano: { title: 'Planejamento', icon: 'chart', view: plan, short: 'Plano' },
  metas: { title: 'Metas e dívidas', icon: 'target', view: goals, short: 'Metas' },
  assistente: { title: 'Pergunte ao Monetizeo', icon: 'chat', view: assistant, short: 'Assistente' },
  ajustes: { title: 'Ajustes', icon: 'gear', view: settings, short: 'Ajustes' },
};
const MOBILE_TABS = ['inicio', 'lancamentos', 'cartoes', 'casa'];
const NO_MONTH = new Set(['plano', 'metas', 'ajustes']);

const ui = {
  ym: ymOf(today()),
  viewPerson: null,
  me: localStorage.getItem('monetizeo:me') || null,
  theme: localStorage.getItem('monetizeo:theme') || 'auto',
};

const root = document.getElementById('app');

function routeName() {
  const name = location.hash.replace(/^#\/?/, '');
  return ROUTES[name] ? name : 'inicio';
}

function context() {
  const now = today();
  return {
    state: getState(),
    ym: ui.ym,
    today: now,
    currentYm: ymOf(now),
    me: ui.me,
    viewPerson: ui.viewPerson,
    theme: ui.theme,
    navigate: (name) => { location.hash = `#/${name}`; },
    rerender: () => renderView(),
    setViewPerson: (id) => { ui.viewPerson = id; renderView(); },
    setMe: (id) => { ui.me = id; localStorage.setItem('monetizeo:me', id); renderView(); renderShellState(); },
    setTheme: (value) => { ui.theme = value; localStorage.setItem('monetizeo:theme', value); applyTheme(); renderView(); },
  };
}

function applyTheme() {
  if (ui.theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = ui.theme;
}

// ------------------------------------------------------------------ moldura

function shell() {
  const link = (name) => `<a href="#/${name}" data-nav="${name}">${icon(ROUTES[name].icon)}<span>${esc(ROUTES[name].title)}</span></a>`;
  root.innerHTML = `
    <aside class="sidebar">
      <a class="brand" href="#/inicio">
        <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><rect width="32" height="32" rx="9" fill="var(--accent)"/><path d="M8 21.5V11l5.2 7 5.2-7v6.2" fill="none" stroke="var(--accent-ink)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 22l3.2-3.2M24.4 22.2v-3.6h-3.6" fill="none" stroke="var(--accent-ink)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span><strong>Monetizeo</strong><small>Finanças do casal</small></span>
      </a>
      <nav aria-label="Seções">
        <p class="nav-label">Mês</p>
        ${['inicio', 'lancamentos', 'cartoes', 'casa'].map(link).join('')}
        <p class="nav-label">Organização</p>
        ${['plano', 'metas', 'assistente', 'ajustes'].map(link).join('')}
      </nav>
      <div class="sidebar-foot" data-foot></div>
    </aside>
    <div class="main">
      <header class="topbar">
        <div class="topbar-title"><h1 data-title></h1></div>
        <div class="month" data-month-switch>
          <button type="button" class="icon-btn" data-action="prev-month" aria-label="Mês anterior">${icon('left')}</button>
          <button type="button" class="month-label" data-action="today-month" title="Voltar para o mês atual"><span data-month-label></span></button>
          <button type="button" class="icon-btn" data-action="next-month" aria-label="Próximo mês">${icon('right')}</button>
        </div>
        <button type="button" class="btn primary add-desktop" data-action="add">${icon('plus', 16)} Adicionar</button>
      </header>
      <main id="view" tabindex="-1"></main>
    </div>
    <nav class="bottomnav" aria-label="Seções">
      ${MOBILE_TABS.map((name) => `<a href="#/${name}" data-nav="${name}">${icon(ROUTES[name].icon, 20)}<span>${esc(ROUTES[name].short)}</span></a>`).join('')}
      <a href="#/mais" data-nav="mais">${icon('more', 20)}<span>Mais</span></a>
    </nav>
    <button type="button" class="fab" data-action="add" aria-label="Adicionar lançamento">${icon('plus', 24)}</button>`;
}

function renderShellState() {
  const state = getState();
  const me = state.people.find((p) => p.id === ui.me);
  const status = getStatus();
  const isCloud = getMode() === 'cloud';
  const sync = getMode() === 'local' ? ['warn', 'Só neste aparelho'] : status === 'offline' ? ['bad', isCloud ? 'Sem internet: salva quando voltar' : 'Sem conexão com o servidor'] : status === 'saving' ? ['', 'Salvando…'] : ['ok', isCloud ? 'Salvo na nuvem' : 'Salvo e compartilhado'];
  const foot = root.querySelector('[data-foot]');
  if (foot) foot.innerHTML = `<span class="sync ${sync[0]}"><i></i>${esc(sync[1])}</span>${me ? `<a class="foot-me" href="#/ajustes">${avatar(me, 26)}<small class="muted">Neste aparelho: ${esc(displayName(me))}</small></a>` : ''}`;
  document.body.dataset.sync = sync[0];
}

function moreView() {
  const link = (name) => `<a class="line" href="#/${name}"><span>${icon(ROUTES[name].icon)}<strong>${esc(ROUTES[name].title)}</strong></span>${icon('right', 16)}</a>`;
  return `<section class="card"><div class="lines">${['plano', 'metas', 'assistente', 'ajustes'].map(link).join('')}</div></section>`;
}

/** Números grandes sobem do zero ao entrar na tela (não a cada alteração de dados). */
function countUp(view) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ease = (t) => 1 - (1 - t) ** 3;
  const started = performance.now();
  const targets = [...view.querySelectorAll('.big[data-count]')].map((el) => [el, Number(el.dataset.count)]).filter(([, value]) => value);
  if (!targets.length) return;
  const frame = (now) => {
    const t = Math.min(1, (now - started) / 600);
    for (const [el, value] of targets) {
      if (el.isConnected) el.innerHTML = bigMoneyInner(t === 1 ? value : value * ease(t));
    }
    if (t < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** `enter` = a pessoa chegou na tela ou trocou de mês: só aí as animações de entrada tocam. */
function renderView(enter = false) {
  if (!root.querySelector('#view')) return;
  const raw = location.hash.replace(/^#\/?/, '');
  const name = routeName();
  const isMore = raw === 'mais';
  const route = ROUTES[name];
  const ctx = context();
  const view = root.querySelector('#view');

  root.querySelector('[data-title]').textContent = isMore ? 'Mais' : route.title;
  root.querySelector('[data-month-label]').textContent = fmtMonth(ui.ym);
  root.querySelector('[data-month-switch]').hidden = isMore || NO_MONTH.has(name);
  root.querySelectorAll('[data-nav]').forEach((a) => {
    const target = a.dataset.nav;
    const on = isMore ? target === 'mais' : target === name || (target === 'mais' && !MOBILE_TABS.includes(name));
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.title = `${isMore ? 'Mais' : route.title} · Monetizeo`;

  view.classList.toggle('enter', enter === true);
  view.innerHTML = isMore ? moreView() : route.view.render(ctx);
  if (!isMore) route.view.mount?.(view, ctx);
  if (enter === true) countUp(view);
}

// ----------------------------------------------------------- primeiro acesso

const DEFAULT_CATEGORIES = [
  ['Renda principal', 'income', null], ['Renda extra', 'income', null], ['Outras receitas', 'income', null],
  ['Moradia', 'expense', 'need'], ['Alimentação', 'expense', 'need'], ['Transporte', 'expense', 'need'], ['Saúde', 'expense', 'need'],
  ['Educação', 'expense', 'need'], ['Comunicação', 'expense', 'need'], ['Dívidas', 'expense', 'need'],
  ['Casa e compras', 'expense', 'want'], ['Assinaturas', 'expense', 'want'], ['Lazer', 'expense', 'want'], ['Outras despesas', 'expense', 'want'],
  ['Reserva e investimentos', 'expense', 'invest'],
];

function welcome() {
  root.innerHTML = `
    <main class="welcome">
      <section class="card">
        <h1>Monetizeo</h1>
        <p class="muted">Um painel para o casal ver, no mesmo lugar, o que entra, o que vence, quem paga o quê e quanto sobra.</p>
        <form class="form" data-welcome>
          <div class="form-grid">
            <label class="field"><span>Seu nome</span><input name="a" required autocomplete="off"></label>
            <label class="field"><span>Nome de quem divide as contas com você</span><input name="b" autocomplete="off" placeholder="Opcional"></label>
          </div>
          <footer class="dialog-actions">
            <label class="btn file-btn">Tenho um backup<input type="file" accept=".json,application/json" data-backup hidden></label>
            <span class="spacer"></span>
            <button class="btn primary">Começar</button>
          </footer>
        </form>
      </section>
    </main>`;
  root.querySelector('[data-welcome]').addEventListener('submit', (event) => {
    event.preventDefault();
    const names = [event.target.a.value.trim(), event.target.b.value.trim()].filter(Boolean);
    if (!names.length) return;
    const colors = ['#2f6fed', '#d6457b'];
    update((s) => {
      s.people = names.map((name, i) => ({ id: uid() + i, name, color: colors[i] }));
      s.accounts = [{ id: uid() + 'a', name: 'Conta corrente', type: 'bank', opening: 0, balanceSetup: true, archived: false }, { id: uid() + 'b', name: 'Carteira', type: 'cash', opening: 0, balanceSetup: true, archived: false }];
      s.categories = DEFAULT_CATEGORIES.map(([name, kind, group], i) => ({ id: uid() + i, name, kind, group, budget: 0, estimate: 0, archived: false }));
    });
    ui.me = getState().people[0].id;
    localStorage.setItem('monetizeo:me', ui.me);
    start();
  });
  root.querySelector('[data-backup]').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    await importBackup(file);
    if (hasData()) start();
  });
}

// ------------------------------------------------------- entrada na nuvem

function gate(title, text, inner) {
  root.innerHTML = `<main class="welcome"><section class="card"><h1>${esc(title)}</h1><p class="muted">${text}</p>${inner}</section></main>`;
  return root.querySelector('.card');
}

function showError(card, error) {
  const box = card.querySelector('.form-error');
  box.textContent = error.message || 'Algo deu errado. Tente de novo.';
  box.hidden = false;
}

async function busy(button, work) {
  button.disabled = true;
  try {
    return await work();
  } finally {
    button.disabled = false;
  }
}

function loginScreen(notice = '') {
  const card = gate('Monetizeo', esc(notice || 'Entre com o e-mail e a senha da sua conta.'), `
    <form class="form" data-login>
      <div class="form-grid">
        <label class="field full"><span>E-mail</span><input name="email" type="email" required autocomplete="username" inputmode="email"></label>
        <label class="field full"><span>Senha</span><input name="password" type="password" required autocomplete="current-password"></label>
      </div>
      <p class="form-error" role="alert" hidden></p>
      <footer class="dialog-actions"><button type="button" class="link-btn" data-forgot>Esqueci minha senha</button><span class="spacer"></span><button class="btn primary">Entrar</button></footer>
    </form>`);
  card.querySelector('[data-forgot]').addEventListener('click', () => forgotScreen(card.querySelector('[name=email]').value.trim()));
  card.querySelector('[data-login]').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.target;
    busy(form.querySelector('button'), async () => {
      await cloud.signIn(form.email.value.trim(), form.password.value);
      await boot();
    }).catch((error) => showError(card, error));
  });
}

/** "Esqueci minha senha": manda o link por e-mail. */
function forgotScreen(email = '') {
  const card = gate('Esqueci minha senha', 'Digite o e-mail da sua conta. Vamos mandar um link para você criar uma senha nova.', `
    <form class="form" data-forgot-form>
      <div class="form-grid"><label class="field full"><span>E-mail</span><input name="email" type="email" required autocomplete="username" inputmode="email" value="${esc(email)}"></label></div>
      <p class="form-error" role="alert" hidden></p>
      <footer class="dialog-actions"><button type="button" class="btn" data-back>Voltar</button><span class="spacer"></span><button class="btn primary">Enviar link</button></footer>
    </form>`);
  card.querySelector('[data-back]').addEventListener('click', () => loginScreen());
  card.querySelector('[data-forgot-form]').addEventListener('submit', (event) => {
    event.preventDefault();
    const address = event.target.email.value.trim();
    busy(event.target.querySelector('button.primary'), async () => {
      await cloud.recoverPassword(address);
      // Mesma mensagem com ou sem conta, para não revelar quem está cadastrado.
      loginScreen(`Se ${address} tiver conta, o link chega em alguns minutos. Confira também o spam.`);
    }).catch((error) => showError(card, error));
  });
}

/** Voltou pelo link do e-mail: define a senha nova e entra. */
function newPasswordScreen() {
  const card = gate('Criar senha nova', `Conta <strong>${esc(cloud.userEmail() || 'sua')}</strong>. Escolha a senha nova.`, `
    <form class="form" data-new-password>
      <div class="form-grid">
        <label class="field full"><span>Senha nova</span><input name="password" type="password" required autocomplete="new-password"></label>
        <label class="field full"><span>Repita a senha nova</span><input name="confirm" type="password" required autocomplete="new-password"></label>
      </div>
      <p class="form-error" role="alert" hidden></p>
      <footer class="dialog-actions"><span class="spacer"></span><button class="btn primary">Salvar e entrar</button></footer>
    </form>`);
  card.querySelector('[data-new-password]').addEventListener('submit', (event) => {
    event.preventDefault();
    const { password, confirm } = event.target;
    if (password.value.length < 6) return showError(card, { message: 'Use pelo menos 6 caracteres.' });
    if (password.value !== confirm.value) return showError(card, { message: 'As duas senhas não são iguais.' });
    busy(event.target.querySelector('button.primary'), async () => {
      await cloud.updatePassword(password.value);
      toast('Senha nova salva.');
      await boot();
    }).catch((error) => showError(card, error));
  });
}

/** Logado, mas ainda sem casa: cria uma (com ou sem os dados deste computador) ou entra com convite. */
async function setupScreen() {
  const local = await readLocalServerState();
  const card = gate('Quase lá', `Você entrou como <strong>${esc(cloud.userEmail())}</strong>. Falta dizer onde ficam os dados de vocês.`, `
    <div class="menu">
      ${local ? `<button type="button" data-do="migrate">Criar a casa com os dados deste computador<br><small class="muted">${local.entries.length} lançamentos, ${local.recurring.length} recorrentes e ${local.installments.length} parcelamentos vão para a nuvem.</small></button>` : ''}
      <button type="button" data-do="create">Criar uma casa nova, do zero</button>
    </div>
    <form class="form" data-join>
      <label class="field"><span>Ou entre na casa de quem já usa, com o código de convite</span><input name="code" autocomplete="off" placeholder="Código de 12 caracteres" required></label>
      <p class="form-error" role="alert" hidden></p>
      <footer class="dialog-actions"><button type="button" class="btn" data-do="logout">Sair</button><span class="spacer"></span><button class="btn primary">Entrar na casa</button></footer>
    </form>`);
  const open = () => (hasData() ? start() : welcome());
  card.addEventListener('click', (event) => {
    const button = event.target.closest('[data-do]');
    if (!button) return;
    const what = button.dataset.do;
    if (what === 'logout') {
      signOut().then(() => loginScreen());
      return;
    }
    busy(button, async () => {
      await createCloudHousehold(what === 'migrate' ? local : null);
      open();
    }).catch((error) => showError(card, error));
  });
  card.querySelector('[data-join]').addEventListener('submit', (event) => {
    event.preventDefault();
    busy(event.target.querySelector('button.primary'), async () => {
      await joinCloudHousehold(event.target.code.value);
      open();
    }).catch((error) => showError(card, error));
  });
}

async function boot() {
  if (cloud.enabled) {
    const back = await cloud.takeAuthRedirect();
    if (back === 'recovery') return newPasswordScreen();
    if (back?.error) return loginScreen(back.error);
  }
  const result = await load();
  if (result === 'login') return loginScreen();
  if (result === 'setup') return setupScreen();
  return hasData() ? start() : welcome();
}

// ------------------------------------------------------------------ eventos

const globalActions = {
  'prev-month': () => { ui.ym = addMonths(ui.ym, -1); renderView(true); },
  'next-month': () => { ui.ym = addMonths(ui.ym, 1); renderView(true); },
  'today-month': () => { ui.ym = ymOf(today()); renderView(true); },
  month: (ctx, el) => { ui.ym = el.dataset.ym; renderView(true); },
  add: (ctx) => {
    // Na aba Cartões, o lançamento novo já sai na conta escolhida e no nome do titular.
    const account = routeName() === 'cartoes' ? ctx.state.accounts.find((a) => a.id === cards.selectedAccount?.()) : null;
    openEntryForm(ctx, null, account ? { accountId: account.id, ...(account.personId ? { personId: account.personId } : {}), paid: true } : {});
  },
};

root.addEventListener('click', (event) => {
  const el = event.target.closest('[data-action]');
  if (!el || !root.contains(el)) return;
  const name = el.dataset.action;
  const handler = globalActions[name] || ROUTES[routeName()].view.actions?.[name];
  if (!handler) return;
  if (el.tagName === 'A') event.preventDefault();
  handler(context(), el, event);
});

window.addEventListener('hashchange', () => {
  renderView(true);
  window.scrollTo(0, 0);
});

function start() {
  const state = getState();
  // Perfil ligado ao login manda: em qualquer aparelho, quem entrou é quem usa.
  const uidNow = getMode() === 'cloud' && cloud.signedIn() ? cloud.userId() : '';
  const mine = uidNow && state.people.find((p) => p.userId === uidNow);
  if (mine && ui.me !== mine.id) { ui.me = mine.id; localStorage.setItem('monetizeo:me', mine.id); }
  if (!state.people.some((p) => p.id === ui.me)) ui.me = null;
  shell();
  renderShellState();
  renderView(true);
  const recovered = takeNotice();
  if (recovered) toast(recovered);
  if (!ui.me && state.people.length > 1) {
    openForm({
      title: 'Quem está usando este aparelho?',
      intro: 'Assim os novos lançamentos já saem no seu nome. Dá para mudar depois em Ajustes.',
      fields: [{ name: 'me', label: 'Eu sou', type: 'segmented', options: state.people.map((p) => ({ value: p.id, label: p.name })) }],
      values: { me: state.people[0].id },
      submitLabel: 'Continuar',
      onSubmit(v) {
        // Na nuvem, a escolha já liga o perfil ao login (se ninguém tiver ligado ainda).
        if (uidNow && !getState().people.find((p) => p.id === v.me)?.userId) {
          update((s) => {
            for (const p of s.people) if (p.userId === uidNow) { delete p.userId; delete p.loginEmail; }
            Object.assign(s.people.find((p) => p.id === v.me), { userId: uidNow, loginEmail: cloud.userEmail() });
          });
        }
        context().setMe(v.me);
      },
    });
  }
}

subscribe((reason, detail) => {
  if (reason === 'status') return renderShellState();
  if (reason === 'signed-out') {
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    return loginScreen('Sua sessão expirou. Entre de novo para continuar.');
  }
  if (reason === 'merged') {
    toast(detail?.conflicts
      ? `Outra pessoa salvou ao mesmo tempo. Juntei as duas versões; ${detail.conflicts} item(ns) ficaram com a versão dela. Sua cópia está em Ajustes.`
      : 'Outra pessoa salvou ao mesmo tempo. Juntei as duas alterações.');
  }
  if (reason === 'remote') toast('Dados atualizados por outro aparelho.');
  if (!root.querySelector('#view')) return;
  renderShellState();
  renderView();
});

onCodeNeeded((retry) => new Promise((resolve) => {
  let answered = false;
  const close = openForm({
    title: 'Código de acesso',
    intro: retry ? 'Código incorreto. Confira o código mostrado na janela do Monetizeo no computador.' : 'Digite o código mostrado na janela do Monetizeo no computador. Só é pedido uma vez neste aparelho.',
    fields: [{ name: 'code', label: 'Código', required: true }],
    submitLabel: 'Entrar',
    onSubmit(v) { answered = true; resolve(v.code); },
  });
  document.querySelector('dialog:last-of-type')?.addEventListener('close', () => { if (!answered) resolve(null); });
  void close;
}));

applyTheme();
boot()
  .catch((error) => {
    root.innerHTML = `<main class="welcome"><section class="card"><h1>Não foi possível abrir</h1><p class="muted">${esc(error.message)}</p><button class="btn primary" onclick="location.reload()">Tentar de novo</button></section></main>`;
  });

// ------------------------------------------------------------ atualização
// No site publicado, cada arquivo é carregado com "?v=<versão>". Quando o app
// volta para a frente (ou a cada alguns minutos), confere se saiu versão nova
// e recarrega sozinho — sem isso o celular ficava preso na versão antiga.
const loadedVersion = new URL(import.meta.url).searchParams.get('v');

async function checkForUpdate() {
  if (!loadedVersion || document.hidden) return;
  try {
    const response = await fetch(`version.txt?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return;
    const latest = (await response.text()).trim();
    if (!latest || latest === loadedVersion) return;
    // Não interrompe um formulário aberto nem entra em laço se o cache insistir.
    if (document.querySelector('dialog[open]') || sessionStorage.getItem('monetizeo:reloaded') === latest) return;
    sessionStorage.setItem('monetizeo:reloaded', latest);
    location.reload();
  } catch {
    // sem internet: tenta de novo depois
  }
}

document.addEventListener('visibilitychange', checkForUpdate);
window.addEventListener('focus', checkForUpdate);
setInterval(checkForUpdate, 5 * 60 * 1000);
