// Peças de interface reutilizadas: ícones, aviso rápido (toast), diálogos e formulários.

import { esc, money, parseMoney } from './util.js';

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.5 4.5L20 16"/><path d="M20 20v-4h-4"/>',
  wallet: '<path d="M4 7a2 2 0 0 1 2-2h11v4"/><path d="M4 7v11a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2Z"/><path d="M16 14.5h.01"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/>',
  house: '<path d="M4 21V8l8-5 8 5v13"/><path d="M9 21v-6h6v6"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  left: '<path d="m15 5-7 7 7 7"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  upload: '<path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M4 17v3h16v-3"/>',
  alert: '<path d="M12 4 2.5 20h19L12 4z"/><path d="M12 10v5M12 17.5h.01"/>',
  repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  chat: '<path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.7-3.4A7.5 7.5 0 1 1 20 11.5Z"/><path d="M8.5 11.5h.01M12.5 11.5h.01M16.5 11.5h.01"/>',
};

export function icon(name, size = 18) {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

// ------------------------------------------------------------------ toast

let toastTimer;
export function toast(message, action) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  el.querySelector('button')?.addEventListener('click', () => {
    el.classList.remove('show');
    action.run();
  });
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 7000 : 3500);
}

// --------------------------------------------------------------- diálogos

/**
 * Abre um diálogo modal. `body` é HTML; `onMount(dialog, close)` liga os eventos.
 * Devolve uma função que fecha o diálogo.
 */
export function openDialog({ title, eyebrow = '', body, onMount, wide = false }) {
  const dialog = document.createElement('dialog');
  dialog.className = `dialog${wide ? ' wide' : ''}`;
  dialog.innerHTML = `
    <header class="dialog-head">
      <div>${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}<h2>${esc(title)}</h2></div>
      <button type="button" class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button>
    </header>
    <div class="dialog-body">${body}</div>`;
  document.body.append(dialog);
  const close = () => dialog.close();
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog || event.target.closest('[data-close]')) close();
  });
  dialog.showModal();
  onMount?.(dialog, close);
  return close;
}

export function confirmDialog({ title, message, confirmLabel = 'Confirmar', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    openDialog({
      title,
      body: `<p class="dialog-text">${esc(message)}</p>
        <footer class="dialog-actions">
          <button type="button" class="btn" data-close>Cancelar</button>
          <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(confirmLabel)}</button>
        </footer>`,
      onMount(dialog, close) {
        dialog.querySelector('[data-ok]').addEventListener('click', () => {
          answer = true;
          close();
        });
        dialog.addEventListener('close', () => resolve(answer));
      },
    });
  });
}

// ------------------------------------------------------------ formulários

