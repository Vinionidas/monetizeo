// Testa a camada de dados de ponta a ponta contra um "Supabase" falso em memória:
// internet que cai, app fechado e reaberto, e outra pessoa salvando no meio tempo.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const SESSION = { access_token: 't', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, email: 'a@b.c' };
let instances = 0;

const base = (entries = []) => ({
  schema: 1,
  people: [{ id: 'p1', name: 'Ana' }],
  accounts: [{ id: 'banco', name: 'Banco', type: 'bank' }],
  categories: [{ id: 'c', name: 'Mercado', kind: 'expense' }],
  entries,
  recurring: [], installments: [], goals: [], debts: [], invoicePayments: [], settlements: [], ofxPending: [], ofxIgnored: [],
  split: { mode: 'equal', shares: {} },
});
const entry = (id, amount = 10) => ({ id, date: '2026-11-11', description: `Gasto ${id}`, amount, type: 'expense', categoryId: 'c', accountId: 'banco', scope: 'personal', paid: true });

/** Servidor falso + armazenamento do aparelho. `server` é o que o Supabase guardaria. */
function world(state = base(), rev = 1) {
  const storage = new Map();
  storage.set('monetizeo:session', JSON.stringify(SESSION));
  globalThis.localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => void storage.set(k, String(v)),
    removeItem: (k) => void storage.delete(k),
  };
  globalThis.document = { hidden: false };
  const server = { id: 'casa1', rev, state, invite_code: 'abc123', online: true, writes: 0 };
  globalThis.fetch = async (url, options = {}) => {
    if (!server.online) throw new TypeError('sem internet');
    const u = new URL(url);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
    const method = options.method || 'GET';
    if (u.pathname !== '/rest/v1/households') throw new Error(`rota inesperada: ${url}`);
    if (method === 'GET') {
      if (u.searchParams.get('select') === 'rev') return json([{ rev: server.rev }]);
      return json([{ id: server.id, name: 'Casa', rev: server.rev, state: server.state, invite_code: server.invite_code }]);
    }
    if (method === 'PATCH') {
      if (Number(u.searchParams.get('rev').replace('eq.', '')) !== server.rev) return json([]); // alguém salvou antes
      const body = JSON.parse(options.body);
      server.state = body.state;
      server.rev = body.rev;
      server.writes++;
      return json([{ rev: server.rev }]);
    }
    throw new Error(`método inesperado: ${method}`);
  };
  return { storage, server };
}

/** Uma "abertura do app": instância nova do store, como se a página tivesse sido recarregada. */
async function openApp() {
  const store = await import(`../app/js/store.js?app=${++instances}`);
  assert.equal(await store.load(), 'ready');
  return store;
}

const until = async (check, ms = 2000) => {
  const limit = Date.now() + ms;
  while (!check()) {
    if (Date.now() > limit) throw new Error('tempo esgotado esperando a condição');
    await new Promise((r) => setTimeout(r, 5));
  }
};
const ids = (state) => state.entries.map((e) => e.id).sort();

test('salvar com internet envia e não deixa cópia pendente no aparelho', async () => {
  const { storage, server } = world();
  const app = await openApp();
  app.update((s) => s.entries.push(entry('a')));
  await until(() => server.writes === 1);
  assert.deepEqual(ids(server.state), ['a']);
  await until(() => !storage.has('monetizeo:pending'));
  assert.equal(app.getStatus(), 'ok');
  app.stop();
});

test('sem internet a alteração fica guardada e vai para a nuvem quando o app é reaberto', async () => {
  const { storage, server } = world();
  const first = await openApp();
  server.online = false;
  first.update((s) => s.entries.push(entry('offline')));
  await until(() => first.getStatus() === 'offline');
  assert.equal(first.hasUnsynced(), true);
  assert.ok(storage.has('monetizeo:pending'), 'a alteração precisa estar guardada no aparelho');
  assert.equal(server.writes, 0);
  first.stop(); // o app foi fechado

  server.online = true;
  const second = await openApp();
  assert.ok(second.takeNotice().includes('Recuperei'));
  await until(() => server.writes === 1);
  assert.deepEqual(ids(server.state), ['offline']);
  await until(() => !storage.has('monetizeo:pending'));
  second.stop();
});

test('outra pessoa salvou enquanto eu estava sem internet: as duas alterações ficam', async () => {
  const { storage, server } = world(base([entry('1')]));
  const first = await openApp();
  server.online = false;
  first.update((s) => s.entries.push(entry('meu')));
  await until(() => first.getStatus() === 'offline');
  first.stop();

  // a outra pessoa lança o dela no outro celular
  server.state = base([entry('1'), entry('dela')]);
  server.rev = 2;
  server.online = true;

  const second = await openApp();
  await until(() => server.writes === 1);
  assert.deepEqual(ids(server.state), ['1', 'dela', 'meu']);
  assert.equal(JSON.parse(storage.get('monetizeo:rescued') || '[]').length, 0); // sem conflito, nada a resgatar
  second.stop();
});

test('conflito real na reabertura: fica a versão dela e uma cópia da minha é guardada', async () => {
  const { storage, server } = world(base([entry('1', 10)]));
  const first = await openApp();
  server.online = false;
  first.update((s) => { s.entries[0].amount = 20; });
  await until(() => first.getStatus() === 'offline');
  first.stop();

  server.state = base([entry('1', 30)]);
  server.rev = 2;
  server.online = true;

  const second = await openApp();
  assert.ok(second.takeNotice().includes('ficou a versão dela'));
  await until(() => !storage.has('monetizeo:pending'));
  assert.equal(server.state.entries[0].amount, 30);
  const rescued = second.listRescued();
  assert.equal(rescued.length, 1);
  assert.equal(rescued[0].state.entries[0].amount, 20); // a minha edição não se perdeu
  second.removeRescued(rescued[0].at);
  assert.equal(second.listRescued().length, 0);
  second.stop();
});

test('outra pessoa salva durante o uso (409): junta e reenvia sem pedir para refazer', async () => {
  const { server } = world(base([entry('1')]));
  const app = await openApp();
  const events = [];
  app.subscribe((reason, detail) => events.push([reason, detail]));

  // a outra pessoa salva por trás, sem o app saber
  server.state = base([entry('1'), entry('dela')]);
  server.rev = 2;

  app.update((s) => s.entries.push(entry('meu')));
  await until(() => server.writes === 1);
  assert.deepEqual(ids(server.state), ['1', 'dela', 'meu']);
  assert.deepEqual(ids(app.getState()), ['1', 'dela', 'meu']);
  assert.ok(events.some(([reason]) => reason === 'merged'));
  assert.equal(app.hasUnsynced(), false);
  app.stop();
});

test('alterações feitas durante um envio não se perdem', async () => {
  const { server } = world();
  const app = await openApp();
  app.update((s) => s.entries.push(entry('a')));
  app.update((s) => s.entries.push(entry('b'))); // o envio de "a" ainda está em andamento
  await until(() => !app.hasUnsynced());
  assert.deepEqual(ids(server.state), ['a', 'b']);
  app.stop();
});

test('entrar na casa de convite: quem já tem casa não entra em outra', async () => {
  const { server } = world();
  const app = await openApp();
  await assert.rejects(() => app.joinCloudHousehold('outro-codigo'), /já faz parte de uma casa/);
  assert.equal(server.writes, 0);
  // com o código da própria casa, apenas reabre
  assert.equal(await app.joinCloudHousehold('ABC123 '), 'ready');
  app.stop();
});
