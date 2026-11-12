// Tudo o que altera dados passa por aqui: cada função abre o formulário certo,
// valida e grava pelo store. As telas só chamam estas funções.

import { isLegacy } from './migrate.js';
import {
  ACCOUNT_TYPES, GROUPS, cardInvoice, debtBalance, openingForBalance, goalSaved, installmentStatus, isCard, isMoneyAccount,
  loanStatus, monthItems, usageCount,
} from './model.js';
import { decodeOfx, importKey, invoiceImportChange, invoiceImportTargets, parseOfx, reviewCandidates, splitNewOfx, transferCandidates, withoutInvoicePayment } from './ofx.js';
import { getState, replaceAll, undo, update } from './store.js';
import { confirmDialog, openDialog, openForm, toast } from './ui.js';
import { addMonths, byId, esc, fmtDate, fmtMonth, money, norm, round2, today, uid, ymOf } from './util.js';

// Mesmas cores da aba Cartões (definidas aqui para evitar import circular com as telas).
export const CARD_COLORS = { graphite: 'Grafite', emerald: 'Esmeralda', blue: 'Azul', purple: 'Roxo', orange: 'Laranja', red: 'Vermelho', pink: 'Rosa' };

const undoAction = { label: 'Desfazer', run: () => undo() };

// ------------------------------------------------------------------ opções

const active = (list, keepId) => list.filter((x) => !x.archived || x.id === keepId);

function personOptions(state, jointLabel = 'Casal') {
  return [{ value: '', label: jointLabel }, ...state.people.map((p) => ({ value: p.id, label: p.name }))];
}
function accountOptions(state, keepId, filter = () => true) {
  return active(state.accounts, keepId).filter(filter).map((a) => ({ value: a.id, label: a.name }));
}
function categoryOptions(state, kind, keepId) {
  return active(state.categories, keepId).filter((c) => c.kind === kind).map((c) => ({ value: c.id, label: c.name }));
}
const TYPE_OPTIONS = [{ value: 'expense', label: 'Despesa' }, { value: 'income', label: 'Receita' }];
const SCOPE_OPTIONS = [{ value: 'house', label: 'Da casa' }, { value: 'personal', label: 'Pessoal' }];

function defaultMoneyAccount(state, preferredId) {
  const accounts = byId(state.accounts);
  if (isMoneyAccount(accounts.get(preferredId))) return preferredId;
  return state.accounts.find((a) => a.type === 'bank' && !a.archived)?.id || state.accounts.find((a) => isMoneyAccount(a) && !a.archived)?.id || '';
}

function ensureCategory(state, name, props) {
  let category = state.categories.find((c) => norm(c.name) === norm(name));
  if (!category) {
    category = { id: uid(), name, kind: 'expense', group: 'need', budget: 0, estimate: 0, archived: false, ...props };
    state.categories.push(category);
  }
  return category.id;
}

// ------------------------------------------------------------- lançamentos

/** Campos comuns a lançamento, recorrente e revisão de extrato. */
function movementFields(state, values) {
  const isCardAccount = (v) => isCard(state.accounts.find((a) => a.id === v.accountId));
  return [
    { name: 'type', label: 'Tipo', type: 'segmented', options: TYPE_OPTIONS },
    { name: 'description', label: 'Descrição', required: true, full: true, placeholder: 'Ex.: mercado' },
    { name: 'amount', label: 'Valor', type: 'money', required: true },
    { name: 'date', label: 'Data', type: 'date', required: true },
    // Crédito no cartão (estorno) abate o gasto de uma categoria de despesa, não é renda.
    { name: 'expenseCategory', label: 'Categoria', type: 'select', options: categoryOptions(state, 'expense', values.categoryId), showIf: (v) => v.type === 'expense' || isCardAccount(v) || v.isRefund },
    { name: 'incomeCategory', label: 'Categoria', type: 'select', options: categoryOptions(state, 'income', values.categoryId), showIf: (v) => v.type === 'income' && !isCardAccount(v) && !v.isRefund },
    { name: 'accountId', label: 'Conta ou cartão', type: 'select', options: accountOptions(state, values.accountId) },
    { name: 'personId', label: 'Quem', type: 'select', options: personOptions(state) },
    { name: 'isRefund', label: 'É devolução de um gasto (troco, estorno, dinheiro que voltou)', type: 'checkbox', showIf: (v) => v.type === 'income' && !isCardAccount(v), hint: 'Não conta como renda: abate o gasto da categoria escolhida.' },
    { name: 'scope', label: 'Essa despesa é', type: 'segmented', options: SCOPE_OPTIONS, showIf: (v) => v.type === 'expense' || (v.type === 'income' && v.isRefund), hint: 'Contas da casa entram na divisão entre vocês.' },
    { name: 'isLoan', label: 'Emprestei para alguém e vou receber de volta', type: 'checkbox', showIf: (v) => v.type === 'expense', hint: 'Não conta como gasto: fica em "A receber" até devolverem.' },
    { name: 'loanTo', label: 'Quem vai devolver', placeholder: 'Nome', showIf: (v) => v.type === 'expense' && v.isLoan },
    { name: 'isTransfer', label: 'Transferência entre contas nossas ou acerto', type: 'checkbox', showIf: (v) => !v.isLoan && !v.isRefund && !isCardAccount(v), hint: 'Mexe no saldo da conta, mas não conta como gasto nem como renda.' },
    { name: 'paid', label: 'Já foi pago / recebido', type: 'checkbox', showIf: (v) => !isCardAccount(v) },
  ];
}

function movementValues(source) {
  return {
    ...source,
    personId: source.personId || '',
    isLoan: !!source.loan,
    isTransfer: source.transfer === true,
    isRefund: source.refund === true,
    loanTo: source.loan?.to || '',
    expenseCategory: source.type === 'expense' || source.cardCredit || source.refund ? source.categoryId : undefined,
    incomeCategory: source.type === 'income' ? source.categoryId : undefined,
  };
}

function readMovement(values, state = getState()) {
  const onCard = isCard(state.accounts.find((a) => a.id === values.accountId));
  const loan = values.type === 'expense' && values.isLoan ? { to: values.loanTo || 'Alguém' } : null;
  const refund = values.type === 'income' && !onCard && !!values.isRefund;
  return {
    type: values.type,
    description: values.description,
    amount: values.amount,
    date: values.date,
    categoryId: values.type === 'income' && !onCard && !refund ? values.incomeCategory : values.expenseCategory,
    accountId: values.accountId,
    personId: values.personId || null,
    scope: values.type === 'expense' || refund ? values.scope : 'personal',
    paid: !!values.paid,
    loan,
    refund,
    transfer: !onCard && !loan && !refund && !!values.isTransfer,
  };
}

