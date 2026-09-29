// ── fallfloor runtime: a node (WebLLM on this machine's GPU) and a desk (the dispatcher), joined by WebRTC ──────────
// Everything that judges comes from the kernel above. This is the edge: keys, storage, the GPU, the wire.
const WEBLLM_URL = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm';
const RUN_PARAMS = { temperature: 0, top_p: 1, seed: 7 };
const $ = (id) => document.getElementById(id);
const nowIso = () => new Date().toISOString();
const hexOf = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const bytesOf = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));
const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
const unb64 = (s) => decodeURIComponent(escape(atob(s.trim())));
const uid = () => hexOf(crypto.getRandomValues(new Uint8Array(8)));

// ── storage (IndexedDB): identity, inbox, outbox, done — so a node that dies and comes back resumes its work ──
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('fallfloor', 1);
    r.onupgradeneeded = () => { const d = r.result; for (const s of ['identity', 'inbox', 'outbox', 'done']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function store(name, mode, fn) {
  const d = await FLOOR.db; return new Promise((res, rej) => { const tx = d.transaction(name, mode); const s = tx.objectStore(name); const out = fn(s); tx.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined); tx.onerror = () => rej(tx.error); });
}
const put = (s, k, v) => store(s, 'readwrite', (o) => o.put(v, k));
const del = (s, k) => store(s, 'readwrite', (o) => o.delete(k));
const get = (s, k) => store(s, 'readonly', (o) => o.get(k));
const all = (s) => store(s, 'readonly', (o) => o.getAll());

// ── identity: an Ed25519 key per node, kept in this browser; its public key names the node on every receipt ──
async function identity() {
  let kp = await get('identity', 'key');
  if (!kp) { kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']); await put('identity', 'key', kp); }
  const pub = hexOf(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { kp, pub };
}
async function signHop(r) { const p = hopSignable(r); const sig = await crypto.subtle.sign({ name: 'Ed25519' }, FLOOR.id.kp.privateKey, new TextEncoder().encode(p.payload)); return { ...r, signature: { alg: 'Ed25519', sig: hexOf(sig) } }; }
async function hopSigned(r) {
  try {
    if (!r || !r.signature || !/^[0-9a-f]{128}$/.test(r.signature.sig || '')) return false;
    const key = await crypto.subtle.importKey('raw', bytesOf(r.node), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, bytesOf(r.signature.sig), new TextEncoder().encode(hopSignable(r).payload));
  } catch { return false; }
}

// ── the floor object ──────────────────────────────────────────────────────────────────────────────────
const FLOOR = window.FLOOR = {
  name: null, id: null, db: null, broken: false, peers: new Map(), pending: new Map(), seen: new Set(), engine: null, models: [], data: {}, queue: [], busy: false,
  log: [], stats: { hops: 0, relayed: 0, rejected: 0, errors: 0, resent: 0, reloads: 0 }, sentAt: new Map(), stun: false,
  say(s) { const line = new Date().toISOString().slice(11, 19) + ' ' + s; this.log.push(line); if (this.log.length > 400) this.log.shift(); const el = $('nodeLog'); if (el) el.textContent = this.log.slice(-80).join('\n'); },
};

FLOOR.start = async function (name) {
  if (!/^[a-z][a-z0-9-]{0,23}$/.test(name)) throw new Error('a node name is lowercase letters, digits and dashes');
  this.name = name; this.db = idb(); this.id = await identity();
  this.say('node ' + name + ' · key ' + this.id.pub.slice(0, 12) + '…');
  for (const w of await all('inbox')) this.queue.push(w);            // work left from before a restart
  if (this.queue.length) this.say('resuming ' + this.queue.length + ' item(s) from before the restart');
  renderNode();
  this.pump();
  return { name, pub: this.id.pub };
};

// ── the model: WebLLM on this machine's GPU ─────────────────────────────────────────────────────────────
// a fresh engine: WebLLM from the CDN, the model from this browser's cache (downloaded once), then one plain answer
let lastProgress = '';
async function freshEngine(models) {
  const webllm = await import(WEBLLM_URL);
  if (FLOOR.engine) { try { await FLOOR.engine.unload(); } catch {} }
  FLOOR.engine = await webllm.CreateMLCEngine(models, { appConfig: { ...webllm.prebuiltAppConfig, useIndexedDBCache: true }, initProgressCallback: (p) => { lastProgress = p.text; const el = $('nodeLoad'); if (el) el.textContent = p.text; } });
  await FLOOR.engine.chat.completions.create({ model: models[0], messages: [{ role: 'user', content: 'Reply with the word ready.' }], max_tokens: 4, temperature: 0 });
}
FLOOR.load = async function (models) {
  if (!navigator.gpu) throw new Error('this browser has no WebGPU — the node cannot run a model here');
  const t0 = performance.now();
  this.models = models;
  await freshEngine(models);
  // one schema-constrained answer before any real work: WebLLM 0.2.85 sometimes breaks on an engine's constrained
  // requests on this laptop (a disposed grammar matcher); complete() then rebuilds the engine and asks again
  const filler = 'This is a warm-up message for a customer service assistant at a digital bank. It checks that the model can read a long instruction and answer in the required format. '.repeat(10);
  await complete(models[0], { messages: [{ role: 'system', content: filler + 'Answer with JSON: {"status": "ready"}' }, { role: 'user', content: 'Are you ready?' }], maxTokens: 12, schema: JSON.stringify({ type: 'object', properties: { status: { type: 'string', enum: ['ready'] } }, required: ['status'] }) });
  const last = lastProgress;
  const adapter = await navigator.gpu.requestAdapter();
  this.gpu = adapter && adapter.info ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture } : null;
  const loadMs = Math.round(performance.now() - t0);
  this.say('loaded ' + models.join(', ') + ' in ' + (loadMs / 1000).toFixed(1) + ' s' + (last ? ' · ' + last : ''));
  renderNode(); this.pump();
  return { loadMs, gpu: this.gpu };
};

async function complete(model, prompt) {
  const req = { ...RUN_PARAMS, model, messages: prompt.messages, max_tokens: prompt.maxTokens };
  if (prompt.schema) req.response_format = { type: 'json_object', schema: prompt.schema };
  for (let attempt = 1; ; attempt++) {
    const t0 = performance.now();
    try {
      const r = await FLOOR.engine.chat.completions.create(req);
      return { text: (r.choices[0].message.content || ''), ms: Math.round(performance.now() - t0), usage: r.usage || {} };
    } catch (e) {
      // an engine error is not an answer: rebuild the engine (model from this browser's cache) and ask again, up to 3 times
      if (attempt >= 3) throw e;
      FLOOR.stats.reloads++; FLOOR.say('engine error (' + String(e.message).slice(0, 80) + ') — rebuilding the engine, attempt ' + (attempt + 1));
      try { await freshEngine(FLOOR.models); }
      catch (e2) { FLOOR.broken = true; FLOOR.say('this browser process can no longer use the GPU (' + String(e2.message).slice(0, 90) + ') — the node needs a restart; its work stays in storage'); renderNode(); throw e2; }
    }
  }
}

// ── the wire: WebRTC data channels, signalled by pasting two codes (no signalling server) ─────────────────
const ICE = () => ({ iceServers: FLOOR.stun ? [{ urls: 'stun:stun.cloudflare.com:3478' }] : [] });
function gathered(pc) { return new Promise((res) => { if (pc.iceGatheringState === 'complete') return res(); const t = setTimeout(res, 4000); pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } }); }); }
function wire(pc, dc) {
  let said = false;
  const hello = () => { if (!said) said = send1(dc, { type: 'hello', id: uid(), from: FLOOR.name, to: '*', ttl: 0, pub: FLOOR.id.pub, models: FLOOR.models }); };
  dc.onopen = hello; if (dc.readyState === 'open') hello();   // an answered channel can arrive already open
  dc.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } onMessage(m, dc); };
  dc.onclose = () => { for (const [n, p] of FLOOR.peers) if (p.dc === dc) { FLOOR.peers.delete(n); FLOOR.say('link to ' + n + ' closed'); } renderNode(); };
  pc.onconnectionstatechange = () => { if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) { try { dc.close(); } catch {} } };
}
function send1(dc, m) { try { if (dc.readyState === 'open') { dc.send(JSON.stringify(m)); return true; } } catch {} return false; }

