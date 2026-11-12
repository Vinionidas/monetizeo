// Junta duas versões do estado que partiram da mesma base (merge de 3 vias).
//
// Cenário: o celular ficou sem internet e você lançou um gasto; enquanto isso a
// outra pessoa salvou outra coisa. Cada lado mexeu em itens diferentes, então dá
// para ficar com os dois — sem pedir para ninguém refazer nada.
//
//   base   = como estava o estado na última vez que sincronizou
//   mine   = o estado deste aparelho, com as alterações ainda não salvas
//   theirs = o estado que está no servidor agora
//
// Listas de registros (lançamentos, contas...) são comparadas por `id`:
//   - só eu mexi → vale o meu;  só ela mexeu → vale o dela;  fizemos igual → tanto faz
//   - os dois mexeram no MESMO item de jeitos diferentes → conflito: fica o dela, e
//     quem chama guarda uma cópia do meu para não perder nada
//     (se um lado apagou e o outro editou, fica o item editado)

/** JSON com as chaves em ordem, para comparar objetos sem depender da ordem em que foram montados. */
export function canon(value) {
  return JSON.stringify(value, (key, v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
    : v));
}

export const same = (a, b) => canon(a) === canon(b);

const isRecordList = (list) => Array.isArray(list) && list.every((x) => x && typeof x === 'object' && 'id' in x);

function pickRecord(name, id, b, m, t, conflicts) {
  if (same(m, b)) return t; // não mexi: vale o dela (inclusive se ela apagou)
  if (same(t, b) || same(m, t)) return m; // ela não mexeu, ou fizemos igual: vale o meu
  conflicts.push({ collection: name, id });
  if (!t) return m; // ela apagou, eu editei: fica o item
  return t; // os dois editaram: fica o dela
}

function mergeRecords(name, b, m, t, conflicts) {
  const index = (list) => new Map(list.map((x) => [x.id, x]));
  const B = index(b);
  const M = index(m);
  const T = index(t);
  const out = [];
  const seen = new Set();
  // A ordem do servidor manda; o que só eu criei vai no fim.
  for (const item of [...t, ...m]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const picked = pickRecord(name, item.id, B.get(item.id), M.get(item.id), T.get(item.id), conflicts);
    if (picked) out.push(picked);
  }
  return out;
}

/** Devolve { merged, conflicts }. Não altera nenhum dos três estados. */
export function mergeStates(base, mine, theirs) {
  const conflicts = [];
  const merged = {};
  const keys = new Set([...Object.keys(base || {}), ...Object.keys(mine || {}), ...Object.keys(theirs || {})]);
  for (const key of keys) {
    const b = base?.[key];
    const m = mine?.[key];
    const t = theirs?.[key];
    let value;
    if (Array.isArray(m ?? t ?? b)) {
      const [lb, lm, lt] = [b, m, t].map((x) => (Array.isArray(x) ? x : []));
      if (isRecordList(lb) && isRecordList(lm) && isRecordList(lt)) {
        value = mergeRecords(key, lb, lm, lt, conflicts);
      } else {
        value = [...new Set([...lt, ...lm])]; // listas de textos (ex.: extrato ignorado): só crescem
      }
    } else if (same(m, b)) {
      value = t;
    } else if (same(t, b) || same(m, t)) {
      value = m;
    } else {
      conflicts.push({ collection: key, id: null });
      value = t;
    }
    if (value !== undefined) merged[key] = value;
  }
  return { merged, conflicts };
}
