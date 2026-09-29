#!/usr/bin/env node
// make-page.mjs — the page fixpoint. index.html runs the SAME kernel the mutation gate proves and the same runtime the
// harness drove, and shows the committed run from its own files. The results blocks in README.md and llms.txt are
// generated from the same summary, so no number is typed by hand. CI regenerates all three and fails if any differs.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const at = (f) => new URL('../' + f, import.meta.url);
const read = (f) => readFileSync(at(f), 'utf8').replace(/\r\n/g, '\n');
const json = (f) => JSON.parse(read(f));
const K = await import(at('kernel.mjs').href);
const kernel = read('kernel.mjs').replace(/^export /gm, '').trimEnd();
const runtime = read('runtime.js').trimEnd();
const JOB_LINE = { support: 'Answer customers: route → intent → reply', security: 'Screen inbound messages: legit or spam', hr: 'Staff helpdesk: which HR topic, or not HR' };
const departments = ['support', 'security', 'hr'].map((j) => {
  const d = json('data/' + j + '.json');
  const ex = Object.values(d.examples).reduce((a, x) => a + x.length, 0);
  return { job: j, department: d.department, jobLine: JOB_LINE[j], source: d.source, heldOut: d.heldOut.length, examples: ex };
});
const latest = existsSync(at('runs/latest.json')) ? json('runs/latest.json').run : null;
const summary = latest ? json('runs/' + latest + '/summary.json') : null;
const costs = json('sources/costs.json');
// security taken apart, from the signed hops (outcomeFromHops) and the published gold labels — not from the desk's record
let breakdown = null;
if (summary && existsSync(at(summary.ledgerPath))) {
  const gold = Object.fromEntries(json('data/security.json').heldOut.map((x) => [x.id, x.gold]));
  const recs = json(summary.ledgerPath).items.filter((x) => x.key === 'security').map((x) => ({ item: x.item, gold: gold[x.item], out: K.outcomeFromHops('security', x.arm, x.hops).out }));
  breakdown = { security: K.labelBreakdown(recs, 'spam') };
}
const data = {
  departments, prereg: json('prereg.json'),
  preregHash: createHash('sha256').update(readFileSync(at('prereg.json'))).digest('hex'),
  preregCommit: json('prereg-commit.json'), preregLog: json('prereg-log.json'), why: json('sources/why.json'), costs, summary, breakdown,
};

