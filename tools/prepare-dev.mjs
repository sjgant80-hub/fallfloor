#!/usr/bin/env node
// tools/prepare-dev.mjs — a DEVELOPMENT set, for smoke tests and for writing the prompts, so the held-out items are
// never used to tune anything. Drawn from the training side only (Banking77 train, SMS items outside the held-out
// draw, CLINC150 validation), with every held-out text and every few-shot example excluded (checked).
//   node tools/prepare-dev.mjs <raw dir>          → data/dev.json
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, '..');
const K = await import(pathToFileURL(join(root, 'kernel.mjs')).href);
const raw = process.argv[2];
if (!raw) { console.error('usage: prepare-dev.mjs <raw dir>'); process.exit(1); }
const SEED = 'fallfloor-2026-09-29|dev';
const data = Object.fromEntries(K.JOBS.map((j) => [j, JSON.parse(readFileSync(join(root, 'data', j + '.json'), 'utf8'))]));
const norm = (t) => t.trim().toLowerCase();
const banned = new Set();
for (const j of K.JOBS) { for (const x of data[j].heldOut) banned.add(norm(x.text)); for (const list of Object.values(data[j].examples)) for (const e of list) banned.add(norm(e.text)); }
function csv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const clean = (xs) => { const seen = new Set(); return xs.filter((x) => { const k = norm(x.text); if (seen.has(k) || banned.has(k)) return false; seen.add(k); return true; }); };
const draw = (pool, n, seed) => { const by = new Map(pool.map((x) => [x.text, x])); return K.seededOrder([...by.keys()], seed).order.slice(0, n).map((t) => by.get(t)); };
const idOf = (job, text) => 'dev-' + job.slice(0, 3) + '-' + K.sha256(job + '|dev|' + text).hash.slice(0, 10);

const bTrain = clean(csv(readFileSync(join(raw, 'b77-train.csv'), 'utf8')).slice(1).filter((r) => r.length === 2 && r[0].trim()).map(([text, intent]) => ({ text: text.trim(), intent: intent.trim() })));
const support = draw(bTrain, 40, SEED + '|support').map((x) => ({ id: idOf('support', x.text), text: x.text, gold: { intent: x.intent, team: K.teamOf(x.intent) } }));
const sms = clean(readFileSync(join(raw, 'sms', 'SMSSpamCollection'), 'utf8').split('\n').filter((l) => l.includes('\t')).map((l) => { const [lab, ...rest] = l.split('\t'); return { text: rest.join('\t').trim(), label: lab.trim() === 'spam' ? 'spam' : 'legit' }; }));
const security = [...draw(sms.filter((x) => x.label === 'legit'), 30, SEED + '|security|legit'), ...draw(sms.filter((x) => x.label === 'spam'), 10, SEED + '|security|spam')].map((x) => ({ id: idOf('security', x.text), text: x.text, gold: { label: x.label } }));
const clinc = JSON.parse(readFileSync(join(raw, 'clinc-data_full.json'), 'utf8'));
const work = new Set(K.HR_INTENTS);
const hrVal = clean(clinc.val.filter(([, i]) => work.has(i)).map(([text, label]) => ({ text, label })));
const oosVal = clean(clinc.oos_val.map(([text]) => ({ text, label: K.NOT_HR })));
const hr = [...draw(hrVal, 30, SEED + '|hr'), ...draw(oosVal, 5, SEED + '|hr|oos')].map((x) => ({ id: idOf('hr', x.text), text: x.text, gold: { label: x.label } }));
for (const x of [...support, ...security, ...hr]) if (banned.has(norm(x.text))) { console.error('REFUSED: a dev item is a held-out item or an example'); process.exit(1); }
writeFileSync(join(root, 'data', 'dev.json'), JSON.stringify({ kind: 'fallfloor-dev', seed: SEED, note: 'Development items for smoke tests and prompt writing. Never scored in the measured run. Disjoint from every held-out item and every example.', support, security, hr }, null, 1) + '\n');
console.log('dev: support ' + support.length + ', security ' + security.length + ' (' + security.filter((x) => x.gold.label === 'spam').length + ' spam), hr ' + hr.length + ' (' + hr.filter((x) => x.gold.label === K.NOT_HR).length + ' not-HR)');
