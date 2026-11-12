// Guarda o estado e o mantém em sincronia com onde os dados moram:
//   'cloud'  — Supabase, com login (quando app/config.js tem a chave)
//   'server' — server.py no computador de casa
//   'local'  — só o navegador deste aparelho (app aberto sem servidor)
//
// Regra de ouro: uma alteração feita pelo usuário nunca se perde em silêncio.
//   - Sem internet, a alteração fica guardada no aparelho (PENDING_KEY) e é enviada
//     quando a conexão volta, mesmo que o app seja fechado e reaberto.
//   - Se outra pessoa salvou no meio tempo, as duas versões são juntadas item por item
//     (merge.js). Quando os dois mexeram no mesmo item, fica a versão dela e uma cópia
//     da nossa vai para RESCUED_KEY, visível em Ajustes.

import * as cloud from './cloud.js';
import { mergeStates, same } from './merge.js';
import { isLegacy, migrateLegacy } from './migrate.js';
import { normalize } from './model.js';

const LOCAL_KEY = 'monetizeo:state';
const CODE_KEY = 'monetizeo:code';
const PENDING_KEY = 'monetizeo:pending';
const RESCUED_KEY = 'monetizeo:rescued';
const POLL_MS = 15000;
const RETRY_MS = 4000;
const MAX_CONFLICT_ROUNDS = 5;
const MAX_RESCUED = 3;

let state = null;
let rev = 0;
let synced = null; // JSON do estado como está no servidor: a base para juntar alterações
let scope = null; // onde os dados moram: 'cloud:<id da casa>' ou 'server'
let mode = 'server';
let status = 'ok'; // 'ok' | 'saving' | 'offline'
let saving = false;
let dirty = false;
let lastSnapshot = null;
let remote = null; // { read(), write(baseRev, state), rev() }
let household = null; // modo nuvem: { id, invite }
let pollTimer = null;
let retryTimer = null;
let notice = null;
const listeners = new Set();
let askCode = async () => null;

export const getState = () => state;
export const getMode = () => mode;
export const getStatus = () => status;
export const getHousehold = () => household;
export const hasData = () => !!state && state.people.length > 0;
/** Há alteração deste aparelho ainda não confirmada pelo servidor. */
export const hasUnsynced = () => dirty || saving;
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
/** A interface registra aqui como pedir o código de acesso do servidor local. */
export const onCodeNeeded = (fn) => { askCode = fn; };
/** Aviso único para mostrar depois que a tela abre (ex.: "recuperei suas alterações"). */
export const takeNotice = () => { const n = notice; notice = null; return n; };

function emit(reason, detail) {
  for (const fn of listeners) fn(reason, detail);
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

// ---------------------------------------------------- armazenamento do aparelho

const readKey = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
};
const writeKey = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // sem espaço ou bloqueado: o app continua, só não guarda cópia
  }
};
const dropKey = (key) => {
  try {
    localStorage.removeItem(key);
  } catch {
    // nada a fazer
  }
};

function later(fn, ms) {
  const timer = setTimeout(fn, ms);
  timer?.unref?.();
  return timer;
}

function savePending() {
  if (!scope || synced === null) return;
  writeKey(PENDING_KEY, { scope, baseRev: rev, savedAt: Date.now(), base: JSON.parse(synced), mine: state });
}

function rescue(copy, reason) {
  const list = readKey(RESCUED_KEY) || [];
  list.unshift({ at: Date.now(), reason, state: copy });
  writeKey(RESCUED_KEY, list.slice(0, MAX_RESCUED));
}

/** Cópias de alterações que conflitaram com as de outra pessoa (mais nova primeiro). */
export const listRescued = () => (readKey(RESCUED_KEY) || []).map((r) => ({
  at: r.at, reason: r.reason, entries: r.state?.entries?.length || 0, state: r.state,
}));

export function removeRescued(at) {
  writeKey(RESCUED_KEY, (readKey(RESCUED_KEY) || []).filter((r) => r.at !== at));
  emit('change');
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
  adopt(`cloud:${row.id}`);
  startPolling();
  return 'ready';
}

/** Cria a casa na nuvem (opcionalmente já com dados) e abre. Se a conta já tem casa, abre a dela. */
export async function createCloudHousehold(initial = null) {
  await cloud.createHousehold(initial);
  return openCloudHousehold();
}

/** Entra na casa de convite. Uma conta só pode fazer parte de uma casa (o banco também impede). */
export async function joinCloudHousehold(code) {
  const current = await cloud.myHousehold();
  if (current) {
    if (current.invite_code === String(code).trim().toLowerCase()) return openCloudHousehold();
    throw new cloud.CloudError('Esta conta já faz parte de uma casa. Só é possível participar de uma.', { code: 'ja_tem_casa' });
  }
  await cloud.joinHousehold(code);
  return openCloudHousehold();
}