export function openEntryForm(ctx, entry = null, preset = {}) {
  const state = getState();
  const base = entry || {
    type: 'expense', description: '', amount: null, date: ctx.ym === ctx.currentYm ? ctx.today : `${ctx.ym}-01`,
    categoryId: null, accountId: defaultMoneyAccount(state), personId: ctx.me, scope: 'personal', paid: true, ...preset,
  };
  const values = movementValues(base);
  const hasCategory = (kind) => state.categories.some((c) => c.kind === kind && !c.archived);
  if (!hasCategory('expense') || !hasCategory('income') || !state.accounts.length) {
    toast('Cadastre ao menos uma conta e categorias de receita e despesa em Ajustes.');
    return;
  }
  openForm({
    title: entry ? 'Editar lançamento' : 'Novo lançamento',
    fields: movementFields(state, values),
    values,
    submitLabel: entry ? 'Salvar' : 'Adicionar',
    onSubmit(v) {
      if (v.type === 'expense' && v.isLoan && !v.loanTo) return 'Informe quem vai devolver o dinheiro.';
      const data = readMovement(v);
      update((s) => {
        if (entry) Object.assign(s.entries.find((e) => e.id === entry.id), data);
        else s.entries.push({ id: uid(), ...data, ...(base.source ? { source: base.source } : {}) });
      });
      toast(entry ? 'Lançamento atualizado.' : 'Lançamento adicionado.');
    },
    actions: entry ? [{
      // Abre um lançamento novo igual a este, sem vínculo com extrato, recorrente ou parcela.
      label: 'Duplicar',
      run(close) {
        close();
        const { id: _id, importId: _i, importAccountId: _a, source: _s, transferGroup: _t, ...copy } = entry;
        openEntryForm(ctx, null, { ...copy, description: `${entry.description} (cópia)` });
        toast('Cópia aberta: ajuste o que mudar e salve.');
      },
    }, {
      label: 'Apagar', danger: true,
      run(close) {
        close();
        update((s) => {
          s.entries = s.entries.filter((e) => e.id !== entry.id);
          // Devoluções de um empréstimo apagado viram receitas comuns.
          for (const e of s.entries) if (e.source?.kind === 'loan' && e.source.id === entry.id) delete e.source;
        });
        toast(entry.source ? 'Lançamento apagado. A previsão do mês voltou.' : 'Lançamento apagado.', undoAction);
      },
    }] : [],
  });
}

/** Confirma o pagamento (ou recebimento) de um item do mês, seja previsão ou lançamento em aberto. */
export function payItem(ctx, item) {
  const state = getState();
  if (item.onCard) {
    toast('Compras no cartão são pagas junto com a fatura, na tela Cartões.');
    return;
  }
  const verb = item.type === 'income' ? 'recebimento' : 'pagamento';
  openForm({
    title: `Confirmar ${verb}`,
    eyebrow: item.description,
    fields: [
      { name: 'amount', label: item.type === 'income' ? 'Valor recebido' : 'Valor pago', type: 'money', required: true, hint: 'Inclua juros ou desconto, se houver.' },
      { name: 'date', label: `Data do ${verb}`, type: 'date', required: true },
      { name: 'accountId', label: item.type === 'income' ? 'Entrou em' : 'Saiu de', type: 'select', required: true, options: accountOptions(state, null, isMoneyAccount) },
    ],
    values: { amount: item.amount || null, date: ctx.today, accountId: defaultMoneyAccount(state, item.accountId) },
    submitLabel: 'Confirmar',
    onSubmit(v) {
      update((s) => {
        if (item.kind === 'entry') {
          Object.assign(s.entries.find((e) => e.id === item.id), { amount: v.amount, date: v.date, accountId: v.accountId, paid: true });
        } else {
          s.entries.push({
            id: uid(), date: v.date, description: item.kind === 'installment' ? item.description : item.description,
            amount: v.amount, type: item.type, categoryId: item.categoryId, accountId: v.accountId,
            personId: item.personId, scope: item.scope, paid: true,
            source: item.kind === 'recurring' ? { kind: 'recurring', id: item.refId, period: item.period } : { kind: 'installment', id: item.refId, index: item.index },
          });
        }
      });
      toast(item.type === 'income' ? 'Recebimento registrado.' : 'Pagamento registrado.', undoAction);
    },
  });
}

/** Clique num item do mês: lançamento abre edição; previsão abre as opções da ocorrência. */
export function openItem(ctx, item) {
  const state = getState();
  if (item.kind === 'entry') return openEntryForm(ctx, state.entries.find((e) => e.id === item.id));
  const isRecurring = item.kind === 'recurring';
  const source = isRecurring ? { kind: 'recurring', id: item.refId, period: item.period } : { kind: 'installment', id: item.refId, index: item.index };
  openDialog({
    title: item.description,
    eyebrow: isRecurring ? 'Previsão de recorrente' : 'Parcela prevista',
    body: `
      <p class="dialog-text">${item.variable ? 'Valor variável' : esc(money(item.amount))} · ${esc(item.type === 'income' ? 'previsto para' : 'vence em')} ${esc(fmtDate(item.date))}.
      Isto ainda é uma previsão; só vira lançamento quando você confirmar.</p>
      <div class="menu">
        ${item.onCard ? '' : `<button type="button" data-do="pay">${item.type === 'income' ? 'Registrar recebimento' : 'Registrar pagamento'}</button>`}
        <button type="button" data-do="adjust">Ajustar valor ou data só neste mês</button>
        ${isRecurring ? '<button type="button" data-do="skip">Pular este mês</button>' : ''}
        <button type="button" data-do="open">${isRecurring ? 'Editar o recorrente' : 'Ver o parcelamento'}</button>
      </div>`,
    onMount(dialog, close) {
      dialog.querySelector('.menu').addEventListener('click', (event) => {
        const what = event.target.closest('[data-do]')?.dataset.do;
        if (!what) return;
        close();
        if (what === 'pay') payItem(ctx, item);
        if (what === 'adjust') {
          openEntryForm(ctx, null, {
            type: item.type, description: item.description, amount: item.amount || null, date: item.date,
            categoryId: item.categoryId, accountId: item.accountId, personId: item.personId, scope: item.scope, paid: false, source,
          });
        }
        if (what === 'skip') {
          update((s) => {
            const r = s.recurring.find((x) => x.id === item.refId);
            r.skips = [...(r.skips || []), item.period];
          });
          toast(`${item.description} não entra em ${fmtMonth(item.period)}.`, undoAction);
        }
        if (what === 'open') {
          if (isRecurring) openRecurringForm(ctx, state.recurring.find((r) => r.id === item.refId));
          else openInstallmentDetail(ctx, state.installments.find((p) => p.id === item.refId));
        }
      });
    },
  });
}

