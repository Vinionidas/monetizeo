#!/usr/bin/env node
// Traz dados de fora para o Monetizeo e grava em data/state.json.
//
//   node tools/migrar.mjs "C:/caminho/Financas.xlsx"       planilha de finanças
//   node tools/migrar.mjs casa-em-ordem-2026-11.json       backup do app antigo
//
// Não sobrescreve dados existentes: se data/state.json já existe, peça com --substituir
// (o arquivo atual é copiado para data/backups/ antes).

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLegacy, migrateLegacy } from '../app/js/migrate.js';
import { normalize } from '../app/js/model.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const replace = args.includes('--substituir');
const source = args.find((a) => !a.startsWith('--'));
if (!source) {
  console.error('Uso: node tools/migrar.mjs <planilha.xlsx | backup.json> [--substituir]');
  process.exit(1);
}

let raw;
if (/\.xlsx?$/i.test(source)) {
  const temp = join(mkdtempSync(join(tmpdir(), 'monetizeo-')), 'planilha.json');
  const python = process.platform === 'win32' ? 'python' : 'python3';
  console.log(execFileSync(python, [join(root, 'tools', 'importar_planilha.py'), source, temp], { encoding: 'utf8' }).trim());
  raw = JSON.parse(readFileSync(temp, 'utf8'));
} else {
  raw = JSON.parse(readFileSync(source, 'utf8'));
  if (raw.state && raw.rev !== undefined) raw = raw.state;
}

const state = isLegacy(raw) ? migrateLegacy(raw) : normalize(raw);

const dataDir = join(root, 'data');
const target = join(dataDir, 'state.json');
mkdirSync(join(dataDir, 'backups'), { recursive: true });
let rev = 1;
if (existsSync(target)) {
  if (!replace) {
    console.error('data/state.json já existe. Para trocar pelos dados importados, repita com --substituir.');
    process.exit(1);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  copyFileSync(target, join(dataDir, 'backups', `antes-da-importacao-${stamp}.json`));
  rev = (JSON.parse(readFileSync(target, 'utf8')).rev || 0) + 1;
}
writeFileSync(target, JSON.stringify({ rev, state }, null, 1), 'utf8');
console.log(`Gravado em data/state.json: ${state.entries.length} lançamentos, ${state.people.length} pessoas, ${state.accounts.length} contas, ${state.categories.length} categorias.`);