FLOOR.offer = async function () {
  const pc = new RTCPeerConnection(ICE()), dc = pc.createDataChannel('floor', { ordered: true });
  wire(pc, dc);
  await pc.setLocalDescription(await pc.createOffer()); await gathered(pc);
  const nonce = uid(); this.pending.set(nonce, pc);
  return b64(JSON.stringify({ v: 1, kind: 'fallfloor-signal', t: 'offer', nonce, from: this.name, pub: this.id.pub, sdp: pc.localDescription.sdp }));
};
FLOOR.answer = async function (blob) {
  const o = JSON.parse(unb64(blob));
  if (o.kind !== 'fallfloor-signal' || o.t !== 'offer') throw new Error('that is not an offer code');
  const pc = new RTCPeerConnection(ICE());
  pc.ondatachannel = (e) => wire(pc, e.channel);
  await pc.setRemoteDescription({ type: 'offer', sdp: o.sdp });
  await pc.setLocalDescription(await pc.createAnswer()); await gathered(pc);
  return b64(JSON.stringify({ v: 1, kind: 'fallfloor-signal', t: 'answer', nonce: o.nonce, from: this.name, pub: this.id.pub, sdp: pc.localDescription.sdp }));
};
FLOOR.accept = async function (blob) {
  const a = JSON.parse(unb64(blob));
  if (a.kind !== 'fallfloor-signal' || a.t !== 'answer') throw new Error('that is not an answer code');
  const pc = this.pending.get(a.nonce); if (!pc) throw new Error('no offer is waiting for that answer');
  await pc.setRemoteDescription({ type: 'answer', sdp: a.sdp }); this.pending.delete(a.nonce);
  return true;
};
FLOOR.linked = function (name) { const p = this.peers.get(name); return !!(p && p.dc.readyState === 'open'); };

