#!/usr/bin/env node
// tools/run-floor.mjs — run the modelled company on this machine's browsers, start to finish, and write the receipts.
//   node tools/run-floor.mjs --run <id> [--limit N] [--no-kill] [--skip-baseline]
// What it does, in order (every step is logged in the run's timeline):
//   1 · launches one Chrome process per node, each with its OWN profile (its own storage, keys and model copy), headless
//   2 · each node loads its model through WebLLM on this machine's GPU; cold start = launch → first answer, measured,
//       with the bytes downloaded from the model host counted
//   3 · links the nodes with WebRTC by carrying their offer/answer codes between them — exactly what a person pastes.
//       There is no signalling server and no relay server.
//   4 · the company's day: security screening and the HR helpdesk on the pool; then customer support as a CHAIN (with the
//       kill test), as a POOL (with the same kill test), and on the one-model BASELINE
//   5 · scores everything with the kernel, evaluates the pre-registered rules, and writes runs/<id>/{ledger,summary,env}.json
// It drives the page; it does not judge anything itself.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, '..');
const K = await import(pathToFileURL(join(root, 'kernel.mjs')).href);
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/sjgan/Downloads/si-didy-agent/node_modules/playwright');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const argv = process.argv.slice(2), flag = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const RUN = flag('--run'); if (!RUN || !/^[a-z0-9-]+$/.test(RUN)) { console.error('usage: run-floor.mjs --run <id>'); process.exit(1); }
const LIMIT = flag('--limit') ? Number(flag('--limit')) : undefined;
const KILL = !argv.includes('--no-kill'), BASELINE = !argv.includes('--skip-baseline');
const REUSE = argv.includes('--reuse');                      // smoke tests only: keep node profiles (and their model copies); the summary says so
const ONLY = flag('--only') ? flag('--only').split(',') : null; // smoke tests only: run a subset of security,hr,chain,pool,baseline
const want = (k) => !ONLY || ONLY.includes(k);
const SET = argv.includes('--dev') ? 'dev' : 'heldOut';        // --dev: smoke tests on the development items; the measured run uses the held-out items
const PREREG = JSON.parse(readFileSync(join(root, 'prereg.json'), 'utf8'));
const STATION_MODEL = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', BASE_MODEL = 'Qwen2.5-3B-Instruct-q4f16_1-MLC';
const PROFILES = 'C:/Users/sjgan/.ffnodes/' + RUN;          // short path: Chrome's cache storage breaks on long Windows paths
const PORT = 8870;
const events = [], T0 = Date.now();
const OUT = join(root, 'runs', RUN); mkdirSync(join(OUT, 'nodes'), { recursive: true }); writeFileSync(join(OUT, 'timeline.log'), '');
const ev = (what) => { const e = { at: new Date().toISOString(), t: Math.round((Date.now() - T0) / 1000), what }; events.push(e); const line = '[' + e.t + 's] ' + what; console.log(line); appendFileSync(join(OUT, 'timeline.log'), line + '\n'); };
const note = (line) => appendFileSync(join(OUT, 'timeline.log'), '      ' + line + '\n');   // watch-only lines: in the log file, not the summary

