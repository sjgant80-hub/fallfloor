#!/usr/bin/env node
// tools/verify-run.mjs — re-check the committed run from its receipts alone. Runs in CI on GitHub's runner.
//   node tools/verify-run.mjs [--run <id>]        (default: runs/latest.json)
// It trusts nothing the desk wrote about outcomes. For every item it:
//   1 · re-hashes every hop and checks the hops link in order (kernel verifyChain)
//   2 · checks every hop's Ed25519 signature against the public key it names, and that the key is one of the run's nodes
//   3 · rebuilds the answer from the SIGNED hop outputs (not the desk's record) and the gold label from data/<job>.json
//       (not the ledger), then re-scores every arm with the kernel and compares with the committed summary
//   4 · re-evaluates the pre-registered rules and checks the prereg file is byte-identical to the one committed before
//       the first run (and that the commit is older than the run)
// What it cannot check: timings (start/end of each item) are the desk's clock, not signed. They are reported as such.
import { readFileSync, existsSync } from 'node:fs';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const K = await import(pathToFileURL(join(root, 'kernel.mjs')).href);
const argv = process.argv.slice(2), flag = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const read = (f) => readFileSync(join(root, f));
const json = (f) => JSON.parse(read(f).toString('utf8'));
if (!flag('--run') && !existsSync(join(root, 'runs', 'latest.json'))) { console.log('no measured run is published yet (runs/latest.json is absent) — nothing to verify'); process.exit(0); }
const RUN = flag('--run') || json('runs/latest.json').run;
const fails = [], say = (s) => console.log(s);
const check = (cond, what) => { if (!cond) fails.push(what); return cond; };
const eq = (a, b) => K.canon(a) === K.canon(b);

const summary = json('runs/' + RUN + '/summary.json');
const ledgerBytes = read('runs/' + RUN + '/ledger.json');
const ledger = JSON.parse(ledgerBytes.toString('utf8'));
check(createHash('sha256').update(ledgerBytes).digest('hex') === summary.ledgerHash, 'the ledger file does not hash to the summary\'s ledgerHash');
check(ledger.run === RUN && summary.run === RUN, 'run id mismatch');

// the pre-registration: same bytes as the commit made before the run, and that commit is older than the run
const preBytes = read('prereg.json');
const preHash = createHash('sha256').update(preBytes).digest('hex');
check(preHash === summary.preregHash, 'prereg.json is not the file the run was scored against');
const pc = json('prereg-commit.json');
try {
  const old = execFileSync('git', ['show', pc.sha + ':prereg.json'], { cwd: root });
  check(createHash('sha256').update(old).digest('hex') === preHash, 'prereg.json changed since the pre-registration commit ' + pc.sha.slice(0, 7));
  const when = execFileSync('git', ['show', '-s', '--format=%cI', pc.sha], { cwd: root }).toString().trim();
  check(Date.parse(when) < Date.parse(summary.started), 'the pre-registration commit (' + when + ') is not older than the run (' + summary.started + ')');
  say('prereg: byte-identical to commit ' + pc.sha.slice(0, 7) + ' (' + when + '), which is older than the run (' + summary.started + ')');
} catch (e) { check(false, 'could not read the pre-registration commit from git (fetch full history): ' + e.message.split('\n')[0]); }

// the run's nodes, by public key
const keys = new Map();
for (const n of summary.nodes) if (n.pub) keys.set(n.pub, n.name);
const pubKey = (hex) => createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(hex, 'hex').toString('base64url') }, format: 'jwk' });
const sigOk = (h) => { try { return verify(null, Buffer.from(K.hopSignable(h).payload), pubKey(h.node), Buffer.from(h.signature.sig, 'hex')); } catch { return false; } };

// gold labels from the data files, never from the ledger
const gold = {};
for (const j of K.JOBS) for (const x of json('data/' + j + '.json').heldOut) gold[x.id] = x.gold;
const devSet = json('data/dev.json'); for (const j of K.JOBS) for (const x of devSet[j]) gold[x.id] = x.gold;   // smoke runs use dev items

// rebuild each answer from the signed hop outputs — the kernel's one rule (outcomeFromHops)
const rebuild = (job, arm, hops) => K.outcomeFromHops(job, arm, hops).out;

