// Conversa com o Supabase: login por e-mail e senha e leitura/gravação da casa.
// Usa só fetch (sem biblioteca), para o app continuar sem dependências.

import { SUPABASE_KEY, SUPABASE_URL } from '../config.js';

const SESSION_KEY = 'monetizeo:session';
const REFRESH_MARGIN = 60; // renova o acesso 1 minuto antes de vencer

export const enabled = Boolean(SUPABASE_URL && SUPABASE_KEY);

let session = null;
try {
  session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
} catch {
  session = null;
}
let refreshing = null;

export class CloudError extends Error {
  constructor(message, { status = 0, code = '' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const MESSAGES = {
  invalid_credentials: 'E-mail ou senha incorretos.',
  email_not_confirmed: 'Este e-mail ainda não foi confirmado.',
  over_request_rate_limit: 'Muitas tentativas. Espere um minuto e tente de novo.',
  codigo_invalido: 'Código de convite não encontrado. Confira com quem criou a casa.',
  ja_tem_casa: 'Esta conta já faz parte de uma casa. Só é possível participar de uma.',
  nao_autenticado: 'Sua sessão expirou. Entre de novo.',
  same_password: 'A nova senha precisa ser diferente da atual.',
  weak_password: 'Senha fraca. Use pelo menos 6 caracteres, misturando letras e números.',
  over_email_send_rate_limit: 'Muitos e-mails enviados. Espere alguns minutos e tente de novo.',
  otp_expired: 'O link expirou ou já foi usado. Peça um novo.',
  reauthentication_needed: 'Por segurança, saia e entre de novo antes de trocar a senha.',
};

function setSession(next) {
  session = next;
  if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
  else localStorage.removeItem(SESSION_KEY);
}

function fromAuth(body) {
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (body.expires_in || 3600),
    email: body.user?.email || session?.email || '',
  };
}

async function call(path, { method = 'GET', body, headers = {}, token = null } = {}) {
  let response;
  try {
    response = await fetch(SUPABASE_URL + path, {
      method,
      cache: 'no-store',
      headers: {
        apikey: SUPABASE_KEY,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new CloudError('Sem conexão com a internet.', { code: 'offline' });
  }
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const code = data?.error_code || data?.code || data?.error || '';
    const raw = data?.message || data?.msg || data?.error_description || '';
    const known = MESSAGES[code] || Object.entries(MESSAGES).find(([key]) => raw.includes(key))?.[1];
    throw new CloudError(known || raw || `Erro ${response.status} ao falar com o servidor.`, { status: response.status, code });
  }
  return data;
}

async function freshToken() {
  if (!session) throw new CloudError(MESSAGES.nao_autenticado, { status: 401, code: 'nao_autenticado' });
  if (session.expires_at - REFRESH_MARGIN > Date.now() / 1000) return session.access_token;
  // Vários pedidos ao mesmo tempo compartilham uma única renovação.
  refreshing ||= call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } })
    .then((body) => setSession(fromAuth(body)))
    .catch((error) => {
      if (error.code !== 'offline') setSession(null);
      throw error.code === 'offline' ? error : new CloudError(MESSAGES.nao_autenticado, { status: 401, code: 'nao_autenticado' });
    })
    .finally(() => { refreshing = null; });
  await refreshing;
  return session.access_token;
}

const authed = async (path, options = {}) => call(path, { ...options, token: await freshToken() });

// ------------------------------------------------------------------- login

export const signedIn = () => !!session;
export const userEmail = () => session?.email || '';

/** Id do usuário logado (campo `sub` do token), para ligar o perfil ao login. */
export function userId() {
  try {
    const part = session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part)).sub || '';
  } catch {
    return '';
  }
}

/** Troca a senha de quem está logado. */
export async function updatePassword(password) {
  await authed('/auth/v1/user', { method: 'PUT', body: { password } });
}

/**
 * Envia o e-mail de "esqueci minha senha". O link volta para este endereço do
 * site (que precisa estar liberado em Authentication > URL Configuration).
 */
export async function recoverPassword(email) {
  const back = location.origin + location.pathname;
  await call(`/auth/v1/recover?redirect_to=${encodeURIComponent(back)}`, { method: 'POST', body: { email } });
}

/**
 * Lê o retorno do link do e-mail (#access_token=...&type=recovery) e abre a
 * sessão. Devolve 'recovery', { error } ou null quando não é retorno de link.
 */
export async function takeAuthRedirect() {
  const hash = location.hash.replace(/^#\/?/, '');
  if (!/access_token=|error_description=/.test(hash)) return null;
  const params = new URLSearchParams(hash);
  history.replaceState(null, '', location.pathname + location.search);
  if (params.get('error_description')) {
    const code = params.get('error_code') || '';
    return { error: MESSAGES[code] || params.get('error_description').replace(/\+/g, ' ') };
  }
  setSession(fromAuth({
    access_token: params.get('access_token'),
    refresh_token: params.get('refresh_token'),
    expires_in: Number(params.get('expires_in')) || 3600,
  }));
  try {
    const user = await authed('/auth/v1/user');
    setSession({ ...session, email: user?.email || '' });
  } catch {
    // e-mail é só para exibir; a troca de senha funciona sem ele
  }
  return params.get('type') === 'recovery' ? 'recovery' : 'signed-in';
}

export async function signIn(email, password) {
  const body = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  setSession(fromAuth(body));
}

export async function signOut() {
  const token = session?.access_token;
  setSession(null);
  if (token) await call('/auth/v1/logout', { method: 'POST', token }).catch(() => {});
}

// -------------------------------------------------------------------- casa

/** A casa de quem está logado (as regras do banco só deixam ver a própria), ou null. */
export async function myHousehold() {
  const rows = await authed('/rest/v1/households?select=id,name,rev,state,invite_code&order=created_at.asc&limit=1');
  return rows?.[0] || null;
}

export async function householdRev(id) {
  const rows = await authed(`/rest/v1/households?select=rev&id=eq.${id}`);
  if (!rows?.length) throw new CloudError('A casa não foi encontrada.', { status: 404 });
  return rows[0].rev;
}

/**
 * Grava só se ninguém gravou desde `baseRev`: o filtro `rev=eq.` faz o banco
 * não alterar nada quando a revisão mudou, e aí devolvemos conflito.
 */
export async function saveHousehold(id, baseRev, state) {
  const rows = await authed(`/rest/v1/households?id=eq.${id}&rev=eq.${baseRev}&select=rev`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: { state, rev: baseRev + 1 },
  });
  return rows?.length ? { saved: true, rev: rows[0].rev } : { saved: false };
}

export const createHousehold = (state = null) => authed('/rest/v1/rpc/create_household', { method: 'POST', body: { p_name: 'Casa', p_state: state } });
export const joinHousehold = (code) => authed('/rest/v1/rpc/join_household', { method: 'POST', body: { p_code: code } });