// -------------------------------------------------------------- a receber

/** Registra que alguém devolveu (tudo ou parte de) um empréstimo. */
export function receiveLoan(ctx, entry) {
  const state = getState();
  const { outstanding } = loanStatus(state, entry);
  openForm({
    title: `Recebi de ${entry.loan.to}`,
    eyebrow: `${entry.description} · faltam ${money(outstanding)}`,
    fields: [
      { name: 'amount', label: 'Valor devolvido', type: 'money', required: true },
      { name: 'date', label: 'Data', type: 'date', required: true },
      { name: 'accountId', label: 'Entrou em', type: 'select', required: true, options: accountOptions(state, null, isMoneyAccount) },
    ],
    values: { amount: outstanding, date: ctx.today, accountId: defaultMoneyAccount(state, entry.accountId) },
    submitLabel: 'Registrar',
    onSubmit(v) {
      if (v.amount > outstanding + 0.004) return `O valor passa do que falta receber (${money(outstanding)}).`;
      update((s) => {
        s.entries.push({
          id: uid(), date: v.date, description: `Devolução — ${entry.loan.to}`, amount: v.amount, type: 'income',
          categoryId: ensureCategory(s, 'Outras receitas', { kind: 'income', group: null }), accountId: v.accountId,
          personId: entry.personId ?? null, scope: 'personal', paid: true, source: { kind: 'loan', id: entry.id },
        });
      });
      toast('Devolução registrada.', undoAction);
    },
  });
}

// ------------------------------------------------------------- recorrentes

export function openRecurringForm(ctx, recurring = null) {
  const state = getState();
  const base = recurring || { type: 'expense', description: '', amount: null, day: 5, categoryId: null, accountId: defaultMoneyAccount(state), personId: ctx.me, scope: 'house', start: null, end: null };
  const values = { ...movementValues(base), applyFrom: 'always', from: ctx.ym };
  const fields = movementFields(state, values).filter((f) => !['date', 'paid', 'isLoan', 'loanTo', 'isTransfer', 'isRefund'].includes(f.name));
  fields.find((f) => f.name === 'amount').required = false;
  fields.find((f) => f.name === 'amount').hint = 'Deixe vazio se o valor muda todo mês.';
  fields.splice(3, 0, { name: 'day', label: 'Dia do mês', type: 'number', min: 1, max: 31, required: true });
  fields.push(
    { name: 'start', label: 'Começa em (opcional)', type: 'month' },
    { name: 'end', label: 'Termina em (opcional)', type: 'month' },
  );
  if (recurring) {
    fields.push(
      { name: 'applyFrom', label: 'Aplicar as mudanças', type: 'segmented', options: [{ value: 'always', label: 'Em todos os meses' }, { value: 'from', label: 'A partir de um mês' }], hint: 'Use "a partir de um mês" para reajustes: os meses anteriores ficam como estavam.' },
      { name: 'from', label: 'A partir de', type: 'month', showIf: (v) => v.applyFrom === 'from' },
    );
  }
  openForm({
    title: recurring ? 'Editar recorrente' : 'Novo recorrente',
    eyebrow: 'Conta ou receita que se repete todo mês',
    fields,
    values,
    onSubmit(v) {
      if (v.day < 1 || v.day > 31) return 'O dia precisa estar entre 1 e 31.';
      if (v.start && v.end && v.end < v.start) return 'O fim não pode ser antes do começo.';
      const m = readMovement(v);
      const data = { description: m.description, amount: m.amount || 0, type: m.type, categoryId: m.categoryId, accountId: m.accountId, personId: m.personId, scope: m.scope, day: v.day };
      update((s) => {
        if (!recurring) {
          s.recurring.push({ id: uid(), ...data, start: v.start || null, end: v.end || null, active: true, skips: [], changes: [] });
          return;
        }
        const r = s.recurring.find((x) => x.id === recurring.id);
        r.start = v.start || null;
        r.end = v.end || null;
        if (v.applyFrom === 'from' && v.from) {
          const { type: _type, ...change } = data;
          r.changes = [...(r.changes || []).filter((c) => c.from !== v.from), { from: v.from, ...change }];
        } else {
          Object.assign(r, data);
          r.changes = [];
        }
      });
      toast(recurring ? 'Recorrente atualizado.' : 'Recorrente criado.');
    },
    actions: recurring ? [
      {
        label: recurring.active ? 'Pausar' : 'Reativar',
        run(close) {
          close();
          update((s) => { const r = s.recurring.find((x) => x.id === recurring.id); r.active = !r.active; });
          toast(recurring.active ? 'Recorrente pausado: sai das previsões.' : 'Recorrente reativado.', undoAction);
        },
      },
      {
        label: 'Apagar', danger: true,
        run(close) {
          close();
          update((s) => {
            s.recurring = s.recurring.filter((x) => x.id !== recurring.id);
            for (const e of s.entries) if (e.source?.kind === 'recurring' && e.source.id === recurring.id) delete e.source;
          });
          toast('Recorrente apagado. Os lançamentos já feitos foram mantidos.', undoAction);
        },
      },
    ] : [],
  });
}

// ----------------------------------------------------------- parcelamentos

