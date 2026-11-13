import { buildAssistantContext } from '../assistant-context.js';
import * as cloud from '../cloud.js';
import { getMode } from '../store.js';
import { esc } from '../util.js';

const MAX_QUESTION = 500;
const MAX_HISTORY = 6;
let messages = [];
let activeUser = '';

function consentKey() {
  return `monetizeo:gemini-consent:${cloud.userId()}`;
}

function hasConsent() {
  try { return localStorage.getItem(consentKey()) === 'yes'; } catch { return false; }
}

function rememberConsent() {
  try { localStorage.setItem(consentKey(), 'yes'); } catch { /* sessão atual continua */ }
}

function forgetConsent() {
  try { localStorage.removeItem(consentKey()); } catch { /* nada a fazer */ }
}

function renderMessage(message) {
  const article = document.createElement('article');
  article.className = `assistant-message ${message.role}`;
  const label = document.createElement('small');
  label.textContent = message.role === 'user' ? 'Você' : 'Moneti-bot';
  const text = document.createElement('p');
  text.textContent = message.text;
  article.append(label, text);
  return article;
}

function paintMessages(root) {
  const list = root.querySelector('[data-chat-messages]');
  list.replaceChildren(...messages.map(renderMessage));
  list.scrollTop = list.scrollHeight;
}

function append(root, role, text) {
  const message = { role, text };
  messages.push(message);
  if (messages.length > 12) messages = messages.slice(-12);
  root.querySelector('[data-chat-messages]').append(renderMessage(message));
  root.querySelector('[data-chat-messages]').scrollTop = root.querySelector('[data-chat-messages]').scrollHeight;
}

async function appendTyping(root, text) {
  const message = { role: 'assistant', text };
  messages.push(message);
  if (messages.length > 12) messages = messages.slice(-12);
  const article = renderMessage({ ...message, text: '' });
  const paragraph = article.querySelector('p');
  const list = root.querySelector('[data-chat-messages]');
  list.append(article);
  const words = text.match(/\S+\s*/g) || [text];
  const delay = Math.min(32, 4500 / words.length);
  for (const word of words) {
    paragraph.textContent += word;
    list.scrollTop = list.scrollHeight;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

export function render(ctx) {
  const signedIn = getMode() === 'cloud' && cloud.signedIn();
  const consented = signedIn && hasConsent();
  return `
    <section class="card assistant-card">
      <header class="card-head"><h2>Moneti-bot</h2><span class="muted">${esc(ctx.ym)}</span></header>
      <p class="muted">Seu assistente para entender os totais e previsões do Monetizeo.</p>
      ${!signedIn ? '<p class="notice">O assistente funciona quando a casa está conectada à nuvem e você entrou na sua conta.</p>' : `
        ${!consented ? `<aside class="notice assistant-privacy">
          Ao enviar uma pergunta, o Monetizeo envia ao Google sua pergunta e um resumo financeiro agregado do mês e do mês anterior. Não envia nomes de pessoas, nomes de contas nem descrições de compras. No nível gratuito do Gemini, o Google pode usar o conteúdo enviado para melhorar os produtos.
          <label class="assistant-consent"><input type="checkbox" data-consent> Li e concordo em enviar esses resumos ao Gemini para responder minhas perguntas.</label>
        </aside>` : '<div class="assistant-connected"><span>Conectado ao Gemini</span><button type="button" class="link-btn" data-revoke>Desconectar</button></div>'}
        <div class="assistant-suggestions" aria-label="Perguntas sugeridas">
          <button type="button" class="btn small" data-suggest="O que mais pesou nos gastos deste mês?">O que mais pesou?</button>
          <button type="button" class="btn small" data-suggest="Como este mês se compara com o mês anterior?">Comparar os meses</button>
          <button type="button" class="btn small" data-suggest="Quanto ainda está previsto para sair neste mês?">O que ainda sai?</button>
        </div>
        <div class="assistant-messages" data-chat-messages aria-live="polite" aria-label="Conversa com o assistente"></div>
        <form class="assistant-form" data-chat-form>
          <label class="sr-only" for="assistant-question">Sua pergunta</label>
          <textarea id="assistant-question" name="question" rows="2" maxlength="${MAX_QUESTION}" placeholder="Ex.: O que aumentou em relação ao mês passado?" required ${!consented ? 'disabled' : ''}></textarea>
          <button type="submit" class="btn primary" ${!consented ? 'disabled' : ''}>Perguntar</button>
        </form>
        <p class="muted assistant-footnote">A conversa fica apenas na memória desta página e desaparece ao recarregar. O assistente não altera seus dados.</p>
      `}
    </section>`;
}

export function mount(root, ctx) {
  const user = cloud.userId();
  if (user !== activeUser) {
    activeUser = user;
    messages = [];
  }
  if (user && !messages.length) messages = [{ role: 'assistant', text: 'Oi! Posso explicar os totais e previsões do mês selecionado.' }];
  if (!root.querySelector('[data-chat-messages]')) return;
  paintMessages(root);

  root.querySelectorAll('[data-suggest]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = root.querySelector('[name="question"]');
      if (input) { input.value = button.dataset.suggest; input.focus(); }
    });
  });

  root.querySelector('[data-consent]')?.addEventListener('change', (event) => {
    if (!event.target.checked) return;
    rememberConsent();
    ctx.rerender();
  });

  root.querySelector('[data-revoke]')?.addEventListener('click', () => {
    forgetConsent();
    messages = [];
    ctx.rerender();
  });

  root.querySelector('[data-chat-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!hasConsent()) return;
    const form = event.currentTarget;
    const input = form.querySelector('[name="question"]');
    const question = input.value.trim().slice(0, MAX_QUESTION);
    if (!question) return;
    const prior = messages.slice(-MAX_HISTORY).map(({ role, text }) => ({ role: role === 'assistant' ? 'model' : 'user', text }));
    append(root, 'user', question);
    input.value = '';
    input.disabled = true;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    submit.textContent = 'Pensando…';
    const status = document.createElement('p');
    status.className = 'assistant-loading muted';
    status.setAttribute('role', 'status');
    status.textContent = 'Consultando o resumo deste mês…';
    root.querySelector('[data-chat-messages]').append(status);
    try {
      const context = buildAssistantContext(ctx.state, ctx.ym, ctx.today);
      const result = await cloud.askAssistant({ consent: true, question, history: prior, context });
      status.remove();
      await appendTyping(root, result.answer || 'Não consegui montar uma resposta. Tente reformular a pergunta.');
    } catch (error) {
      status.remove();
      append(root, 'assistant', error.message || 'Não consegui acessar o assistente agora. Tente novamente mais tarde.');
    } finally {
      input.disabled = false;
      submit.disabled = false;
      submit.textContent = 'Perguntar';
      input.focus();
    }
  });
}
