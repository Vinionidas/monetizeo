// Leitura de extratos OFX (formato SGML dos bancos brasileiros e o XML mais novo).
// Só interpreta o arquivo: quem decide o que vira lançamento é a fila de revisão.

/** Bancos costumam exportar em Windows-1252; alguns já usam UTF-8. */
export function decodeOfx(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

function tag(block, name) {
  const match = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i'));
  return match ? match[1].trim() : '';
}

function parseAmount(raw) {
  const text = raw.replace(/\s/g, '');
  // "1.234,56" (pt-BR) ou "-1234.56" (padrão OFX)
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  return Number(normalized);
}

/**
 * Devolve as transações do extrato:
 * { importId, date, description, memo, amount (sempre positivo), type }.
 */
export function parseOfx(text) {
  // Nem todo banco fecha a tag </STMTTRN>, então cortamos pelo início de cada uma.
  const blocks = text.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0]);
  const rows = [];
  blocks.forEach((block, index) => {
    const amount = parseAmount(tag(block, 'TRNAMT'));
    const posted = tag(block, 'DTPOSTED').slice(0, 8);
    if (!Number.isFinite(amount) || amount === 0 || !/^\d{8}$/.test(posted)) return;
    const date = `${posted.slice(0, 4)}-${posted.slice(4, 6)}-${posted.slice(6, 8)}`;
    const memo = tag(block, 'MEMO');
    const name = tag(block, 'NAME');
    const description = (name || memo || 'Transação do extrato').replace(/\s+/g, ' ').replace(/^"(.*)"$/, '$1').trim();
    const fitid = tag(block, 'FITID');
    rows.push({
      importId: fitid ? `ofx:${fitid}` : `ofx:${date}:${amount}:${index}`,
      date,
      description,
      memo: memo && memo !== description ? memo : '',
      amount: Math.abs(amount),
      type: amount > 0 ? 'income' : 'expense',
    });
  });
  return rows;
}

/** Separa o que é novo do que já foi importado, está na fila ou foi ignorado. */
export function splitNewOfx(state, rows) {
  const known = new Set([
    ...state.entries.map((e) => e.importId),
    ...state.ofxPending.map((e) => e.importId),
    ...state.ofxIgnored,
  ].filter(Boolean));
  const fresh = [];
  let duplicates = 0;
  for (const row of rows) {
    if (known.has(row.importId)) duplicates++;
    else {
      known.add(row.importId);
      fresh.push(row);
    }
  }
  return { fresh, duplicates };
}