// ── a static server for the repo (localhost only) ──
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript', '.mjs': 'text/javascript', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };
const srv = createServer((req, res) => {
  const p = join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  if (!p.startsWith(root) || !existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(readFileSync(p));
});
await new Promise((r) => srv.listen(PORT, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + PORT + '/index.html';

// ── nodes: one Chrome process per node, each with its own profile ──
const nodes = {}, nodeInfo = {};
async function launch(name, fresh) {
  const dir = PROFILES + '/' + name;
  if (fresh && !REUSE) rmSync(dir, { recursive: true, force: true });
  const t0 = Date.now();
  const ctx = await chromium.launchPersistentContext(dir, { executablePath: CHROME, headless: true, viewport: { width: 1200, height: 900 },
    args: ['--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const page = ctx.pages()[0] || await ctx.newPage();
  const n = { name, ctx, page, t0, downloaded: 0 };
  page.on('response', async (r) => { if (/huggingface\.co|hf\.co|cdn-lfs/.test(r.url())) { const len = Number(r.headers()['content-length'] || 0); n.downloaded += len; } });
  page.on('pageerror', (e) => note(name + ' page error: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') note(name + ' console error: ' + m.text().slice(0, 300)); });
  await page.goto(BASE + '?node=' + name);
  await page.waitForFunction(() => window.FLOOR && FLOOR.id && FLOOR.id.pub, null, { timeout: 60000 });
  n.pub = await page.evaluate(() => FLOOR.id.pub);
  nodes[name] = n;
  return n;
}
async function loadModel(n, model, since = n.t0) {
  const r = await n.page.evaluate(async (m) => { const x = await FLOOR.load([m]); const t = performance.now(); const a = await FLOOR.engine.chat.completions.create({ model: m, messages: [{ role: 'user', content: 'Reply with the word ready.' }], max_tokens: 4, temperature: 0 }); return { ...x, firstAnswerMs: Math.round(performance.now() - t), said: a.choices[0].message.content }; }, model);
  n.model = model; n.coldStartSec = Math.round((Date.now() - since) / 100) / 10; n.loadMs = r.loadMs; n.gpu = r.gpu;
  if (!nodeInfo[n.name]) nodeInfo[n.name] = { model, pub: n.pub, coldStartSec: n.coldStartSec, downloadMB: Math.round(n.downloaded / 1048576), loadSec: Math.round(r.loadMs / 100) / 10 };
  else nodeInfo[n.name].restartSec = n.coldStartSec;
  ev(n.name + ' loaded ' + model + ' — first answer ' + n.coldStartSec + ' s after launch (downloaded ' + Math.round(n.downloaded / 1048576) + ' MB this launch)');
  return r;
}
async function link(a, b) {
  const offer = await a.page.evaluate(() => FLOOR.offer());
  const answer = await b.page.evaluate((o) => FLOOR.answer(o), offer);
  await a.page.evaluate((x) => FLOOR.accept(x), answer);
  await a.page.waitForFunction((peer) => FLOOR.linked(peer), b.name, { timeout: 30000 });
  await b.page.waitForFunction((peer) => FLOOR.linked(peer), a.name, { timeout: 30000 });
}
const nodeStats = {};                                    // per node, summed over every launch of it
async function dumpLog(n) {
  if (n.dumped) return; n.dumped = true;
  try {
    const l = await n.page.evaluate(() => ({ log: FLOOR.log, stats: FLOOR.stats, queue: FLOOR.queue.length }));
    appendFileSync(join(OUT, 'nodes', n.name + '.log'), l.log.join('\n') + '\n-- stats ' + JSON.stringify(l.stats) + ' queue ' + l.queue + '\n');
    const t = nodeStats[n.name] ||= {}; for (const [k, v] of Object.entries(l.stats)) t[k] = (t[k] || 0) + v;
  } catch {}
}
async function kill(n) { await dumpLog(n); await n.ctx.close(); delete nodes[n.name]; }
async function watch() {
  const rows = [];
  for (const n of Object.values(nodes)) { try { rows.push(n.name + ' ' + JSON.stringify(await n.page.evaluate(() => ({ q: FLOOR.queue.length, busy: FLOOR.busy, hops: FLOOR.stats.hops, rej: FLOOR.stats.rejected, links: [...FLOOR.peers.keys()].join('+'), desk: FLOOR.desk ? FLOOR.desk.records.size + ' done, ' + FLOOR.desk.pending.size + ' pending' : undefined, last: FLOOR.log.slice(-1)[0] })))); } catch (e) { rows.push(n.name + ' ?'); } }
  note('watch ' + Math.round((Date.now() - T0) / 1000) + 's · ' + rows.join(' | '));
}
const watcher = setInterval(() => { watch().catch(() => {}); }, 30000);

// ── keeping nodes alive: a browser process that loses its GPU cannot get it back; restart it and say so ──
const PEERS = { n1: ['desk', 'n2'], n2: ['desk', 'n1', 'n3'], n3: ['desk', 'n2'], n4: ['desk'] };
const restarting = new Set(), unplanned = [], loadFaults = [];
let currentArm = 'setup';
async function bringUp(name, model, fresh) {
  const t0 = Date.now();
  for (let attempt = 1; ; attempt++) {
    const n = await launch(name, fresh && attempt === 1);
    let ok = true;
    try { await loadModel(n, model, t0); } catch (e) { ok = false; note(name + ' load failed: ' + String(e.message).split('\n')[0].slice(0, 200)); }
    if (ok) { try { ok = !(await n.page.evaluate(() => FLOOR.broken)); } catch { ok = false; } }
    if (ok) { if (attempt > 1) nodeInfo[name].launchesToLoad = attempt; return n; }
    loadFaults.push({ node: name, at: new Date().toISOString(), attempt });
    if (attempt >= 3) throw new Error(name + ' could not get a working GPU after 3 launches');
    ev(name + ': the GPU faulted while the model was loading — relaunching its browser process (attempt ' + (attempt + 1) + ')');
    await kill(n);
  }
}
async function heal() {
  for (const n of Object.values(nodes)) {
    if (n.name === 'desk' || restarting.has(n.name)) continue;
    let broken; try { broken = await n.page.evaluate(() => FLOOR.broken); } catch { broken = !restarting.has(n.name) && !!nodes[n.name]; }
    if (!broken || restarting.has(n.name) || !nodes[n.name]) continue;
    restarting.add(n.name);
    try {
      ev('UNPLANNED RESTART: ' + n.name + ' lost its GPU during the ' + currentArm + ' — relaunching its browser process with the same profile; its unfinished work waits in its storage');
      unplanned.push({ node: n.name, arm: currentArm, at: new Date().toISOString() });
      await kill(n);
      const m = await bringUp(n.name, n.model, false);
      for (const p of PEERS[n.name]) if (nodes[p]) await link(nodes[p], m);
      ev(n.name + ' re-joined after the unplanned restart (re-linked to ' + PEERS[n.name].filter((p) => nodes[p]).join(', ') + ')');
    } catch (e) { ev('unplanned restart of ' + n.name + ' failed: ' + e.message); }
    finally { restarting.delete(n.name); }
  }
}
let healing = false;
const healer = setInterval(() => { if (healing) return; healing = true; heal().catch((e) => note('heal: ' + e.message)).finally(() => { healing = false; }); }, 10000);

// ── a job on the desk, with the kill test watched from outside ──
async function runJob(desk, opts, killPlan) {
  const job = desk.page.evaluate((o) => FLOOR.runJob(o).then((r) => JSON.parse(JSON.stringify(r))), opts);
  if (killPlan) {
    const target = killPlan.node;
    await desk.page.waitForFunction(([n, run, arm, job]) => FLOOR.desk && FLOOR.desk.run === run && FLOOR.desk.arm === arm && FLOOR.desk.job === job && FLOOR.desk.records.size >= n, [killPlan.after, opts.run, opts.arm, opts.job], { timeout: 0, polling: 1000 });
    while (restarting.has(target) || !nodes[target]) await new Promise((r) => setTimeout(r, 1000));
    restarting.add(target);
    ev('KILL: closing ' + target + ' (its browser process) after ' + killPlan.after + ' results in the ' + opts.arm);
    await kill(nodes[target]);
    await new Promise((r) => setTimeout(r, killPlan.downSec * 1000));
    ev('RESTART: relaunching ' + target + ' with the same profile');
    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const n = await bringUp(target, STATION_MODEL, false);
          for (const peer of PEERS[target]) if (nodes[peer]) await link(nodes[peer], n);
          ev(target + ' re-joined: re-linked to ' + PEERS[target].filter((p) => nodes[p]).join(', ') + ' by pasting codes again');
          break;
        } catch (e) {
          ev('restart of ' + target + ' failed (' + String(e.message).split('\n')[0].slice(0, 120) + ')' + (attempt < 3 ? ' — trying again in 30 s' : ' — giving up; its unfinished items will count as lost'));
          if (nodes[target]) await kill(nodes[target]);
          await new Promise((r) => setTimeout(r, 30000));
        }
      }
    } finally { restarting.delete(target); }
  }
  return await job;
}

try {
  ev('run ' + RUN + ' — one laptop; each node is its own headless Chrome process with its own profile');
  const desk = await launch('desk', true);
  const env = await desk.page.evaluate(async () => { const a = await navigator.gpu.requestAdapter(); return { ua: navigator.userAgent, gpu: a && a.info ? { vendor: a.info.vendor, architecture: a.info.architecture } : null, cores: navigator.hardwareConcurrency, memoryGB: navigator.deviceMemory }; });
  for (const name of ['n1', 'n2', 'n3']) await bringUp(name, STATION_MODEL, true);
  for (const name of ['n1', 'n2', 'n3']) await link(desk, nodes[name]);
  await link(nodes.n1, nodes.n2); await link(nodes.n2, nodes.n3);
  ev('mesh up: desk↔n1, desk↔n2, desk↔n3, n1↔n2, n2↔n3 (WebRTC data channels)');

  const results = {};
  ev('security screening on the pool');
  currentArm = 'security job';
  if (want('security')) results.security = await runJob(desk, { run: RUN, arm: 'company', job: 'security', nodes: ['n1', 'n2', 'n3'], limit: LIMIT, set: SET, window: 3, reassignMs: 45000 });
  if (results.security) ev('security done: ' + results.security.score.completed + '/' + results.security.score.n + ', accuracy ' + results.security.score.accuracy);
  ev('HR helpdesk on the pool');
  currentArm = 'HR job';
  if (want('hr')) results.hr = await runJob(desk, { run: RUN, arm: 'company', job: 'hr', nodes: ['n1', 'n2', 'n3'], limit: LIMIT, set: SET, window: 3, reassignMs: 45000 });
  if (results.hr) ev('HR done: ' + results.hr.score.completed + '/' + results.hr.score.n + ', accuracy ' + results.hr.score.accuracy);

  const killAt = LIMIT ? Math.max(1, Math.floor(LIMIT * 0.4)) : 40;
  ev('support as a CHAIN: n1 route → n2 intent → n3 reply');
  currentArm = 'support chain';
  if (want('chain')) results.chain = await runJob(desk, { run: RUN, arm: 'chain', job: 'support', nodes: ['n1', 'n2', 'n3'], limit: LIMIT, set: SET, window: 3 }, KILL ? { node: 'n2', after: killAt, downSec: 60, relink: ['desk', 'n1', 'n3'] } : null);
  if (results.chain) ev('chain done: ' + results.chain.score.completed + '/' + results.chain.score.n + ', e2e ' + results.chain.score.e2e);
  ev('support as a POOL: each node runs the whole line on its share');
  currentArm = 'support pool';
  if (want('pool')) results.pool = await runJob(desk, { run: RUN, arm: 'pool', job: 'support', nodes: ['n1', 'n2', 'n3'], limit: LIMIT, set: SET, window: 3, reassignMs: 45000 }, KILL ? { node: 'n2', after: killAt, downSec: 60, relink: ['desk', 'n1', 'n3'] } : null);
  if (results.pool) ev('pool done: ' + results.pool.score.completed + '/' + results.pool.score.n + ', e2e ' + results.pool.score.e2e);

  if (BASELINE && want('baseline')) {
    for (const name of ['n1', 'n2', 'n3']) { restarting.add(name); await kill(nodes[name]); }
    ev('closed n1–n3 to free the GPU for the baseline model');
    const n4 = await bringUp('n4', BASE_MODEL, true); await link(desk, n4);
    ev('support on the ONE-MODEL BASELINE: n4, ' + BASE_MODEL + ', one prompt per item');
    currentArm = 'support baseline';
    results.baseline = await runJob(desk, { run: RUN, arm: 'baseline', job: 'support', nodes: ['n4'], limit: LIMIT, set: SET, window: 3, model: BASE_MODEL, reassignMs: 10 * 60000 });
    ev('baseline done: ' + results.baseline.score.completed + '/' + results.baseline.score.n + ', e2e ' + results.baseline.score.e2e);
  }

  // ── the ledger: every item, every signed hop, and the desk's record used for scoring ──
  const dir = OUT;
  const items = [], expected = {};
  for (const [key, r] of Object.entries(results)) {
    expected[key] = r.expected;
    for (const rec of r.records) { const { hops, ...record } = rec; items.push({ key, arm: r.arm, job: r.job, item: rec.item, hops, record }); }
  }
  const ledger = { v: 1, kind: 'fallfloor-ledger', run: RUN, expected, items };
  writeFileSync(join(dir, 'ledger.json'), JSON.stringify(ledger) + '\n');
  const ledgerHash = createHash('sha256').update(readFileSync(join(dir, 'ledger.json'))).digest('hex');

  clearInterval(watcher); clearInterval(healer);
  for (const n of Object.values(nodes)) await dumpLog(n);     // every node's counters, before the summary
  // ── did Windows put the laptop into standby during the run? (it resets the GPU) — read from the System event log ──
  let standby = null;
  try { standby = Number(execFileSync('powershell', ['-NoProfile', '-Command', "(Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Microsoft-Windows-Kernel-Power'; Id=506; StartTime=[datetime]'" + events[0].at + "'} -ErrorAction SilentlyContinue | Measure-Object).Count"]).toString().trim()); } catch {}
  // ── the summary, from the kernel ──
  const recs = (k) => (results[k] ? results[k].records : []);
  const exp = (k) => (results[k] ? results[k].expected : []);
  const arm = (k) => (results[k] ? { ...results[k].score } : null);
  const span = (k) => { const r = recs(k); if (!r.length) return null; return (Math.max(...r.map((x) => x.endMs)) - Math.min(...r.map((x) => x.startMs))) / 1000; };
  const perItem = (k, job) => { const s = arm(k); return s ? { promptTokens: s.perItem.promptTokens, completionTokens: s.perItem.completionTokens, gpuSeconds: Math.round(1000 * span(k) / s.completed) / 1000, how: 'tokens measured per item; laptop seconds per item = the whole ' + k + ' run\'s wall time ÷ items (the GPU is shared and busy throughout)' } : null; };
  const compare = { chainVsBaseline: results.baseline && results.chain ? K.pairedCompare(recs('chain'), recs('baseline'), exp('chain')) : null, chainVsPool: results.chain && results.pool ? K.pairedCompare(recs('chain'), recs('pool'), exp('chain')) : null };
  const nodeRows = [{ name: 'desk', role: 'desk — dispatch and ledger, no model', pub: desk.pub, model: null, coldStartSec: null, downloadMB: null }];
  const roleOf = { n1: 'station: route (chain) · whole line (pool)', n2: 'station: intent (chain) · whole line (pool) · killed and restarted', n3: 'station: reply (chain) · whole line (pool)', n4: 'one-model baseline' };
  for (const [name, info] of Object.entries(nodeInfo)) nodeRows.push({ name, role: roleOf[name], pub: info.pub, model: info.model, coldStartSec: info.coldStartSec, restartSec: info.restartSec ?? null, downloadMB: info.downloadMB, loadSec: info.loadSec });
  const coldStart = Math.max(...nodeRows.filter((n) => n.coldStartSec !== null).map((n) => n.coldStartSec));
  const summary = {
    v: 1, kind: 'fallfloor-summary', run: RUN, started: events[0].at, finished: new Date().toISOString(),
    machine: 'ONE laptop: ' + (env.gpu ? env.gpu.vendor + ' ' + env.gpu.architecture + ' GPU (WebGPU)' : 'GPU unknown') + ', ' + env.cores + ' logical cores. Each node was its own headless Chrome process with its own profile, linked by real WebRTC data channels on this machine; the harness carried the signalling codes between them as a person would paste them. No signalling server, no relay server, no cloud model.',
    env, nodes: nodeRows, events,
    arms: { chain: arm('chain'), pool: arm('pool'), baseline: arm('baseline') },
    jobs: { security: arm('security'), hr: arm('hr') },
    compare, costPerItem: { support: perItem('chain', 'support'), security: perItem('security', 'security'), hr: perItem('hr', 'hr') },
    ledgerPath: 'runs/' + RUN + '/ledger.json', ledgerHash, hops: items.reduce((a, x) => a + x.hops.length, 0),
    preregHash: createHash('sha256').update(readFileSync(join(root, 'prereg.json'))).digest('hex'),
    limit: LIMIT || null, reusedProfiles: REUSE, only: ONLY, set: SET,
    faults: { unplannedRestarts: unplanned, gpuFaultsWhileLoading: loadFaults, standbyEntriesDuringRun: standby, nodeCounters: nodeStats, note: 'A browser process that loses its GPU (the driver reports the device removed) cannot use it again; the harness relaunches it with the same profile, and its unfinished work resumes from its own storage. Every such restart is listed here and in the timeline.' },
  };
  if (results.baseline && results.chain && results.pool) summary.prereg = K.evaluatePrereg(PREREG, { chain: summary.arms.chain, pool: summary.arms.pool, baseline: summary.arms.baseline, chainVsBaseline: compare.chainVsBaseline, chainVsPool: compare.chainVsPool, coldStartSec: coldStart, chainStallSec: summary.arms.chain.maxGapSec, poolStallSec: summary.arms.pool.maxGapSec });
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
  writeFileSync(join(dir, 'env.json'), JSON.stringify({ env, nodes: nodeRows, profiles: PROFILES, chrome: CHROME, models: { station: STATION_MODEL, baseline: BASE_MODEL } }, null, 1) + '\n');
  ev('wrote runs/' + RUN + '/ (ledger ' + ledgerHash.slice(0, 12) + '…, ' + summary.hops + ' hops)');
  if (summary.prereg) for (const r of summary.prereg.rules) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.id + '  ' + JSON.stringify(r.value));
} finally {
  clearInterval(watcher); clearInterval(healer);
  for (const n of Object.values(nodes)) { await dumpLog(n); try { await n.ctx.close(); } catch {} }
  srv.close();
}