export function openInstallmentForm(ctx, inst = null) {
  const state = getState();
  const base = inst || { description: '', amount: null, count: null, first: ctx.today, paidBefore: 0, categoryId: null, accountId: state.accounts.find((a) => isCard(a))?.id || '', personId: ctx.me, scope: 'personal' };
  openForm({
    title: inst ? 'Editar parcelamento' : 'Novo parcelamento',
    eyebrow: 'Compra parcelada ou financiamento',
    fields: [
      { name: 'description', label: 'Descrição', required: true, full: true },
      { name: 'amount', label: 'Valor da parcela', type: 'money', required: true },
      { name: 'count', label: 'Número de parcelas', type: 'number', min: 1, required: true },
      { name: 'first', label: 'Vencimento da 1ª parcela', type: 'date', required: true },
      { name: 'paidBefore', label: 'Parcelas já pagas antes do app', type: 'number', min: 0, hint: 'Elas contam como pagas sem criar lançamentos.' },
      { name: 'categoryId', label: 'Categoria', type: 'select', options: categoryOptions(state, 'expense', base.categoryId) },
      { name: 'accountId', label: 'Cartão ou crediário', type: 'select', options: accountOptions(state, base.accountId) },
      { name: 'personId', label: 'Quem', type: 'select', options: personOptions(state) },
      { name: 'scope', label: 'Essa despesa é', type: 'segmented', options: SCOPE_OPTIONS },
    ],
    values: { ...base, personId: base.personId || '' },
    onSubmit(v) {
      if (!(v.count >= 1)) return 'Informe o número de parcelas.';
      if ((v.paidBefore || 0) > v.count) return 'As parcelas já pagas não podem passar do total.';
      const data = { description: v.description, amount: v.amount, count: v.count, first: v.first, paidBefore: v.paidBefore || 0, categoryId: v.categoryId, accountId: v.accountId, personId: v.personId || null, scope: v.scope };
      update((s) => {
        if (inst) Object.assign(s.installments.find((x) => x.id === inst.id), data);
        else s.installments.push({ id: uid(), ...data });
      });
      toast(inst ? 'Parcelamento atualizado.' : 'Parcelamento criado.');
    },
    actions: inst ? [{
      label: 'Apagar', danger: true,
      run(close) {
        close();
        update((s) => {
          s.installments = s.installments.filter((x) => x.id !== inst.id);
          for (const e of s.entries) if (e.source?.kind === 'installment' && e.source.id === inst.id) delete e.source;
        });
        toast('Parcelamento apagado. Os pagamentos já lançados foram mantidos.', undoAction);
      },
    }] : [],
  });
}

export function openInstallmentDetail(ctx, inst) {
  const state = getState();
  const status = installmentStatus(state, inst);
  const account = state.accounts.find((a) => a.id === inst.accountId);
  const rows = status.rows.map((row) => {
    const label = row.paid ? (row.historical ? 'Paga (antes do app)' : `Paga em ${fmtDate(row.entry.date)}`) : row.entry ? 'Lançada, em aberto' : 'Prevista';
    const value = row.entry ? row.entry.amount : inst.amount;
    const diff = row.entry && row.paid ? round2(row.entry.amount - inst.amount) : 0;
    const note = diff > 0 ? ` <small class="neg">+${esc(money(diff))} de juros</small>` : diff < 0 ? ` <small class="pos">${esc(money(diff))} de desconto</small>` : '';
    const action = row.entry
      ? `<button type="button" class="btn small" data-entry="${esc(row.entry.id)}">Corrigir</button>`
      : !row.paid && row === status.next && !isCard(account) ? `<button type="button" class="btn small primary" data-pay="${row.index}">Pagar</button>` : '';
    return `<tr class="${row.paid ? 'done' : ''}"><td>${row.index + 1}/${inst.count}</td><td>${esc(fmtMonth(row.month))}</td><td class="num">${esc(money(value))}${note}</td><td>${esc(label)}</td><td class="num">${action}</td></tr>`;
  }).join('');
  openDialog({
    title: inst.description,
    eyebrow: 'Parcelamento',
    wide: true,
    body: `
      <div class="stats">
        <div><small>Parcela</small><strong>${esc(money(inst.amount))}</strong></div>
        <div><small>Pagas</small><strong>${status.paidCount} de ${inst.count}</strong></div>
        <div><small>Já pago</small><strong>${esc(money(status.paidTotal))}</strong></div>
        <div><small>Falta pagar</small><strong>${esc(money(status.remainingAmount))}</strong></div>
      </div>
      ${isCard(account) ? `<p class="dialog-text">As parcelas entram na fatura do ${esc(account.name)} e são pagas junto com ela.</p>` : ''}
      <div class="table-scroll"><table class="table"><thead><tr><th>Parcela</th><th>Mês</th><th class="num">Valor</th><th>Situação</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <footer class="dialog-actions"><button type="button" class="btn" data-edit>Editar parcelamento</button><span class="spacer"></span><button type="button" class="btn" data-close>Fechar</button></footer>`,
    onMount(dialog, close) {
      dialog.addEventListener('click', (event) => {
        const entryId = event.target.closest('[data-entry]')?.dataset.entry;
        const payIndex = event.target.closest('[data-pay]')?.dataset.pay;
        if (entryId) { close(); openEntryForm(ctx, state.entries.find((e) => e.id === entryId)); }
        if (payIndex !== undefined) {
          close();
          const item = monthItems(state, addMonths(ymOf(inst.first), Number(payIndex))).find((i) => i.key === `i:${inst.id}:${payIndex}`);
          if (item) payItem(ctx, item);
        }
        if (event.target.closest('[data-edit]')) { close(); openInstallmentForm(ctx, inst); }
      });
    },
  });
}

// ---------------------------------------------------------- metas e dívidas

export function openGoalForm(ctx, goal = null) {
  openForm({
    title: goal ? 'Editar meta' : 'Nova meta',
    fields: [
      { name: 'name', label: 'Objetivo', required: true, full: true, placeholder: 'Ex.: máquina de lavar' },
      { name: 'target', label: 'Valor alvo', type: 'money', required: true },
      { name: 'initial', label: 'Já guardado antes do app', type: 'money' },
      { name: 'deadline', label: 'Prazo (opcional)', type: 'date' },
    ],
    values: goal || {},
    onSubmit(v) {
      const data = { name: v.name, target: v.target, initial: v.initial || 0, deadline: v.deadline || null };
      update((s) => {
        if (goal) Object.assign(s.goals.find((g) => g.id === goal.id), data);
        else s.goals.push({ id: uid(), ...data });
      });
      toast(goal ? 'Meta atualizada.' : 'Meta criada.');
    },
    actions: goal ? [{
      label: 'Apagar', danger: true,
      run(close) {
        close();
        update((s) => {
          s.goals = s.goals.filter((g) => g.id !== goal.id);
          for (const e of s.entries) if (e.source?.kind === 'goal' && e.source.id === goal.id) delete e.source;
        });
        toast('Meta apagada.', undoAction);
      },
    }] : [],
  });
}

