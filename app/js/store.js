// Guarda o estado e o mantém em sincronia com onde os dados moram:
//   'cloud'  — Supabase, com login (quando app/config.js tem a chave)
//   'server' — server.py no computador de casa
//   'local'  — só o navegador deste aparelho (app aberto sem servidor)

import * as cloud from './cloud.js';
import { isLegacy, migrateLegacy } from './migrate.js';
import { normalize } from './model.js';

const LOCAL_KEY = 'monetizeo:state';
const CODE_KEY = 'monetizeo:code';
const POLL_MS = 15000;

let state = null;
let rev = 0;
let mode = 'server';
let status = 'ok'; // 'ok' | 'saving' | 'offline'
let saving = false;
let dirty = false;
let lastSnapshot = null;
let remote = null; // { read(), write(baseRev, state), rev() }
let household = null; // modo nuvem: { id, invite }
let pollTimer = null;
const listeners = new Set();
let askCode = async () => null;

export const getState = () => state;
export const getMode = () => mode;
export const getStatus = () => status;
export const getHousehold = () => household;
export const hasData = () => !!state && state.people.length > 0;
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
/** A interface registra aqui como pedir o código de acesso do servidor local. */
export const onCodeNeeded = (fn) => { askCode = fn; };

function emit(reason) {
  for (const fn of listeners) fn(reason);
}

function setStatus(next) {
  if (status === next) return;
  status = next;
  emit('status');
}

function accept(data) {
  if (!data) return null;
  return isLegacy(data) ? migrateLegacy(data) : normalize(data);
}

// ------------------------------------------------------- servidor de casa

async function api(path, options = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const headers = { ...(options.headers || {}), 'X-Monetizeo-Code': localStorage.getItem(CODE_KEY) || '' };
    const response = await fetch(path, { ...options, headers, cache: 'no-store' });
    if (response.status !== 401) return response;
    const code = await askCode(attempt > 0);
    if (!code) throw new Error('Código de acesso não informado.');
    localStorage.setItem(CODE_KEY, code.trim());
  }
  throw new Error('Código de acesso incorreto.');
}

const serverRemote = {
  async read() {
    const response = await api('/api/state');
    if (!response.ok || !(response.headers.get('content-type') || '').includes('json')) throw new Error('sem api');
    return response.json();
  },
  async write(baseRev, data) {
    const response = await api('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseRev, state: data }),
    });
    const body = await response.json();
    if (response.status === 409) return { saved: false };
    if (!response.ok) throw new Error('falha ao gravar');
    return { saved: true, rev: body.rev };
  },
  async rev() {
    return (await (await api('/api/rev')).json()).rev;
  },
};

/** Dados que estão no servidor deste computador, para levar à nuvem na primeira vez. */
export async function readLocalServerState() {
  try {
    const response = await fetch('/api/state', { cache: 'no-store' });
    if (!response.ok || !(response.headers.get('content-type') || '').includes('json')) return null;
    const data = accept((await response.json()).state);
    return data?.people.length ? data : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ nuvem

const cloudRemote = {
  async read() {
    const row = await cloud.myHousehold();
    return row ? { rev: row.rev, state: row.state } : { rev: 0, state: null };
  },
  write: (baseRev, data) => cloud.saveHousehold(household.id, baseRev, data),
  rev: () => cloud.householdRev(household.id),
};

function sessionLost(error) {
  if (mode !== 'cloud' || error?.status !== 401) return false;
  clearInterval(pollTimer);
  emit('signed-out');
  return true;
}

async function openCloudHousehold() {
  const row = await cloud.myHousehold();
  if (!row) return 'setup';
  household = { id: row.id, invite: row.invite_code };
  rev = row.rev;
  state = accept(row.state) || normalize({});
  startPolling();
  return 'ready';
}

/** Cria a casa na nuvem (opcionalmente já com dados) e abre. */
export async function createCloudHousehold(initial = null) {
  await cloud.createHousehold(initial);
  return openCloudHousehold();
}

export async function joinCloudHousehold(code) {
  await cloud.joinHousehold(code);
  return openCloudHousehold();
}

export async function signOut() {
  clearInterval(pollTimer);
  await cloud.signOut();
}

// -------------------------------------------------------------- carregar

/** Devolve 'ready', 'login' (precisa entrar) ou 'setup' (logado, mas sem casa ainda). */
export async function load() {
  clearInterval(pollTimer);
  state = normalize({});
  if (cloud.enabled) {
    mode = 'cloud';
    remote = cloudRemote;
    if (!cloud.signedIn()) return 'login';
    try {
      return await openCloudHousehold();
    } catch (error) {
      if (error.status === 401) return 'login';
      throw error;
    }
  }
  try {
    const body = await serverRemote.read();
    mode = 'server';
    remote = serverRemote;
    rev = body.rev;
    state = accept(body.state) || normalize({});
    startPolling();
  } catch (error) {
    if (/Código/.test(error.message)) throw error;
    mode = 'local';
    remote = null;
    state = accept(JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null')) || normalize({});
  }
  return 'ready';
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(poll, POLL_MS);
}

// ---------------------------------------------------------------- alterar

/**
 * Único caminho para alterar dados: recebe uma função que muda o estado,
 * grava e avisa a interface. Guarda uma cópia anterior para o "Desfazer".
 */
export function update(mutator) {
  lastSnapshot = JSON.stringify(state);
  mutator(state);
  persist();
  emit('change');
}

export function undo() {
  if (!lastSnapshot) return false;
  state = JSON.parse(lastSnapshot);
  lastSnapshot = null;
  persist();
  emit('change');
  return true;
}

export function replaceAll(next) {
  lastSnapshot = JSON.stringify(state);
  state = accept(next);
  persist();
  emit('change');
}

function persist() {
  if (mode === 'local') {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
    return;
  }
  dirty = true;
  flush();
}

async function flush() {
  if (saving || !dirty) return;
  saving = true;
  setStatus('saving');
  while (dirty) {
    dirty = false;
    try {
      const result = await remote.write(rev, state);
      if (!result.saved) {
        // A outra pessoa gravou antes: ficamos com a versão dela para não apagar nada.
        await pull();
        emit('conflict');
        break;
      }
      rev = result.rev;
      setStatus('ok');
    } catch (error) {
      if (sessionLost(error)) break;
      dirty = true;
      setStatus('offline');
      setTimeout(flush, 4000);
      break;
    }
  }
  saving = false;
}

async function pull() {
  const body = await remote.read();
  rev = body.rev;
  state = accept(body.state) || normalize({});
  lastSnapshot = null;
  dirty = false;
  setStatus('ok');
}

async function poll() {
  if (document.hidden || saving || dirty) return;
  try {
    const current = await remote.rev();
    if (status === 'offline') setStatus('ok');
    if (current !== rev) {
      await pull();
      emit('remote');
    }
  } catch (error) {
    if (!sessionLost(error)) setStatus('offline');
  }
}