// deliver: straight to the peer if linked, otherwise relay through the peers we have (meshos-style, bounded ttl)
function deliver(m) {
  const direct = FLOOR.peers.get(m.to);
  if (direct && send1(direct.dc, m)) return true;
  if (m.ttl <= 0) return false;
  let sent = false; const relayed = { ...m, ttl: m.ttl - 1 };
  for (const [n, p] of FLOOR.peers) if (n !== m.from && send1(p.dc, relayed)) sent = true;
  return sent;
}
// messages that need an ack are kept in the outbox until acked, and re-sent whenever the recipient says hello
async function sendReliable(m) {
  if (m.to === FLOOR.name && m.type === 'work') { await put('inbox', m.id, m); FLOOR.queue.push(m); return; }   // the next station is on this node: no wire
  await put('outbox', m.id, m); FLOOR.sentAt.set(m.id, Date.now()); deliver(m);
}
// an outbox message not acked within 8 s is sent again over a direct link (the receiver de-duplicates by id and re-acks)
setInterval(async () => {
  if (!FLOOR.db) return;
  const now = Date.now();
  for (const m of await all('outbox')) {
    const t = FLOOR.sentAt.get(m.id) || 0; const p = FLOOR.peers.get(m.to);
    if (now - t > 8000 && p && send1(p.dc, m)) { FLOOR.sentAt.set(m.id, now); FLOOR.stats.resent++; }
  }
}, 4000);
async function flushTo(name) { for (const m of await all('outbox')) if (m.to === name) deliver(m); }

async function onMessage(m, dc) {
  const v = validEnvelope(m); if (!v.ok) { FLOOR.stats.rejected++; return; }
  if (m.type === 'hello') {
    FLOOR.peers.set(m.from, { dc, pub: m.pub, models: m.models || [] });
    FLOOR.say('linked to ' + m.from + (m.models && m.models.length ? ' (' + m.models.join(', ') + ')' : ''));
    renderNode(); await flushTo(m.from); return;
  }
  if (m.to !== FLOOR.name) { if (!FLOOR.seen.has(m.id)) { FLOOR.seen.add(m.id); if (deliver(m)) FLOOR.stats.relayed++; } return; }
  if (m.type === 'ack') { await del('outbox', m.of); FLOOR.sentAt.delete(m.of); return; }
  if (FLOOR.seen.has(m.id)) { deliver({ type: 'ack', id: uid(), from: FLOOR.name, to: m.from, ttl: 3, of: m.id }); return; }
  FLOOR.seen.add(m.id);
  if (m.type === 'work') {
    const key = [m.work.run, m.work.arm, m.work.item, m.work.step].join('|');
    if (!(await get('done', key))) { await put('inbox', m.id, m); FLOOR.queue.push(m); }
    deliver({ type: 'ack', id: uid(), from: FLOOR.name, to: m.from, ttl: 3, of: m.id });
    FLOOR.pump(); return;
  }
  if (m.type === 'result') {
    deliver({ type: 'ack', id: uid(), from: FLOOR.name, to: m.from, ttl: 3, of: m.id });
    if (FLOOR.desk) FLOOR.desk.onResult(m.result);
  }
}

