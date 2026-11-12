// Testes da junção de duas versões do estado (merge de 3 vias), com dados fictícios.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canon, mergeStates, same } from '../app/js/merge.js';

const entry = (id, amount = 10, extra = {}) => ({ id, description: `Item ${id}`, amount, ...extra });
const state = (entries, extra = {}) => ({ schema: 1, entries, accounts: [{ id: 'a', name: 'Banco' }], ofxIgnored: [], split: { mode: 'equal' }, ...extra });

test('comparação não depende da ordem das chaves', () => {
  assert.equal(canon({ b: 1, a: { d: 2, c: 3 } }), canon({ a: { c: 3, d: 2 }, b: 1 }));
  assert.equal(same({ x: [1, { b: 1, a: 2 }] }, { x: [1, { a: 2, b: 1 }] }), true);
  assert.equal(same({ x: 1 }, { x: 2 }), false);
});

test('cada lado criou um item: ficam os dois, na ordem do servidor', () => {
  const base = state([entry('1')]);
  const mine = state([entry('1'), entry('meu')]);
  const theirs = state([entry('1'), entry('dela')]);
  const { merged, conflicts } = mergeStates(base, mine, theirs);
  assert.deepEqual(merged.entries.map((e) => e.id), ['1', 'dela', 'meu']);
  assert.deepEqual(conflicts, []);
});

test('um apagou e o outro editou outro item: as duas mudanças valem', () => {
  const base = state([entry('1'), entry('2'), entry('3')]);
  const mine = state([entry('1'), entry('3')]); // apaguei o 2
  const theirs = state([entry('1', 99), entry('2'), entry('3')]); // ela editou o 1
  const { merged, conflicts } = mergeStates(base, mine, theirs);
  assert.deepEqual(merged.entries.map((e) => [e.id, e.amount]), [['1', 99], ['3', 10]]);
  assert.deepEqual(conflicts, []);
});

test('o mesmo item editado dos dois lados: fica o dela e o conflito é avisado', () => {
  const base = state([entry('1', 10)]);
  const mine = state([entry('1', 20)]);
  const theirs = state([entry('1', 30)]);
  const { merged, conflicts } = mergeStates(base, mine, theirs);
  assert.equal(merged.entries[0].amount, 30);
  assert.deepEqual(conflicts, [{ collection: 'entries', id: '1' }]);
});

test('os dois fizeram a mesma alteração: não é conflito', () => {
  const base = state([entry('1', 10)]);
  const both = state([entry('1', 20)]);
  const { merged, conflicts } = mergeStates(base, both, both);
  assert.equal(merged.entries[0].amount, 20);
  assert.deepEqual(conflicts, []);
});

test('ela apagou e eu editei: o item é mantido, com a minha edição', () => {
  const base = state([entry('1', 10), entry('2')]);
  const mine = state([entry('1', 25), entry('2')]);
  const theirs = state([entry('2')]);
  const { merged, conflicts } = mergeStates(base, mine, theirs);
  assert.deepEqual(merged.entries.map((e) => [e.id, e.amount]), [['2', 10], ['1', 25]]);
  assert.equal(conflicts.length, 1);
});

test('eu apaguei e ela editou: o item é mantido, com a edição dela', () => {
  const base = state([entry('1', 10)]);
  const mine = state([]);
  const theirs = state([entry('1', 77)]);
  const { merged, conflicts } = mergeStates(base, mine, theirs);
  assert.deepEqual(merged.entries.map((e) => e.amount), [77]);
  assert.equal(conflicts.length, 1);
});

test('listas de textos só crescem e configurações seguem a mesma regra', () => {
  const base = state([], { ofxIgnored: ['x'], split: { mode: 'equal' } });
  const mine = state([], { ofxIgnored: ['x', 'meu'], split: { mode: 'income' } });
  const theirs = state([], { ofxIgnored: ['x', 'dela'], split: { mode: 'equal' } });
  const { merged, conflicts } = mergeStates(base, mine, theirs);
  assert.deepEqual([...merged.ofxIgnored].sort(), ['dela', 'meu', 'x']);
  assert.deepEqual(merged.split, { mode: 'income' }); // só eu mexi
  assert.deepEqual(conflicts, []);
});

test('não altera os estados recebidos e tolera listas que só existem de um lado', () => {
  const base = state([entry('1')]);
  const mine = state([entry('1'), entry('2')], { goals: [{ id: 'g', name: 'Viagem' }] });
  const theirs = state([entry('1')]);
  const copy = JSON.stringify([base, mine, theirs]);
  const { merged } = mergeStates(base, mine, theirs);
  assert.equal(JSON.stringify([base, mine, theirs]), copy);
  assert.deepEqual(merged.goals, [{ id: 'g', name: 'Viagem' }]);
  assert.equal(merged.entries.length, 2);
});