export function contributeGoal(ctx, goal) {
  const state = getState();
  openForm({
    title: `Guardar para ${goal.name}`,
    eyebrow: `Guardado até agora: ${money(goalSaved(state, goal))}`,
    fields: [
      { name: 'amount', label: 'Valor', type: 'money', required: true },
      { name: 'date', label: 'Data', type: 'date', required: true },
      { name: 'accountId', label: 'Saiu de', type: 'select', required: true, options: accountOptions(state, null, isMoneyAccount) },
      { name: 'personId', label: 'Quem guardou', type: 'select', options: personOptions(state) },
    ],
    values: { date: ctx.today, accountId: defaultMoneyAccount(state), personId: ctx.me || '' },
    submitLabel: 'Guardar',
    onSubmit(v) {
      update((s) => {
        s.entries.push({
          id: uid(), date: v.date, description: `Reserva — ${goal.name}`, amount: v.amount, type: 'expense',
          categoryId: ensureCategory(s, 'Reserva e investimentos', { group: 'invest' }), accountId: v.accountId,
          personId: v.personId || null, scope: 'personal', paid: true, source: { kind: 'goal', id: goal.id },
        });
      });
      toast('Valor guardado na meta.', undoAction);
    },
  });
}

export function openDebtForm(ctx, debt = null) {
  const state = getState();
  const paidSoFar = debt ? round2(debt.initial - debtBalance(state, debt)) : 0;
  openForm({
    title: debt ? 'Editar dívida' : 'Nova dívida',
    fields: [
      { name: 'name', label: 'Para quem', required: true, full: true, placeholder: 'Ex.: Nubank' },
      { name: 'initial', label: debt && paidSoFar > 0 ? 'Valor original da dívida' : 'Saldo devedor', type: 'money', required: true, hint: debt && paidSoFar > 0 ? `Já foram pagos ${money(paidSoFar)} pelo app.` : '' },
      { name: 'payment', label: 'Parcela combinada (opcional)', type: 'money' },
      { name: 'rate', label: 'Juros ao mês em % (opcional)', type: 'number', min: 0, step: 0.01 },
    ],
    values: debt ? { ...debt, rate: debt.rate || '' } : {},
    onSubmit(v) {
      const data = { name: v.name, initial: v.initial, payment: v.payment || 0, rate: v.rate || 0 };
      update((s) => {
        if (debt) Object.assign(s.debts.find((d) => d.id === debt.id), data);
        else s.debts.push({ id: uid(), ...data });
      });
      toast(debt ? 'Dívida atualizada.' : 'Dívida cadastrada.');
    },
    actions: debt ? [{
      label: 'Apagar', danger: true,
      run(close) {
        close();
        update((s) => {
          s.debts = s.debts.filter((d) => d.id !== debt.id);
          for (const e of s.entries) if (e.source?.kind === 'debt' && e.source.id === debt.id) delete e.source;
        });
        toast('Dívida apagada.', undoAction);
      },
    }] : [],
  });
}

export function payDebt(ctx, debt) {
  const state = getState();
  const balance = debtBalance(state, debt);
  openForm({
    title: `Pagar ${debt.name}`,
    eyebrow: `Saldo devedor: ${money(balance)}`,
    fields: [
      { name: 'amount', label: 'Valor pago', type: 'money', required: true },
      { name: 'date', label: 'Data', type: 'date', required: true },
      { name: 'accountId', label: 'Saiu de', type: 'select', required: true, options: accountOptions(state, null, isMoneyAccount) },
      { name: 'personId', label: 'Quem pagou', type: 'select', options: personOptions(state) },
    ],
    values: { amount: Math.min(balance, debt.payment || balance), date: ctx.today, accountId: defaultMoneyAccount(state), personId: ctx.me || '' },
    submitLabel: 'Registrar pagamento',
    onSubmit(v) {
      if (v.amount > balance + 0.004) return `O valor passa do saldo devedor (${money(balance)}).`;
      update((s) => {
        s.entries.push({
          id: uid(), date: v.date, description: `Pagamento — ${debt.name}`, amount: v.amount, type: 'expense',
          categoryId: ensureCategory(s, 'Dívidas', { group: 'need' }), accountId: v.accountId,
          personId: v.personId || null, scope: 'personal', paid: true, source: { kind: 'debt', id: debt.id },
        });
      });
      toast('Pagamento da dívida registrado.', undoAction);
    },
  });
}

// ---------------------------------------------------------------- cartões

export function payInvoice(ctx, card, invoice) {
  const state = getState();
  openForm({
    title: `Pagar fatura de ${fmtMonth(invoice.month)}`,
    eyebrow: card.name,
    intro: `Total da fatura: <strong>${esc(money(invoice.total))}</strong>. Ao confirmar, todos os itens desta fatura passam a contar como pagos.`,
    fields: [
      { name: 'date', label: 'Data do pagamento', type: 'date', required: true },
      { name: 'fromAccountId', label: 'Saiu de', type: 'select', required: true, options: accountOptions(state, null, isMoneyAccount) },
    ],
    values: { date: ctx.today, fromAccountId: defaultMoneyAccount(state) },
    submitLabel: 'Confirmar pagamento',
    onSubmit(v) {
      const current = getState();
      const fresh = cardInvoice(current, card, invoice.month);
      if (fresh.paid || fresh.total !== invoice.total || !(fresh.total > 0)) return 'A fatura mudou ou já foi paga. Reabra a fatura antes de confirmar.';
      if (!isMoneyAccount(current.accounts.find((a) => a.id === v.fromAccountId))) return 'Escolha a conta bancária ou dinheiro de onde saiu o pagamento.';
      update((s) => {
        s.invoicePayments.push({ id: uid(), cardId: card.id, month: invoice.month, amount: invoice.total, date: v.date, fromAccountId: v.fromAccountId });
      });
      toast('Fatura paga.', undoAction);
    },
  });
}

export async function undoInvoicePayment(card, invoice) {
  const ok = await confirmDialog({ title: 'Desfazer pagamento da fatura?', message: `A fatura de ${fmtMonth(invoice.month)} do ${card.name} volta a ficar em aberto.`, confirmLabel: 'Desfazer pagamento' });
  if (!ok) return;
  update((s) => { Object.assign(s, withoutInvoicePayment(s, invoice.payment.id)); });
  toast(invoice.payment.ofxRow ? 'Pagamento desfeito. A transação do extrato voltou para revisão.' : 'Pagamento da fatura desfeito.', undoAction);
}

// --------------------------------------------------------- divisão da casa