// ── a station at work: check the chain so far, run the model, sign the hop, pass it on ───────────────────
FLOOR.pump = async function () {
  if (this.busy || !this.engine || this.broken) return;
  const m = this.queue.shift(); if (!m) return;
  this.busy = true;
  try { await work(m); } catch (e) { this.say('work failed: ' + e.message); }
  finally { this.busy = false; renderNode(); setTimeout(() => FLOOR.pump(), 0); }
};

async function work(m) {
  const w = m.work, station = w.stations[w.step];
  const doneKey = [w.run, w.arm, w.item, w.step].join('|');
  // 1 · the chain so far must be intact and signed, or this node refuses to add to it
  if (w.hops.length) {
    const c = verifyChain(w.hops, w.stations.slice(0, w.hops.length));
    const sigs = await Promise.all(w.hops.map(hopSigned));
    if (!c.valid || !sigs.every(Boolean)) { FLOOR.stats.rejected++; FLOOR.say('REFUSED ' + w.item + ': ' + (c.valid ? 'a hop signature does not verify' : c.why)); await del('inbox', m.id); return; }
  }
  // 2 · the station's prompt, from the kernel, and the model's answer
  const ctx = { text: w.text, examples: w.examples[station] || [], team: w.state.team, intent: w.state.intent };
  const pr = buildPrompt(w.job, station, ctx);
  if (!pr.ok) throw new Error(pr.why);
  const model = w.model || FLOOR.models[0];
  let r;
  try { r = await complete(model, pr); }
  catch (e) {
    if (FLOOR.broken) throw e;                                  // the GPU is gone: leave the item in the inbox for the restarted node
    FLOOR.stats.errors++; FLOOR.say('model error on ' + w.item + ' (' + station + '): ' + e.message + ' — answered as nothing'); r = { text: '', ms: 0, usage: {} };
  }
  let output, next = { ...w.state }, exit = false;
  if (station === 'reply') { output = r.text.trim(); next.reply = output; next.replyCheck = checkReply(output, w.state.intent); }
  else if (station === 'baseline') { const b = parseBaseline(r.text); output = { intent: b.intent, reply: b.reply }; next.intent = b.intent; next.team = b.intent ? teamOf(b.intent) : null; next.reply = b.reply; }
  else {
    const p = readStation(pr, r.text); output = p.value;
    if (station === 'route') { next.team = p.value; if (p.value === null) { next.bounced = true; exit = true; } }
    if (station === 'intent') { if (p.value === null || p.value === NONE) { next.bounced = true; exit = true; } else next.intent = p.value; }
    if (station === 'screen' || station === 'helpdesk') next.label = p.value;
  }
  // 3 · the signed, hash-linked receipt of this hop
  const hr = hopReceipt({ run: w.run, arm: w.arm, job: w.job, item: w.item, station, node: FLOOR.id.pub, model, input: sha256(canon({ text: w.text, state: w.state })).hash,
    output, prev: w.hops.length ? w.hops[w.hops.length - 1].hash : START, promptTokens: r.usage.prompt_tokens || 0, completionTokens: r.usage.completion_tokens || 0, ms: r.ms, at: nowIso() });
  if (!hr.ok) throw new Error(hr.why);
  const hop = await signHop(hr.receipt);
  FLOOR.stats.hops++;
  const hops = [...w.hops, hop];
  // 4 · pass it on — to the next station, or back to the desk when the line is done (or has stopped itself)
  const last = exit || w.step + 1 >= w.stations.length;
  const msg = last
    ? { type: 'result', id: uid(), from: FLOOR.name, to: w.route[w.route.length - 1], ttl: 3, result: { run: w.run, arm: w.arm, job: w.job, item: w.item, out: next, hops } }
    : { type: 'work', id: uid(), from: FLOOR.name, to: w.route[w.step + 1], ttl: 3, work: { ...w, step: w.step + 1, state: next, hops } };
  await sendReliable(msg);
  await put('done', doneKey, true);
  await del('inbox', m.id);
  FLOOR.say(w.item + ' · ' + station + ' → ' + (typeof output === 'string' ? output.slice(0, 40) : JSON.stringify(output).slice(0, 60)) + ' (' + r.ms + ' ms)');
}

