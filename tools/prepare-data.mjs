#!/usr/bin/env node
// tools/prepare-data.mjs — build the modelled company's work from three public labelled datasets, deterministically.
//   node tools/prepare-data.mjs <raw dir>
// <raw dir> holds the files exactly as published:
//   b77-train.csv, b77-test.csv        https://github.com/PolyAI-LDN/task-specific-datasets (banking_data), CC BY 4.0
//   sms/SMSSpamCollection              https://archive.ics.uci.edu/dataset/228/sms+spam+collection, CC BY 4.0
//   clinc-data_full.json, clinc-domains.json   https://github.com/clinc/oos-eval (data/), CC BY 3.0
// Held-out items and few-shot examples are drawn with the kernel's seeded order (sha256(seed|text)), so anyone with
// the same files and seed gets the same items. A held-out text never appears among the examples (checked).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const K = await import(pathToFileURL(join(here, '..', 'kernel.mjs')).href);
const raw = process.argv[2];
if (!raw) { console.error('usage: prepare-data.mjs <raw dir>'); process.exit(1); }
const out = join(here, '..', 'data');
mkdirSync(out, { recursive: true });
const SEED = 'fallfloor-2026-09-29';

function csv(text) {                                    // RFC-4180-ish: quotes, doubled quotes, commas inside quotes
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
const uniqByText = (xs) => { const seen = new Set(); return xs.filter((x) => { const k = x.text.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }); };
function draw(pool, n, seed) {
  const byText = new Map(pool.map((x) => [x.text, x]));
  return K.seededOrder([...byText.keys()], seed).order.slice(0, n).map((t) => byText.get(t));
}
const idOf = (job, text) => job.slice(0, 3) + '-' + K.sha256(job + '|' + text).hash.slice(0, 10);
function disjoint(held, examples) {
  const h = new Set(held.map((x) => x.text.trim().toLowerCase()));
  const leak = examples.filter((e) => h.has(e.text.trim().toLowerCase()));
  if (leak.length) { console.error('REFUSED: a held-out text is also an example: ' + leak[0].text); process.exit(1); }
}

// ── support · Banking77 ──
const b77 = (f) => csv(readFileSync(join(raw, f), 'utf8')).slice(1).filter((r) => r.length === 2 && r[0].trim()).map(([text, intent]) => ({ text: text.trim(), intent: intent.trim() }));
const bTrain = uniqByText(b77('b77-train.csv')), bTest = uniqByText(b77('b77-test.csv'));
for (const x of [...bTrain, ...bTest]) if (K.teamOf(x.intent) === null) { console.error('REFUSED: unknown intent ' + x.intent); process.exit(1); }
const supHeld = draw(bTest, 100, SEED + '|support|held');
const routeEx = [], intentEx = [];
for (const t of K.TEAM_IDS) routeEx.push(...draw(bTrain.filter((x) => K.teamOf(x.intent) === t), 2, SEED + '|support|route|' + t).map((x) => ({ text: x.text, label: t })));
for (const i of K.ALL_INTENTS) intentEx.push(...draw(bTrain.filter((x) => x.intent === i), 1, SEED + '|support|intent|' + i).map((x) => ({ text: x.text, label: i })));
disjoint(supHeld, [...routeEx, ...intentEx]);
writeFileSync(join(out, 'support.json'), JSON.stringify({
  job: 'support', seed: SEED, department: 'Customer support',
  source: { name: 'Banking77', by: 'PolyAI (Casanueva et al., 2020, "Efficient Intent Detection with Dual Sentence Encoders")', url: 'https://github.com/PolyAI-LDN/task-specific-datasets', license: 'CC BY 4.0', split: 'held-out from test.csv; examples from train.csv' },
  heldOut: supHeld.map((x) => ({ id: idOf('support', x.text), text: x.text, gold: { intent: x.intent, team: K.teamOf(x.intent) } })),
  examples: { route: routeEx, intent: intentEx },
}, null, 1) + '\n');

// ── security · SMS Spam Collection ──
const sms = uniqByText(readFileSync(join(raw, 'sms', 'SMSSpamCollection'), 'utf8').split('\n').filter((l) => l.includes('\t'))
  .map((l) => { const [lab, ...rest] = l.split('\t'); return { text: rest.join('\t').trim(), label: lab.trim() === 'spam' ? 'spam' : 'legit' }; }));
const secHeld = draw(sms, 100, SEED + '|security|held');
const heldSet = new Set(secHeld.map((x) => x.text));
const secRest = sms.filter((x) => !heldSet.has(x.text));
const secEx = [...draw(secRest.filter((x) => x.label === 'spam'), 3, SEED + '|security|spam'), ...draw(secRest.filter((x) => x.label === 'legit'), 3, SEED + '|security|legit')].map((x) => ({ text: x.text, label: x.label }));
disjoint(secHeld, secEx);
writeFileSync(join(out, 'security.json'), JSON.stringify({
  job: 'security', seed: SEED, department: 'Security (inbound message screening)',
  source: { name: 'SMS Spam Collection v.1', by: 'Tiago A. Almeida and José María Gómez Hidalgo', url: 'https://archive.ics.uci.edu/dataset/228/sms+spam+collection', license: 'CC BY 4.0', split: 'held-out and examples drawn from the one published file, disjoint' },
  heldOut: secHeld.map((x) => ({ id: idOf('security', x.text), text: x.text, gold: { label: x.label } })),
  examples: { screen: secEx },
}, null, 1) + '\n');

// ── hr · CLINC150 work domain + out-of-scope ──
const clinc = JSON.parse(readFileSync(join(raw, 'clinc-data_full.json'), 'utf8'));
const work = new Set(K.HR_INTENTS);
const hrTest = uniqByText(clinc.test.filter(([, i]) => work.has(i)).map(([text, intent]) => ({ text, label: intent })));
const oosTest = uniqByText(clinc.oos_test.map(([text]) => ({ text, label: K.NOT_HR })));
const hrHeld = [...draw(hrTest, 90, SEED + '|hr|held'), ...draw(oosTest, 10, SEED + '|hr|oos')];
const hrTrain = uniqByText(clinc.train.filter(([, i]) => work.has(i)).map(([text, intent]) => ({ text, label: intent })));
const hrEx = K.HR_INTENTS.flatMap((i) => draw(hrTrain.filter((x) => x.label === i), 1, SEED + '|hr|ex|' + i)).map((x) => ({ text: x.text, label: x.label }));
disjoint(hrHeld, hrEx);
writeFileSync(join(out, 'hr.json'), JSON.stringify({
  job: 'hr', seed: SEED, department: 'People (staff helpdesk)',
  source: { name: 'CLINC150 ("work" domain and out-of-scope)', by: 'Larson et al., 2019, "An Evaluation Dataset for Intent Classification and Out-of-Scope Prediction"', url: 'https://github.com/clinc/oos-eval', license: 'CC BY 3.0', split: 'held-out from test + oos_test; examples from train' },
  heldOut: hrHeld.map((x) => ({ id: idOf('hr', x.text), text: x.text, gold: { label: x.label } })),
  examples: { helpdesk: hrEx },
}, null, 1) + '\n');

console.log('support: ' + supHeld.length + ' held-out (from ' + bTest.length + '), examples ' + routeEx.length + ' route + ' + intentEx.length + ' intent');
console.log('security: ' + secHeld.length + ' held-out (' + secHeld.filter((x) => x.label === 'spam').length + ' spam), examples ' + secEx.length);
console.log('hr: ' + hrHeld.length + ' held-out (' + hrHeld.filter((x) => x.label === K.NOT_HR).length + ' not-HR), examples ' + hrEx.length);