export function openSplitForm() {
  const state = getState();
  const shareFields = state.people.map((p) => ({ name: `share_${p.id}`, label: `Parte de ${p.name} (%)`, type: 'number', min: 0, max: 100, showIf: (v) => v.mode === 'custom' }));
  const values = { mode: state.split.mode };
  for (const p of state.people) values[`share_${p.id}`] = state.split.shares?.[p.id] ?? Math.round(100 / state.people.length);
  openForm({
    title: 'Como vocês dividem as contas da casa',
    fields: [
      { name: 'mode', label: 'Divisão', type: 'segmented', options: [{ value: 'equal', label: 'Meio a meio' }, { value: 'income', label: 'Proporcional à renda' }, { value: 'custom', label: 'Percentual fixo' }], hint: 'Proporcional à renda usa as receitas de cada um no mês.' },
      ...shareFields,
    ],
    values,
    onSubmit(v) {
      const shares = Object.fromEntries(state.people.map((p) => [p.id, Number(v[`share_${p.id}`]) || 0]));
      if (v.mode === 'custom' && Math.round(Object.values(shares).reduce((a, b) => a + b, 0)) !== 100) return 'Os percentuais precisam somar 100.';
      update((s) => { s.split = { mode: v.mode, shares }; });
      toast('Divisão atualizada.');
    },
  });
}

export function settle(ctx, transfer) {
  const state = getState();
  const people = byId(state.people);
  openForm({
    title: 'Registrar acerto',
    eyebrow: `${people.get(transfer.from).name} paga ${people.get(transfer.to).name}`,
    fields: [
      { name: 'amount', label: 'Valor transferido', type: 'money', required: true },
      { name: 'date', label: 'Data', type: 'date', required: true },
    ],
    values: { amount: transfer.amount, date: ctx.today },
    submitLabel: 'Registrar',
    onSubmit(v) {
      update((s) => { s.settlements.push({ id: uid(), month: ctx.ym, from: transfer.from, to: transfer.to, amount: v.amount, date: v.date }); });
      toast('Acerto registrado.', undoAction);
    },
  });
}

export function removeSettlement(id) {
  update((s) => { s.settlements = s.settlements.filter((x) => x.id !== id); });
  toast('Acerto removido.', undoAction);
}

// --------------------------------------------------------------- cadastros

export function openPersonForm(person) {
  openForm({
    title: 'Editar pessoa',
    fields: [{ name: 'name', label: 'Nome', required: true }, { name: 'color', label: 'Cor', type: 'color' }],
    values: person,
    onSubmit(v) {
      update((s) => Object.assign(s.people.find((p) => p.id === person.id), { name: v.name, color: v.color }));
    },
  });
}

/** Pergunta só "quanto tem agora?" e ajusta o saldo inicial por baixo, sem pedir data nem conta de cabeça. */
export function openBalanceSetup(ctx, account) {
  openForm({
    title: `Quanto tem em ${account.name} agora?`,
    intro: 'Informe o saldo que aparece hoje no banco (ou o dinheiro que você tem na mão). A partir daqui o Monetizeo soma tudo o que for pago ou recebido.',
    fields: [{ name: 'balance', label: 'Saldo atual', type: 'money', required: true, allowNegative: true, allowZero: true }],
    submitLabel: 'Salvar saldo',
    onSubmit(v) {
      const current = getState();
      const target = current.accounts.find((a) => a.id === account.id);
      if (!target) return 'Esta conta não existe mais.';
      const { opening, openingDate } = openingForBalance(current, target, v.balance, today());
      update((s) => Object.assign(s.accounts.find((a) => a.id === account.id), { opening, openingDate, balanceSetup: true }));
      toast('Saldo salvo.', undoAction);
    },
  });
}

export function openAccountForm(account = null, newType = 'bank') {
  const state = getState();
  const cardOnly = (v) => v.type === 'card';
  openForm({
    title: account ? 'Editar conta' : 'Nova conta ou cartão',
    fields: [
      { name: 'name', label: 'Nome', required: true, full: true, placeholder: 'Ex.: Inter, Nubank, Carteira' },
      { name: 'type', label: 'Tipo', type: 'select', options: Object.entries(ACCOUNT_TYPES).map(([value, label]) => ({ value, label })) },
      { name: 'color', label: 'Cor do cartão', type: 'select', options: [{ value: '', label: 'Automática' }, ...Object.entries(CARD_COLORS).map(([value, label]) => ({ value, label }))] },
      { name: 'personId', label: 'Titular', type: 'select', options: personOptions(state), hint: 'Lançamentos novos e do extrato desta conta já saem no nome do titular.' },
      { name: 'opening', label: 'Saldo inicial', type: 'money', allowNegative: true, showIf: (v) => isMoneyAccount(v), hint: 'Valor antes das movimentações da data inicial. Pode ser negativo.' },
      { name: 'openingDate', label: 'Data inicial do saldo (opcional)', type: 'date', showIf: (v) => isMoneyAccount(v), hint: 'Saldo no início deste dia. Movimentações anteriores ficam no histórico, mas não entram no saldo. Sem data, soma todo o histórico.' },
      { name: 'closingDay', label: 'Dia do fechamento', type: 'number', min: 1, max: 31, showIf: cardOnly },
      { name: 'dueDay', label: 'Dia do vencimento', type: 'number', min: 1, max: 31, showIf: cardOnly },
      { name: 'limit', label: 'Limite', type: 'money', showIf: cardOnly },
    ],
    values: account ? { ...account, personId: account.personId || '', color: account.color || '' } : { type: newType, personId: '', color: '' },
    onSubmit(v) {
      if (state.accounts.some((a) => a.id !== account?.id && norm(a.name) === norm(v.name))) return 'Já existe uma conta com esse nome.';
      if (v.type === 'card' && (!v.closingDay || !v.dueDay)) return 'Informe o fechamento e o vencimento do cartão.';
      if (isMoneyAccount(v) && v.openingDate && (!/^\d{4}-\d{2}-\d{2}$/.test(v.openingDate) || today(new Date(`${v.openingDate}T12:00:00`)) !== v.openingDate || v.openingDate > today())) return 'Informe uma data inicial válida, até hoje.';
      const data = { name: v.name, type: v.type, color: v.color || null, personId: v.personId || null, opening: v.opening || 0, openingDate: isMoneyAccount(v) ? v.openingDate || null : null, closingDay: v.closingDay || null, dueDay: v.dueDay || null, limit: v.limit || 0 };
      // Só conta como "saldo informado" se a pessoa realmente mexeu no saldo ou na data (ou é conta nova).
      if (!account || Number(v.opening || 0) !== Number(account.opening || 0) || (v.openingDate || null) !== (account.openingDate || null)) data.balanceSetup = true;
      update((s) => {
        if (account) Object.assign(s.accounts.find((a) => a.id === account.id), data);
        else s.accounts.push({ id: uid(), archived: false, ...data });
      });
    },
    actions: account ? [archiveAction('accounts', 'accountId', account)] : [],
  });
}