// ── ask one station directly: the prompt from the kernel, this node's model, the parsed answer ────────────────
FLOOR.ask = async function (job, station, ctx) {
  if (!this.engine) throw new Error('load a model first');
  const pr = buildPrompt(job, station, ctx); if (!pr.ok) throw new Error(pr.why);
  const r = await complete(this.models[0], pr);
  const parsed = station === 'reply' ? { reply: r.text.trim(), check: checkReply(r.text.trim(), ctx.intent) } : station === 'baseline' ? parseBaseline(r.text) : readStation(pr, r.text);
  return { text: r.text, parsed, ms: r.ms, promptTokens: r.usage.prompt_tokens || 0, completionTokens: r.usage.completion_tokens || 0 };
};

// ── the desk: dispatches the company's work, keeps the ledger, never runs a model ──────────────────────────
FLOOR.dataset = async function (job) { if (!this.data[job]) this.data[job] = await (await fetch('data/' + job + '.json', { cache: 'no-store' })).json(); return this.data[job]; };

FLOOR.runJob = async function ({ run, arm, job, nodes, limit, window = 3, model = null, reassignMs = 45000, maxIdleMs = 600000, set = 'heldOut' }) {
  const ds = await this.dataset(job);
  const pool = set === 'dev' ? (await this.dataset('dev'))[job] : ds.heldOut;
  const items = pool.slice(0, limit || pool.length);
  const examples = job === 'support' ? { route: ds.examples.route, intent: ds.examples.intent, baseline: [...ds.examples.route, ...ds.examples.intent] } : ds.examples;
  const desk = this.desk = { run, arm, job, records: new Map(), dupes: 0, rejected: 0, pending: new Map(), completions: [], started: Date.now() };
  const expected = items.map((x) => x.id);
  const queue = [...items];
  const stations = arm === 'baseline' ? ['baseline'] : STATIONS[job];
  desk.onResult = async (res) => {
    if (res.run !== run || res.arm !== arm) return;
    const c = verifyChain(res.hops, (arm === 'baseline' ? ['baseline'] : STATIONS[job]).slice(0, res.hops.length));
    const sigs = await Promise.all(res.hops.map(hopSigned));
    if (!c.valid || !sigs.every(Boolean)) { desk.rejected++; FLOOR.say('desk REFUSED a result for ' + res.item); return; }
    if (desk.records.has(res.item)) { desk.dupes++; return; }
    const p = desk.pending.get(res.item); desk.pending.delete(res.item);
    const gold = items.find((x) => x.id === res.item).gold;
    const tokens = res.hops.reduce((a, h) => ({ prompt: a.prompt + h.promptTokens, completion: a.completion + h.completionTokens }), { prompt: 0, completion: 0 });
    const out = outcomeFromHops(job, arm, res.hops).out;           // the answer is what the signed hops say, nothing else
    desk.records.set(res.item, { item: res.item, gold, out, hops: res.hops, startMs: p ? p.startMs : null, endMs: Date.now(), tokens, gpuMs: res.hops.reduce((a, h) => a + h.ms, 0) });
    desk.completions.push(Date.now());
    renderDesk(run, arm, job, expected.length);
  };
  const live = () => nodes.filter((n) => FLOOR.linked(n));
  const dispatch = async (x, node) => {
    const rt = arm === 'chain' ? routeFor('chain', job, nodes) : routeFor(arm, job, [node]);
    const work = { run, arm, job, item: x.id, text: x.text, route: rt.route, stations, step: 0, state: {}, hops: [], examples, model };
    desk.pending.set(x.id, { item: x.id, node: rt.route[0], since: Date.now(), startMs: desk.pending.get(x.id)?.startMs ?? Date.now() });
    await sendReliable({ type: 'work', id: uid(), from: FLOOR.name, to: rt.route[0], ttl: 3, work });
  };
  const load = (n) => [...desk.pending.values()].filter((p) => p.node === n).length;
  let lastSize = 0, lastProgress = Date.now();
  while (desk.records.size < expected.length) {
    if (desk.records.size > lastSize) { lastSize = desk.records.size; lastProgress = Date.now(); }
    if (Date.now() - lastProgress > maxIdleMs) { FLOOR.say('no progress for ' + Math.round(maxIdleMs / 60000) + ' min — stopping; unfinished items count as lost'); break; }
    // pool: work stuck on a node that has gone is handed to a live one (the chain cannot do this — each station has one node)
    if (arm !== 'chain') {
      const mv = reassign([...desk.pending.values()], live(), Date.now(), reassignMs);
      for (const m of mv.moves) { FLOOR.say('reassigning ' + m.item + ' from ' + m.from + ' to ' + m.to); await dispatch(items.find((x) => x.id === m.item), m.to); }
    }
    while (queue.length && desk.pending.size < window) {
      const x = queue.shift();
      if (arm === 'chain') await dispatch(x, nodes[0]);
      else { const l = live(); if (!l.length) { queue.unshift(x); break; } const n = l.slice().sort((a, b) => load(a) - load(b) || (a < b ? -1 : 1))[0]; await dispatch(x, n); }
    }
    await new Promise((r) => setTimeout(r, 250));
    if (FLOOR.abortRun) break;
  }
  const records = [...desk.records.values()];
  const score = scoreRun(records, expected, job);
  const gaps = desk.completions.map((t, i) => (i === 0 ? t - desk.started : t - desk.completions[i - 1]));
  score.maxGapSec = gaps.length ? Math.round(Math.max(...gaps) / 100) / 10 : null;
  score.rejected = desk.rejected; score.duplicatesDropped = desk.dupes;
  return { run, arm, job, nodes, expected, records, score };
};

