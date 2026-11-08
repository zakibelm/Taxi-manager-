// Import de l'historique DataTaxi : « node server/import-datataxi.mjs fichier.csv [--dry-run] » (SQLITE_PATH requis).
// Le fichier est un export CSV d'un onglet du Google Sheet « DataTaxi - Historique Zone Predict » (Fichier › Télécharger › CSV) ou
// de l'export de l'application. Idempotent (clé trip_id) ; une ligne invalide est comptée et ignorée, jamais corrigée.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dispatchRow, openDispatchStore } from './dispatch.mjs';

/** CSV RFC 4180 minimal : guillemets, guillemets doublés, retours de ligne dans les champs, BOM. */
export function parseCsv(input) {
 const text = input.replace(/^﻿/, '');
 const rows = []; let row = [], field = '', quoted = false;
 for(let i = 0; i < text.length; i++) {
  const c = text[i];
  if(quoted) {
   if(c === '"') { if(text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c;
  } else if(c === '"') quoted = true;
  else if(c === ',') { row.push(field); field = ''; }
  else if(c === '\n' || c === '\r') { if(c === '\r' && text[i + 1] === '\n') i++; row.push(field); field = ''; if(row.some(v => v !== '')) rows.push(row); row = []; }
  else field += c;
 }
 row.push(field); if(row.some(v => v !== '')) rows.push(row);
 return rows;
}

export function importCsv(csv, store, { dryRun = false, batch = 500 } = {}) {
 const [header, ...lines] = parseCsv(csv);
 if(!header || !header.includes('trip_id')) throw new Error('En-tête « trip_id » introuvable : ce n’est pas un export DataTaxi.');
 const valid = []; let rejected = 0; const reasons = {};
 for(const line of lines) {
  const record = Object.fromEntries(header.map((h, i) => [h, line[i] ?? '']));
  try { valid.push(dispatchRow(record)); } catch(error) { rejected++; reasons[error.message] = (reasons[error.message] || 0) + 1; }
 }
 const before = store.count();
 if(!dryRun) for(let i = 0; i < valid.length; i += batch) store.upsertMany(valid.slice(i, i + batch));
 return { read: lines.length, valid: valid.length, rejected, reasons, added: dryRun ? null : store.count() - before, total: dryRun ? before : store.count() };
}

if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 const [file, flag] = process.argv.slice(2);
 if(!file || !process.env.SQLITE_PATH) { console.error('Usage : SQLITE_PATH=… node server/import-datataxi.mjs fichier.csv [--dry-run]'); process.exit(2); }
 const store = openDispatchStore(process.env.SQLITE_PATH);
 try {
  const r = importCsv(readFileSync(file, 'utf8'), store, { dryRun: flag === '--dry-run' });
  console.log(`[datataxi] ${r.read} lignes lues, ${r.valid} valides, ${r.rejected} rejetées ${JSON.stringify(r.reasons)}.`);
  console.log(r.added === null ? `[datataxi] essai à blanc : rien écrit (${r.total} déjà en base).` : `[datataxi] ${r.added} ajoutées, ${r.total} au total.`);
 } finally { store.close(); }
}