export function openCategoryForm(category = null) {
  const state = getState();
  openForm({
    title: category ? 'Editar categoria' : 'Nova categoria',
    fields: [
      { name: 'name', label: 'Nome', required: true, full: true },
      { name: 'kind', label: 'Tipo', type: 'segmented', options: TYPE_OPTIONS },
      { name: 'group', label: 'Grupo', type: 'select', options: Object.entries(GROUPS).map(([value, label]) => ({ value, label })), showIf: (v) => v.kind === 'expense' },
      { name: 'budget', label: 'Teto mensal (opcional)', type: 'money', showIf: (v) => v.kind === 'expense', hint: 'Quanto pretendem gastar no mês nesta categoria.' },
      { name: 'estimate', label: 'Sobre-teto para urgências (opcional)', type: 'money', showIf: (v) => v.kind === 'expense' && v.budget > 0, hint: 'Margem além do teto. Passou do teto: aviso amarelo. Passou do teto + sobre-teto: alerta vermelho. Não entra na previsão.' },
    ],
    values: category || { kind: 'expense', group: 'need' },
    onSubmit(v) {
      if (state.categories.some((c) => c.id !== category?.id && norm(c.name) === norm(v.name))) return 'Já existe uma categoria com esse nome.';
      const data = { name: v.name, kind: v.kind, group: v.kind === 'expense' ? v.group : null, budget: v.budget || 0, estimate: v.budget > 0 ? v.estimate || 0 : 0 };
      update((s) => {
        if (category) Object.assign(s.categories.find((c) => c.id === category.id), data);
        else s.categories.push({ id: uid(), archived: false, ...data });
      });
    },
    actions: category ? [archiveAction('categories', 'categoryId', category)] : [],
  });
}

/** Cadastro em uso é arquivado (some das listas, mantém o histórico); sem uso, é apagado. */
function archiveAction(listName, field, item) {
  const used = usageCount(getState(), field, item.id);
  const label = item.archived ? 'Reativar' : used ? 'Arquivar' : 'Apagar';
  return {
    label,
    danger: !item.archived,
    run(close) {
      close();
      update((s) => {
        if (item.archived || used) s[listName].find((x) => x.id === item.id).archived = !item.archived;
        else s[listName] = s[listName].filter((x) => x.id !== item.id);
      });
      toast(item.archived ? `${item.name} reativado.` : used ? `${item.name} arquivado: os ${used} registros que o usam foram mantidos.` : `${item.name} apagado.`, undoAction);
    },
  };
}

// ------------------------------------------------------------ extrato OFX

export async function importOfxFile(ctx, file, presetAccountId = null) {
  const state = getState();
  let rows;
  try {
    rows = parseOfx(decodeOfx(await file.arrayBuffer()));
  } catch {
    rows = [];
  }
  if (!rows.length) {
    toast('Não encontrei transações nesse arquivo. Confira se é um extrato OFX.');
    return;
  }
  const initial = presetAccountId || defaultMoneyAccount(state);
  openDialog({
    title: 'Extrato lido',
    eyebrow: file.name,
    wide: true,
    body: `
      <label class="field"><span>Conta ou cartão deste extrato</span><select data-account>${accountOptions(state).map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select></label>
      <div data-preview></div>
      <footer class="dialog-actions"><span class="spacer"></span><button type="button" class="btn" data-close>Cancelar</button><button type="button" class="btn primary" data-queue>Enviar para a fila de revisão</button></footer>`,
    onMount(dialog, close) {
      const select = dialog.querySelector('[data-account]');
      const button = dialog.querySelector('[data-queue]');
      select.value = initial;
      let fresh = [];
      // A duplicidade depende da conta: o mesmo código em outro banco é outra transação.
      const refresh = () => {
        const split = splitNewOfx(getState(), rows, select.value);
        fresh = split.fresh;
        const preview = fresh.slice(0, 60).map((r) => `<tr><td>${esc(fmtDate(r.date))}</td><td>${esc(r.description)}</td><td class="num ${r.type === 'income' ? 'pos' : ''}">${r.type === 'income' ? '+' : '−'} ${esc(money(r.amount))}</td></tr>`).join('');
        dialog.querySelector('[data-preview]').innerHTML = `
          <p class="dialog-text"><strong>${fresh.length}</strong> transações novas nesta conta${split.duplicates ? ` · ${split.duplicates} já importadas antes foram descartadas` : ''}.
          Nada entra nos lançamentos agora: elas vão para uma fila e você confirma uma por uma.</p>
          ${fresh.length ? `<div class="table-scroll"><table class="table"><thead><tr><th>Data</th><th>Descrição</th><th class="num">Valor</th></tr></thead><tbody>${preview}</tbody></table></div>` : ''}
          ${fresh.length > 60 ? `<p class="hint">Mostrando as 60 primeiras de ${fresh.length}.</p>` : ''}`;
        button.disabled = !fresh.length;
      };
      select.addEventListener('change', refresh);
      refresh();
      button.addEventListener('click', () => {
        const accountId = select.value;
        update((s) => { for (const row of fresh) s.ofxPending.push({ id: uid(), accountId, ...row }); });
        close();
        toast(`${fresh.length} transações aguardando revisão.`);
        ctx.navigate(presetAccountId ? 'cartoes' : 'lancamentos');
      });
    },
  });
}