function fieldHtml(field, value) {
  const id = `f-${field.name}`;
  const required = field.required ? 'required' : '';
  const hint = field.hint ? `<small class="hint">${esc(field.hint)}</small>` : '';
  const wrap = (control) => `<label class="field${field.full ? ' full' : ''}" data-field="${field.name}"><span>${esc(field.label)}</span>${control}${hint}</label>`;
  switch (field.type) {
    case 'select':
      return wrap(`<select id="${id}" name="${field.name}" ${required}>${field.options
        .map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(value ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`)
        .join('')}</select>`);
    case 'segmented':
      return `<fieldset class="field full" data-field="${field.name}"><legend>${esc(field.label)}</legend><div class="segmented">${field.options
        .map((o) => `<label><input type="radio" name="${field.name}" value="${esc(o.value)}" ${String(o.value) === String(value ?? '') ? 'checked' : ''}><span>${esc(o.label)}</span></label>`)
        .join('')}</div>${hint}</fieldset>`;
    case 'picker': {
      // Grade de opções visuais. Opções com `group` viram abas; sem grupo, aparecem sempre (ex.: "Inicial").
      const groups = [...new Set(field.options.map((o) => o.group).filter(Boolean))];
      const selected = field.options.find((o) => String(o.value) === String(value ?? ''));
      const current = selected?.group || groups[0];
      const tabs = groups.length > 1 ? `<div class="segmented compact picker-tabs" role="tablist">${groups.map((g) => `<button type="button" role="tab" data-picker-tab="${esc(g)}" class="${g === current ? 'on' : ''}" aria-selected="${g === current}">${esc(g)}</button>`).join('')}</div>` : '';
      return `<fieldset class="field full picker" data-field="${field.name}"><legend>${esc(field.label)}</legend>${tabs}<div class="picker-grid">${field.options
        .map((o) => `<label title="${esc(o.label)}" ${o.group ? `data-group="${esc(o.group)}"` : ''} ${o.group && groups.length > 1 && o.group !== current ? 'hidden' : ''}><input type="radio" name="${field.name}" value="${esc(o.value)}" ${String(o.value) === String(value ?? '') ? 'checked' : ''}><span class="picker-art">${o.html || ''}</span><small>${esc(o.label)}</small></label>`)
        .join('')}</div>${hint}</fieldset>`;
    }
    case 'swatches':
      // Cores prontas em bolinhas; a atual entra na lista se não for uma delas.
      return `<fieldset class="field full" data-field="${field.name}"><legend>${esc(field.label)}</legend><div class="swatches">${[...field.options, ...(value && !field.options.some((o) => o.value.toLowerCase() === String(value).toLowerCase()) ? [{ value, label: 'Cor atual' }] : [])]
        .map((o) => `<label title="${esc(o.label)}"><input type="radio" name="${field.name}" value="${esc(o.value)}" ${String(o.value).toLowerCase() === String(value ?? '').toLowerCase() ? 'checked' : ''} aria-label="${esc(o.label)}"><i style="background:${esc(o.value)}"></i></label>`)
        .join('')}</div>${hint}</fieldset>`;
    case 'checkbox':
      return `<label class="field checkbox full" data-field="${field.name}"><input type="checkbox" name="${field.name}" ${value ? 'checked' : ''}><span>${esc(field.label)}</span>${hint}</label>`;
    case 'money':
      return wrap(`<input id="${id}" name="${field.name}" inputmode="decimal" autocomplete="off" placeholder="${esc(field.placeholder || '0,00')}" value="${value || value === 0 ? esc(money(value).replace(/^R\$\s?/, '')) : ''}" ${required}>`);
    case 'number':
      return wrap(`<input id="${id}" name="${field.name}" type="number" inputmode="numeric" min="${field.min ?? ''}" max="${field.max ?? ''}" step="${field.step ?? 1}" value="${esc(value ?? '')}" ${required}>`);
    case 'date':
    case 'month':
    case 'color':
      return wrap(`<input id="${id}" name="${field.name}" type="${field.type}" value="${esc(value ?? '')}" ${required}>`);
    case 'password':
      return wrap(`<input id="${id}" name="${field.name}" type="password" autocomplete="new-password" value="" ${required}>`);
    default:
      return wrap(`<input id="${id}" name="${field.name}" type="text" autocomplete="off" placeholder="${esc(field.placeholder || '')}" value="${esc(value ?? '')}" ${required}>`);
  }
}

function readForm(form, fields) {
  const values = {};
  for (const field of fields) {
    const control = form.elements[field.name];
    if (!control) continue;
    if (field.type === 'checkbox') values[field.name] = control.checked;
    else if (field.type === 'money') values[field.name] = control.value.trim() === '' ? null : parseMoney(control.value);
    else if (field.type === 'number') values[field.name] = control.value === '' ? null : Number(control.value);
    else if (field.type === 'password') values[field.name] = control.value;
    else values[field.name] = typeof control.value === 'string' ? control.value.trim() : control.value;
  }
  return values;
}

/**
 * Formulário em diálogo.
 * fields: [{ name, label, type, options, required, hint, full, showIf(values) }]
 * onSubmit(values) pode devolver uma mensagem de erro (string) para manter o diálogo aberto.
 * actions: botões extras [{ label, danger, run(close) }].
 */
export function openForm({ title, eyebrow, fields, values = {}, submitLabel = 'Salvar', onSubmit, actions = [], intro = '', autoFocus = true }) {
  const body = `
    <form class="form" novalidate>
      ${intro ? `<p class="dialog-text">${intro}</p>` : ''}
      <div class="form-grid">${fields.map((f) => fieldHtml(f, values[f.name])).join('')}</div>
      <p class="form-error" role="alert" hidden></p>
      <footer class="dialog-actions">
        ${actions.map((a, i) => `<button type="button" class="btn ${a.danger ? 'danger-ghost' : ''}" data-extra="${i}">${esc(a.label)}</button>`).join('')}
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancelar</button>
        <button type="submit" class="btn primary">${esc(submitLabel)}</button>
      </footer>
    </form>`;
  return openDialog({
    title,
    eyebrow,
    body,
    onMount(dialog, close) {
      const form = dialog.querySelector('form');
      const error = form.querySelector('.form-error');
      const refresh = () => {
        const current = readForm(form, fields);
        for (const field of fields) {
          if (!field.showIf) continue;
          const el = form.querySelector(`[data-field="${field.name}"]`);
          el.hidden = !field.showIf(current);
        }
      };
      // Abas dos seletores visuais: só mostram/escondem opções, não mudam o valor.
      form.querySelectorAll('[data-picker-tab]').forEach((tab) => tab.addEventListener('click', () => {
        const box = tab.closest('.picker');
        box.querySelectorAll('[data-picker-tab]').forEach((t) => { t.classList.toggle('on', t === tab); t.setAttribute('aria-selected', t === tab); });
        box.querySelectorAll('label[data-group]').forEach((l) => { l.hidden = l.dataset.group !== tab.dataset.pickerTab; });
      }));
      form.addEventListener('input', refresh);
      form.addEventListener('change', refresh);
      refresh();
      if (autoFocus) form.querySelector('input:not([type=radio]):not([type=checkbox]), select')?.focus();

      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const current = readForm(form, fields);
        let message = '';
        for (const field of fields) {
          if (field.showIf && !field.showIf(current)) continue;
          const value = current[field.name];
          if (field.required && (value === '' || value === null || value === undefined)) message = `Preencha "${field.label}".`;
          else if (field.type === 'money' && value !== null && (!Number.isFinite(value) || (value < 0 && !field.allowNegative))) message = `"${field.label}" precisa ser um valor válido.`;
          else if (field.type === 'money' && field.required && !(value > 0) && !field.allowZero) message = `"${field.label}" precisa ser maior que zero.`;
          if (message) break;
        }
        message = message || onSubmit(current) || '';
        if (message) {
          error.textContent = message;
          error.hidden = false;
          return;
        }
        close();
      });
      actions.forEach((action, i) => {
        form.querySelector(`[data-extra="${i}"]`).addEventListener('click', () => action.run(close));
      });
    },
  });
}

/** Barra de progresso simples; `over` pinta de vermelho quando passa de 100%. */
export function bar(fraction, { tone = '' } = {}) {
  const pct = Math.max(0, Math.min(1, fraction || 0)) * 100;
  return `<div class="bar ${tone}"><i style="width:${pct.toFixed(1)}%"></i></div>`;
}