// ── page wiring (the human way to be a node or a desk) ─────────────────────────────────────────────────
function renderNode() {
  const el = $('nodeStatus'); if (!el || !FLOOR.name) return;
  el.textContent = FLOOR.name + ' · ' + (FLOOR.models.length ? FLOOR.models.join(', ') : 'no model loaded') + ' · links: ' + ([...FLOOR.peers.keys()].join(', ') || 'none') + ' · hops signed: ' + FLOOR.stats.hops + ' · queue: ' + FLOOR.queue.length;
}
function renderDesk(run, arm, job, n) { const el = $('deskStatus'); if (el && FLOOR.desk) el.textContent = run + ' · ' + arm + ' · ' + job + ': ' + FLOOR.desk.records.size + '/' + n + ' done'; }
window.addEventListener('DOMContentLoaded', () => {
  const q = new URLSearchParams(location.search);
  if (q.get('node')) { const d = $('runYourself'); if (d) d.open = true; FLOOR.start(q.get('node')).catch((e) => FLOOR.say(e.message)); }
  const on = (id, fn) => { const b = $(id); if (b) b.addEventListener('click', () => fn().catch((e) => FLOOR.say('✗ ' + e.message))); };
  on('btnStart', async () => { await FLOOR.start(($('nodeName').value || 'node-' + uid().slice(0, 4)).toLowerCase()); });
  on('btnLoad', async () => { if (!FLOOR.name) await FLOOR.start('node-' + uid().slice(0, 4)); await FLOOR.load([$('nodeModel').value]); });
  on('btnOffer', async () => { if (!FLOOR.name) await FLOOR.start('node-' + uid().slice(0, 4)); FLOOR.stun = $('useStun').checked; $('sigOut').value = await FLOOR.offer(); });
  on('btnAnswer', async () => { if (!FLOOR.name) await FLOOR.start('node-' + uid().slice(0, 4)); FLOOR.stun = $('useStun').checked; $('sigOut').value = await FLOOR.answer($('sigIn').value); });
  on('btnAccept', async () => { await FLOOR.accept($('sigIn').value); FLOOR.say('answer accepted — the link opens in a moment'); });
});