/** Revisão de uma transação do extrato: só vira lançamento ao confirmar. */
export function reviewOfx(ctx, row) {
  const state = getState();
  const account = state.accounts.find((a) => a.id === row.accountId);
  const onCard = isCard(account);
  const candidates = reviewCandidates(state, row);
  const invoices = onCard ? [] : invoiceImportTargets(state, row);
  const pairs = onCard ? [] : transferCandidates(state, row);
  const guess = candidates.find((i) => Math.abs(i.amount - row.amount) < 0.005) || null;
  const firstCategory = (kind) => state.categories.find((c) => c.kind === kind && !c.archived)?.id;
  const cardCredit = onCard && row.type === 'income';
  const base = {
    type: row.type, description: row.description, amount: row.amount, date: row.date, cardCredit,
    categoryId: guess?.categoryId || firstCategory(cardCredit ? 'expense' : row.type), accountId: row.accountId || defaultMoneyAccount(state),
    personId: guess ? guess.personId : account?.personId || ctx.me, scope: guess?.scope || 'personal',
  };
  const values = { ...movementValues(base), link: guess?.key || '' };
  const fields = movementFields(state, values).filter((f) => f.name !== 'paid');
  const accountName = (id) => state.accounts.find((a) => a.id === id)?.name || 'outra conta';
  const options = [
    ...candidates.map((i) => ({ value: i.key, label: `${i.description} - ${money(i.amount)}${onCard ? ` · fatura ${fmtMonth(i.period || ymOf(i.date))}` : ''}` })),
    ...invoices.map((i) => ({ value: i.key, label: `Fatura ${accountName(i.cardId)} · ${fmtMonth(i.month)} · ${money(i.amount)}${i.payment ? ' (pagamento já registrado)' : ''}` })),
    ...pairs.map((e) => ({ value: `pair:${e.id}`, label: `Transferência ${row.type === 'expense' ? 'para' : 'de'} ${accountName(e.accountId)} · ${fmtDate(e.date)} · ${money(e.amount)}` })),
    ...(cardCredit ? [{ value: 'cardpay', label: 'É o pagamento da fatura (já registrado pela conta do banco): não lançar' }] : []),
  ];
  if (options.length) {
    fields.push({
      name: 'link', label: 'Vincular a uma conta, fatura ou transferência?', type: 'select', full: true,
      options: [{ value: '', label: 'Não, é um lançamento novo' }, ...options],
      hint: onCard
        ? 'Assinatura ou parcela do cartão: vincule para não contar duas vezes. Estorno entra como crédito e abate a fatura.'
        : 'Pagamento de cartão: escolha a fatura. Dinheiro entre contas de vocês: escolha a transferência, e as duas pontas saem dos gastos e da renda. Nada é escolhido automaticamente.',
    });
  }
  const ignoredKey = importKey(row.accountId, row.importId);
  openForm({
    title: 'Revisar transação do extrato',
    eyebrow: `${account ? `${account.name} · ` : ''}${row.memo || 'Extrato OFX'}`,
    fields,
    values,
    submitLabel: 'Confirmar lançamento',
    onSubmit(v) {
      const current = getState();
      if (!current.ofxPending.some((pending) => pending.id === row.id) || splitNewOfx({ ...current, ofxPending: [] }, [row]).duplicates) return 'Esta transação já foi revisada. Reabra a fila do extrato.';
      if (v.link === 'cardpay') {
        update((s) => {
          s.ofxPending = s.ofxPending.filter((x) => x.id !== row.id);
          s.ofxIgnored.push(ignoredKey);
        });
        toast('Pagamento da fatura reconhecido. Nada foi lançado em dobro.', undoAction);
        return;
      }
      const data = readMovement(v, current);
      if (invoices.some((invoice) => invoice.key === v.link)) {
        let change;
        try { change = invoiceImportChange(getState(), row, data, v.link, uid()); }
        catch (error) { return error.message; }
        update((s) => { Object.assign(s, change); });
        toast('Extrato vinculado à fatura, sem duplicar a saída.', undoAction);
        return;
      }
      const pairId = v.link?.startsWith('pair:') ? v.link.slice(5) : null;
      if (pairId && !transferCandidates(current, row).some((e) => e.id === pairId)) return 'A outra ponta da transferência mudou. Reabra a revisão.';
      const linked = candidates.find((i) => i.key === v.link);
      if (v.link && !pairId && (!linked || !reviewCandidates(current, row).some((i) => i.key === v.link))) return 'A conta vinculada mudou. Reabra a revisão antes de confirmar.';
      update((s) => {
        s.ofxPending = s.ofxPending.filter((x) => x.id !== row.id);
        const imported = { paid: true, importId: row.importId, importAccountId: row.accountId };
        if (pairId) {
          const group = uid();
          Object.assign(s.entries.find((e) => e.id === pairId), { transfer: true, transferGroup: group });
          s.entries.push({ id: uid(), ...data, ...imported, transfer: true, transferGroup: group, loan: null });
          return;
        }
        if (linked?.kind === 'entry') {
          Object.assign(s.entries.find((e) => e.id === linked.id), { ...data, ...imported });
          return;
        }
        const source = linked?.kind === 'recurring' ? { kind: 'recurring', id: linked.refId, period: linked.period }
          : linked?.kind === 'installment' ? { kind: 'installment', id: linked.refId, index: linked.index } : null;
        s.entries.push({ id: uid(), ...data, ...imported, ...(source ? { source } : {}) });
      });
      toast(pairId ? 'Transferência confirmada: fora dos gastos e da renda.' : 'Transação confirmada.', undoAction);
    },
    actions: [{
      label: 'Ignorar', danger: true,
      run(close) {
        close();
        update((s) => {
          s.ofxPending = s.ofxPending.filter((x) => x.id !== row.id);
          s.ofxIgnored.push(ignoredKey);
        });
        toast('Transação ignorada.', undoAction);
      },
    }],
  });
}

// ------------------------------------------------------------------ backup

/** Baixa a cópia que ficou guardada de alterações que conflitaram com as de outra pessoa. */
export function downloadRescued(rescue) {
  const blob = new Blob([JSON.stringify(rescue.state, null, 1)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `monetizeo-alteracoes-nao-salvas-${today(new Date(rescue.at))}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export function exportBackup() {
  const blob = new Blob([JSON.stringify(getState(), null, 1)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `monetizeo-backup-${today()}.json`;
  link.click();
  try { localStorage.setItem('monetizeo:lastBackup', today()); } catch { /* sem armazenamento: só não lembra a data */ }
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export async function importBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
    if (data.state && data.rev !== undefined) data = data.state;
    if (!Array.isArray(data.entries)) throw new Error('formato');
  } catch {
    toast('Esse arquivo não é um backup do Monetizeo.');
    return;
  }
  const state = getState();
  const hasData = state.entries.length || state.recurring.length;
  if (hasData) {
    const ok = await confirmDialog({
      title: 'Substituir todos os dados?',
      message: `O backup tem ${data.entries.length} lançamentos${isLegacy(data) ? ' (formato antigo, será convertido)' : ''}. Os dados atuais serão trocados pelos do arquivo.`,
      confirmLabel: 'Substituir', danger: true,
    });
    if (!ok) return;
  }
  replaceAll(data);
  toast('Backup restaurado.', hasData ? undoAction : undefined);
}
