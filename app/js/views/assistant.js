import { buildAssistantContext } from '../assistant-context.js';
import { hasAssistantConsent } from '../assistant-consent.js';
import * as cloud from '../cloud.js';
import { getMode } from '../store.js';
import { esc } from '../util.js';

const MAX_QUESTION = 500;
const MAX_HISTORY = 6;
let messages = [];
let activeUser = '';

function cleanAssistantText(value) {
  return value.replace(/\*\*(.*?)\*\*/g, '$1').replace(/^\s*\*\s*/gm, '• ');
}

function renderMessage(message) {
  const article = document.createElement('article');
  article.className = `assistant-message ${message.role}`;
  const label = document.createElement('small');
  label.textContent = message.role === 'user' ? 'Você' : 'Moneti-bot';
  const text = document.createElement('p');
  text.textContent = message.role === 'assistant' ? cleanAssistantText(message.text) : message.text;
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
  text = cleanAssistantText(text);
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
  const user = cloud.userId();
  if (user !== activeUser) {
    activeUser = user;
    messages = [];
  }
  const signedIn = getMode() === 'cloud' && cloud.signedIn();
  const consented = signedIn && hasAssistantConsent();
  if (!signedIn || !consented) {
    return `<section class="assistant-gate"><div class="assistant-gate-mark">M</div><h2>Moneti-bot</h2>
      <p>${!signedIn ? 'Entre na sua conta da nuvem para conversar.' : 'Ative o Moneti-bot em Ajustes para iniciar uma conversa.'}</p>
      <a class="btn primary" href="#/ajustes">Abrir Ajustes</a></section>`;
  }

  const hasUserMessage = messages.some((message) => message.role === 'user');
  return `<section class="assistant-page${hasUserMessage ? ' has-messages' : ''}">
    ${!hasUserMessage ? `<div class="assistant-welcome" data-welcome>
      <div class="assistant-welcome-icon">M</div>
      <h2>Oi, sou o Moneti-bot</h2>
      <p>Posso te ajudar a entender seus números de ${esc(ctx.ym)}. O que você quer saber?</p>
      <div class="assistant-suggestions" aria-label="Sugestões de perguntas">
        <button type="button" class="btn small" data-suggest="O que mais pesou nos gastos deste mês?">O que mais pesou?</button>
        <button type="button" class="btn small" data-suggest="Como este mês se compara com o mês anterior?">Comparar os meses</button>
        <button type="button" class="btn small" data-suggest="Quanto ainda está previsto para sair neste mês?">O que ainda sai?</button>
      </div>
    </div>` : ''}
    <div class="assistant-messages" data-chat-messages aria-live="polite" aria-label="Conversa com o Moneti-bot"></div>
    <form class="assistant-composer" data-chat-form>
      <label class="sr-only" for="assistant-question">Sua mensagem</label>
      <textarea id="assistant-question" name="question" rows="1" maxlength="${MAX_QUESTION}" placeholder="Escreva uma mensagem…" required></textarea>
      <button type="submit" class="assistant-send" aria-label="Enviar mensagem">↑</button>
    </form>
  </section>`;
}

export function mount(root, ctx) {
  const user = cloud.userId();
  if (user !== activeUser) {
    activeUser = user;
    messages = [];
  }
  if (!user) messages = [];
  if (!root.querySelector('[data-chat-messages]')) return;
  paintMessages(root);

  root.querySelectorAll('[data-suggest]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = root.querySelector('[name="question"]');
      if (input) { input.value = button.dataset.suggest; input.focus(); }
    });
  });

  root.querySelector('[data-chat-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!hasAssistantConsent()) return;
    const form = event.currentTarget;
    const input = form.querySelector('[name="question"]');
    const question = input.value.trim().slice(0, MAX_QUESTION);
    if (!question) return;
    const prior = messages.slice(-MAX_HISTORY).map(({ role, text }) => ({ role: role === 'assistant' ? 'model' : 'user', text }));
    root.querySelector('[data-welcome]')?.remove();
    root.querySelector('.assistant-page')?.classList.add('has-messages');
    append(root, 'user', question);
    input.value = '';
    input.style.height = '';
    input.disabled = true;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    submit.textContent = '…';
    submit.setAttribute('aria-label', 'Moneti-bot está respondendo');
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
      submit.textContent = '↑';
      submit.setAttribute('aria-label', 'Enviar mensagem');
    }
  });

  root.querySelector('[name="question"]')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      root.querySelector('[data-chat-form]')?.requestSubmit();
    }
  });
  root.querySelector('[name="question"]')?.addEventListener('input', (event) => {
    const input = event.currentTarget;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  });
}

export function clearConversation() {
  messages = [];
  activeUser = cloud.userId();
}