let hopsSeen = 0, signed = 0;
const rebuilt = {};
for (const it of ledger.items) {
  const stations = it.arm === 'baseline' ? ['baseline'] : K.STATIONS[it.job];
  const c = K.verifyChain(it.hops, stations.slice(0, it.hops.length));
  check(c.ok && c.valid, it.key + '/' + it.item + ': ' + c.why);
  for (const h of it.hops) {
    hopsSeen++;
    check(h.run === RUN && h.arm === it.arm && h.job === it.job && h.item === it.item, it.key + '/' + it.item + ': a hop is about a different run, arm, job or item');
    check(keys.has(h.node), it.key + '/' + it.item + ': hop signed by a key that is not one of the run\'s nodes');
    if (check(sigOk(h), it.key + '/' + it.item + ': signature does not verify on hop ' + h.station)) signed++;
  }
  const out = rebuild(it.job, it.arm, it.hops);
  check(eq(out, it.record.out), it.key + '/' + it.item + ': the desk\'s record does not match the signed hops');
  check(eq(gold[it.item], it.record.gold), it.key + '/' + it.item + ': the gold label in the ledger is not the dataset\'s');
  const tokens = it.hops.reduce((a, h) => ({ prompt: a.prompt + h.promptTokens, completion: a.completion + h.completionTokens }), { prompt: 0, completion: 0 });
  check(eq(tokens, it.record.tokens), it.key + '/' + it.item + ': token counts do not match the hops');
  (rebuilt[it.key] ||= []).push({ item: it.item, gold: gold[it.item], out, startMs: it.record.startMs, endMs: it.record.endMs, tokens, gpuMs: it.hops.reduce((a, h) => a + h.ms, 0) });
}
say('hops: ' + hopsSeen + ' re-hashed and linked, ' + signed + ' Ed25519 signatures verified against ' + keys.size + ' node keys');

// re-score from the rebuilt records and compare with the committed summary
const FIELDS = ['n', 'completed', 'lost', 'duplicates', 'extra', 'latencyMs', 'throughputPerMin', 'perItem', 'e2e', 'teamAcc', 'intentAcc', 'replyPass', 'caught', 'silent', 'accuracy'];
const pick = (o) => Object.fromEntries(FIELDS.filter((f) => o && o[f] !== undefined).map((f) => [f, o[f]]));
const scored = {};
for (const [key, exp] of Object.entries(ledger.expected)) {
  const job = key === 'security' ? 'security' : key === 'hr' ? 'hr' : 'support';
  scored[key] = K.scoreRun(rebuilt[key] || [], exp, job);
  const committed = summary.arms[key] || summary.jobs[key];
  check(eq(pick(scored[key]), pick(committed)), key + ': re-scored from the signed hops, the numbers differ from the summary');
  say(key.padEnd(9) + ' ' + (job === 'support' ? 'end-to-end ' + scored[key].e2e : 'accuracy ' + scored[key].accuracy) + ' · ' + scored[key].completed + '/' + scored[key].n + ' done, ' + scored[key].lost + ' lost');
}
const cmp = (a, b) => (rebuilt[a] && rebuilt[b] ? K.pairedCompare(rebuilt[a], rebuilt[b], ledger.expected[a]) : null);
const compare = { chainVsBaseline: cmp('chain', 'baseline'), chainVsPool: cmp('chain', 'pool') };
check(eq(compare, summary.compare), 'the paired comparisons differ from the summary');
if (summary.prereg) {
  const coldStart = Math.max(...summary.nodes.filter((n) => typeof n.coldStartSec === 'number').map((n) => n.coldStartSec));
  const pre = K.evaluatePrereg(JSON.parse(preBytes.toString('utf8')), { chain: scored.chain, pool: scored.pool, baseline: scored.baseline, chainVsBaseline: compare.chainVsBaseline, chainVsPool: compare.chainVsPool, coldStartSec: coldStart, chainStallSec: summary.arms.chain.maxGapSec, poolStallSec: summary.arms.pool.maxGapSec });
  check(eq(pre, summary.prereg), 'the pre-registered verdicts differ from the summary');
  for (const r of pre.rules) say((r.pass ? 'PASS ' : 'FAIL ') + r.id + '  ' + JSON.stringify(r.value));
}
say('note: item start/end times are the desk\'s clock and are not signed; latency and stall figures rest on it.');
if (fails.length) { console.error('\nVERIFY FAILED (' + fails.length + '):\n  ' + [...new Set(fails)].slice(0, 30).join('\n  ')); process.exit(1); }
say('\nVERIFIED — run ' + RUN + ': every hop intact and signed by a run node; every score re-derived from the signed hops matches the summary.');