export async function signOut() {
  stop();
  await cloud.signOut();
}

// -------------------------------------------------------------- carregar

/** Marca de onde vieram os dados e recupera o que ficou sem salvar da última vez. */
function adopt(scopeKey) {
  scope = scopeKey;
  synced = JSON.stringify(state);
  const pending = readKey(PENDING_KEY);
  if (!pending || pending.scope !== scopeKey) return;
  try {
    const mine = accept(pending.mine);
    if (same(mine, state)) {
      dropKey(PENDING_KEY);
      return;
    }
    if (pending.baseRev === rev) {
      state = mine; // ninguém mais salvou: basta enviar
      notice = 'Recuperei as alterações que você fez sem conexão. Estou salvando agora.';
    } else {
      const { merged, conflicts } = mergeStates(accept(pending.base), mine, state);
      if (conflicts.length) rescue(mine, 'Feitas neste aparelho sem conexão; outra pessoa mexeu nos mesmos itens.');
      state = merged;
      notice = conflicts.length
        ? `Recuperei suas alterações sem conexão, mas ${conflicts.length} item(ns) também foram mudados por outra pessoa; ficou a versão dela. Uma cópia da sua está em Ajustes.`
        : 'Recuperei suas alterações sem conexão e juntei com as da outra pessoa.';
    }
    dirty = true;
  } catch {
    dropKey(PENDING_KEY);
  }
}

/** Devolve 'ready', 'login' (precisa entrar) ou 'setup' (logado, mas sem casa ainda). */
export async function load() {
  stop();
  state = normalize({});
  if (cloud.enabled) {
    mode = 'cloud';
    remote = cloudRemote;
    if (!cloud.signedIn()) return 'login';
    try {
      const result = await openCloudHousehold();
      if (dirty) flush();
      return result;
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
    adopt('server');
    startPolling();
    if (dirty) flush();
  } catch (error) {
    if (/Código/.test(error.message)) throw error;
    mode = 'local';
    remote = null;
    state = accept(readKey(LOCAL_KEY)) || normalize({});
  }
  return 'ready';
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(poll, POLL_MS);
  pollTimer?.unref?.();
}

/** Para os temporizadores (ao sair da conta e nos testes). */
export function stop() {
  clearInterval(pollTimer);
  clearTimeout(retryTimer);
}

if (typeof window !== 'undefined') {
  // Quando a internet volta, envia na hora em vez de esperar o próximo ciclo.
  window.addEventListener('online', () => { if (dirty) flush(); });
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
    writeKey(LOCAL_KEY, state);
    return;
  }
  dirty = true;
  savePending(); // antes de qualquer rede: se o app fechar agora, nada se perde
  flush();
}

async function flush() {
  if (saving || !dirty) return;
  saving = true;
  setStatus('saving');
  let conflictRounds = 0;
  while (dirty) {
    dirty = false;
    const snapshot = JSON.stringify(state);
    try {
      const result = await remote.write(rev, JSON.parse(snapshot));
      if (result.saved) {
        rev = result.rev;
        synced = snapshot;
        conflictRounds = 0;
        setStatus('ok');
        if (dirty) savePending(); // mudou durante o envio: renova a base guardada
        continue;
      }
      // Outra pessoa salvou antes de nós: junta as duas versões e envia de novo.
      if (++conflictRounds > MAX_CONFLICT_ROUNDS) throw new Error('conflitos seguidos');
      await mergeWithRemote();
    } catch (error) {
      dirty = true; // continua pendente, e guardado no aparelho
      if (!sessionLost(error)) {
        setStatus('offline');
        clearTimeout(retryTimer);
        retryTimer = later(flush, RETRY_MS);
      }
      break;
    }
  }
  saving = false;
  if (!dirty) dropKey(PENDING_KEY);
}

async function mergeWithRemote() {
  const body = await remote.read();
  const theirs = accept(body.state) || normalize({});
  const { merged, conflicts } = mergeStates(JSON.parse(synced), state, theirs);
  if (conflicts.length) rescue(state, 'Outra pessoa mexeu nos mesmos itens ao mesmo tempo.');
  state = merged;
  rev = body.rev;
  synced = JSON.stringify(theirs);
  lastSnapshot = null;
  dirty = true;
  savePending();
  emit('merged', { conflicts: conflicts.length });
}

async function pull() {
  const body = await remote.read();
  rev = body.rev;
  state = accept(body.state) || normalize({});
  synced = JSON.stringify(state);
  lastSnapshot = null;
  setStatus('ok');
}

async function poll() {
  if ((typeof document !== 'undefined' && document.hidden) || saving || dirty) return;
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