// ── the generated results block (markdown), shared by README.md and llms.txt ──
const pct = (x) => (x === null || x === undefined ? '—' : (Math.round(x * 1000) / 10) + '%');
const sec = (ms) => (ms === null || ms === undefined ? '—' : (Math.round(ms / 100) / 10) + ' s');
const gbp = (x) => '£' + x.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function resultsMarkdown(S) {
  if (!S) return 'The measured run has not been published yet.';
  const L = [];
  L.push('Run `' + S.run + '` · ' + S.started + ' → ' + S.finished + ' · ' + S.hops + ' signed hops · ledger sha256 `' + S.ledgerHash + '`');
  L.push('');
  L.push('**Machines: ' + S.machine + '**');
  if (S.prereg) {
    L.push('');
    L.push('**Pre-registered rules: ' + S.prereg.passed + ' of ' + S.prereg.of + ' passed.**');
    L.push('');
    L.push('| Rule | Measured | Verdict |'); L.push('|---|---|---|');
    for (const r of S.prereg.rules) L.push('| ' + r.id + ' — ' + r.rule + ' | ' + (r.value !== null && typeof r.value === 'object' ? '`' + JSON.stringify(r.value) + '`' : String(r.value)) + ' | ' + (r.pass ? 'PASS' : 'FAIL') + ' |');
  }
  const A = S.arms;
  if (A.chain || A.pool || A.baseline) {
    const cols = ['chain', 'pool', 'baseline'].filter((k) => A[k]);
    const head = { chain: 'Chain', pool: 'Pool', baseline: 'One model (3B)' };
    L.push(''); L.push('Customer support — the same ' + A[cols[0]].n + ' held-out items:'); L.push('');
    L.push('| | ' + cols.map((k) => head[k]).join(' | ') + ' |'); L.push('|---|' + cols.map(() => '---|').join(''));
    const rows = [['Correct end to end', (a) => pct(a.e2e)], ['Right team', (a) => pct(a.teamAcc)], ['Right topic', (a) => pct(a.intentAcc)], ['Reply passed the gate', (a) => pct(a.replyPass)],
      ['Caught (went to a person)', (a) => pct(a.caught)], ['Silent errors (wrong, and sent)', (a) => pct(a.silent)], ['Time per item p50 / p95', (a) => sec(a.latencyMs.p50) + ' / ' + sec(a.latencyMs.p95)],
      ['Items per minute', (a) => String(a.throughputPerMin ?? '—')], ['Lost / accepted twice', (a) => a.lost + ' / ' + a.duplicates], ['Duplicate deliveries dropped', (a) => String(a.duplicatesDropped ?? 0)],
      ['Longest gap between answers', (a) => (a.maxGapSec ?? '—') + ' s'], ['Tokens per item (in / out)', (a) => a.perItem.promptTokens + ' / ' + a.perItem.completionTokens]];
    for (const [label, f] of rows) L.push('| ' + label + ' | ' + cols.map((k) => f(A[k])).join(' | ') + ' |');
    const c = S.compare, p = (x) => Math.round(x * 1000) / 1000;
    const bits = [];
    if (c.chainVsBaseline) bits.push('chain vs one model ' + c.chainVsBaseline.diffPts + ' points (exact McNemar p = ' + p(c.chainVsBaseline.p) + ')');
    if (c.chainVsPool) bits.push('chain vs pool ' + c.chainVsPool.diffPts + ' points (p = ' + p(c.chainVsPool.p) + ')');
    if (bits.length) { L.push(''); L.push('Paired on the same items: ' + bits.join('; ') + '. Under about 5 points is a tie; a p above 0.05 means the difference could be chance.'); }
    if (A.chain && A.chain.silent >= 0.1) { L.push(''); L.push('**What that means:** ' + pct(A.chain.e2e) + ' correct end to end, with ' + pct(A.chain.silent) + ' of replies wrong but passing the gate. At this accuracy the support line is not good enough to answer customers on its own — every reply needs a person to check it. The plumbing held (nothing lost, every hop signed and verified); the small models are the limit.'); }
  }
  const J = S.jobs, jl = [];
  if (J.security) jl.push('security screening ' + pct(J.security.accuracy) + ' correct (' + J.security.completed + '/' + J.security.n + ' completed)');
  if (J.hr) jl.push('HR helpdesk ' + pct(J.hr.accuracy) + ' correct (' + J.hr.completed + '/' + J.hr.n + ' completed)');
  if (jl.length) { L.push(''); L.push('The rest of the company, on the pool: ' + jl.join('; ') + '.'); }
  if (breakdown && breakdown.security.ok) {
    const b = breakdown.security;
    L.push(''); L.push('Security, taken apart: spam caught ' + b.caught + ' of ' + (b.caught + b.missed) + '; legitimate messages wrongly flagged ' + b.wronglyFlagged + ' of ' + (b.wronglyFlagged + b.correctlyPassed) + '. Answering "legit" every time would have scored ' + pct(b.majorityAccuracy) + ' on these items' + (S.jobs.security && S.jobs.security.accuracy < b.majorityAccuracy ? ' — so the small model\'s accuracy is below that bar: it over-flags.' : '.'));
  }
  if (S.faults) {
    const u = S.faults.unplannedRestarts || [], lf = S.faults.gpuFaultsWhileLoading || [];
    L.push(''); L.push('What went wrong on the hardware: ' + u.length + ' unplanned node restart' + (u.length === 1 ? '' : 's') + ' during the work' + (u.length ? ' (' + u.map((x) => x.node + ' in the ' + x.arm).join('; ') + ')' : '') + '; ' + lf.length + ' GPU fault' + (lf.length === 1 ? '' : 's') + ' while a model was loading; Windows standby entries during the run: ' + (S.faults.standbyEntriesDuringRun ?? 'not read') + '.');
  }
  const cold = S.nodes.filter((n) => typeof n.coldStartSec === 'number');
  if (cold.length) { L.push(''); L.push('Cold starts (browser launch → first answer, model download included): ' + cold.map((n) => n.name + ' ' + n.coldStartSec + ' s' + (n.downloadMB ? ' (' + n.downloadMB + ' MB downloaded)' : '')).join(', ') + '.'); }
  const per = S.costPerItem;
  if (per && per.support && per.security && per.hr) {
    const vol = { support: costs.volumes.support, security: costs.volumes.security, hr: costs.volumes.hr };
    const m = K.costModel({ jobs: Object.keys(vol).map((k) => ({ job: k, volumePerMonth: vol[k], promptTokensPerItem: per[k].promptTokens, completionTokensPerItem: per[k].completionTokens, gpuSecondsPerItem: per[k].gpuSeconds })), prices: costs.prices, fx: costs.fx, power: costs.power, electricity: costs.electricity });
    if (m.ok) {
      L.push(''); L.push('Cost of one month at the **modelled** volumes (' + Object.entries(vol).map(([k, v]) => k + ' ' + v.toLocaleString('en-GB')).join(', ') + ' items — assumptions, change them on the page):'); L.push('');
      L.push('| The same month of work, sent to… | Per month | Source |'); L.push('|---|---|---|');
      L.push('| These laptops (already owned) — electricity only | ' + gbp(m.local.gbpLow) + ' – ' + gbp(m.local.gbpHigh) + ' | ' + m.local.laptopHours + ' laptop-GPU hours × ' + costs.power.wattsLow + '–' + costs.power.wattsHigh + ' W (estimate, [Intel](' + costs.power.source + ')) × ' + costs.electricity.pencePerKwh + 'p/kWh ([Ofgem](' + costs.electricity.source + ')) |');
      for (const c of m.cloud) { const p = costs.prices.find((x) => x.id === c.id); L.push('| ' + p.provider + ' · ' + p.model + ' | ' + gbp(c.gbpPerMonth) + ' | [list price](' + p.source + '), checked ' + p.checked + ' |'); }
      L.push(''); L.push('Tokens are measured with the local model\'s tokenizer; cloud tokenizers differ, so cloud figures are approximate. FX ' + costs.fx.gbpPerUsd + ' GBP/USD ([ECB](' + costs.fx.source + ')).');
      L.push(''); L.push('**This prices the same tokens, not the same quality.** No cloud model was run here; a larger cloud model would very likely answer more of these items correctly. The local figure is electricity only — the laptops are already owned, and their time is the real cost: at these volumes the work needs about ' + Math.round(m.local.laptopHours) + ' laptop-GPU hours a month, about ' + (Math.round(m.local.laptopHours / 168 * 10) / 10) + ' laptops\' worth of office hours (8 h × 21 days) on laptops like this one.');
    }
  }
  return L.join('\n');
}
const block = resultsMarkdown(summary);
const swapIn = (text, begin, end, body, name) => {
  const a = text.indexOf(begin), b = text.indexOf(end);
  if (a < 0 || b < a) { console.error('markers missing in ' + name + ': ' + begin); process.exit(1); }
  return text.slice(0, a + begin.length) + '\n' + body + '\n' + text.slice(b);
};
const RB = '<!-- ⟦RESULTS-BEGIN⟧ generated from runs/latest.json by make-page.mjs — do not edit here -->', RE = '<!-- ⟦RESULTS-END⟧ -->';
for (const f of ['README.md', 'llms.txt']) writeFileSync(at(f), swapIn(read(f), RB, RE, block, f));

let page = read('index.html');
const swap = (begin, end, body) => { page = swapIn(page, begin, end, body, 'index.html'); };
swap('<!-- ⟦DATA-BEGIN⟧ generated by make-page.mjs — do not edit here -->', '<!-- ⟦DATA-END⟧ -->', '<script type="application/json" id="floorData">' + JSON.stringify(data).replace(/</g, '\\u003c') + '</script>');
swap('// ⟦KERNEL-BEGIN⟧ generated from kernel.mjs by make-page.mjs — do not edit here', '// ⟦KERNEL-END⟧', kernel);
swap('// ⟦RUNTIME-BEGIN⟧ generated from runtime.js by make-page.mjs — do not edit here', '// ⟦RUNTIME-END⟧', runtime);
writeFileSync(at('index.html'), page);
console.log('page: kernel ' + kernel.length + ' chars · runtime ' + runtime.length + ' · data ' + JSON.stringify(data).length + (summary ? ' · run ' + latest : ' · no run yet') + ' · README + llms.txt results regenerated');
