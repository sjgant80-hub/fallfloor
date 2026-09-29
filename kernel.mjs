// fallfloor — the pure core of a company whose AI work runs on the laptops it already owns.
// Browser nodes (WebLLM on WebGPU) pass work to each other over WebRTC, meshos-style: no server in the middle.
// Everything that JUDGES lives here — prompts, parsing, the reply gate, grading against the datasets' own labels,
// hop receipts, scoring, the pre-registered thresholds and the cost arithmetic — so the page, the harness and CI
// all run the same code, and the mutation gate proves the tests guard it.
// No I/O here. Pure and total: garbage in → { ok:false, why }, never a throw.

const isStr = (v) => typeof v === 'string';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const HEX = /^[0-9a-f]+$/;

// ── SHA-256 + canonical JSON (the same proven pair the gate runs on) ────────────────────────────
const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256(text) {
  if (!isStr(text)) return { ok: false, why: 'sha256 takes a string' };
  const data = new TextEncoder().encode(text);
  const len = data.length;
  const padded = new Uint8Array((((len + 8) >> 6) << 6) + 64);
  padded.set(data);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  const bitLen = len * 8;
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 4294967296));
  dv.setUint32(padded.length - 4, bitLen >>> 0);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let i = 0; i < padded.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4);
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15], y = w[t - 2];
      const s0 = (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) >>> 0;
      const s1 = (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)) >>> 0;
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, hh = h7;
    for (let t = 0; t < 64; t++) {
      const S1 = (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (hh + S1 + ch + K256[t] + w[t]) >>> 0;
      const S0 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + hh) >>> 0;
  }
  const hex = (n) => n.toString(16).padStart(8, '0');
  return { ok: true, hash: hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4) + hex(h5) + hex(h6) + hex(h7) };
}

export function canon(v) {
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return '"?"';
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// THE COMPANY — a modelled digital bank whose AI work runs on the laptops it already owns.
// Three departments, each fed by a public labelled dataset:
//   support   · Banking77 (PolyAI, CC BY 4.0) — a three-station line: route → intent → reply
//   security  · SMS Spam Collection (Almeida & Gómez Hidalgo, UCI, CC BY 4.0) — screen inbound texts
//   hr        · CLINC150 "work" domain + out-of-scope (Larson et al., CC BY 3.0) — the staff helpdesk
// The seven support teams and the reply article codes are this modelled company's own design.
// ══════════════════════════════════════════════════════════════════════════════════════════════════
export const JOBS = ['support', 'security', 'hr'];
export const ARMS = ['chain', 'pool', 'baseline'];
export const STATIONS = { support: ['route', 'intent', 'reply'], security: ['screen'], hr: ['helpdesk'] };
export const NONE = 'not_my_team';
export const NOT_HR = 'not_hr';
export const SECURITY_LABELS = ['legit', 'spam'];

export const TEAMS = {
  cards_delivery: { label: 'Card orders & delivery', about: 'ordering, activating, delivering or choosing cards',
    intents: ['card_arrival', 'card_delivery_estimate', 'get_physical_card', 'order_physical_card', 'getting_virtual_card', 'get_disposable_virtual_card', 'getting_spare_card', 'card_about_to_expire', 'activate_my_card', 'card_linking', 'visa_or_mastercard', 'disposable_card_limits', 'supported_cards_and_currencies', 'apple_pay_or_google_pay'] },
  cards_problems: { label: 'Card problems & security', about: 'a card, PIN or passcode that is not working, lost, stolen, blocked or not accepted',
    intents: ['card_not_working', 'virtual_card_not_working', 'contactless_not_working', 'card_swallowed', 'lost_or_stolen_card', 'compromised_card', 'pin_blocked', 'change_pin', 'passcode_forgotten', 'lost_or_stolen_phone', 'card_acceptance'] },
  card_payments: { label: 'Card payments', about: 'card payments, refunds, charges or direct debits on the statement',
    intents: ['card_payment_wrong_exchange_rate', 'card_payment_fee_charged', 'card_payment_not_recognised', 'declined_card_payment', 'pending_card_payment', 'reverted_card_payment?', 'transaction_charged_twice', 'extra_charge_on_statement', 'request_refund', 'Refund_not_showing_up', 'direct_debit_payment_not_recognised'] },
  cash_atm: { label: 'Cash & ATMs', about: 'cash withdrawals and ATMs',
    intents: ['pending_cash_withdrawal', 'wrong_amount_of_cash_received', 'declined_cash_withdrawal', 'cash_withdrawal_not_recognised', 'cash_withdrawal_charge', 'wrong_exchange_rate_for_cash_withdrawal', 'atm_support'] },
  top_ups: { label: 'Top-ups & deposits', about: 'topping up, adding money and deposits',
    intents: ['automatic_top_up', 'top_up_by_bank_transfer_charge', 'pending_top_up', 'top_up_limits', 'top_up_reverted', 'topping_up_by_card', 'verify_top_up', 'top_up_by_cash_or_cheque', 'top_up_failed', 'top_up_by_card_charge', 'balance_not_updated_after_cheque_or_cash_deposit', 'balance_not_updated_after_bank_transfer'] },
  transfers: { label: 'Transfers', about: 'sending or receiving transfers',
    intents: ['cancel_transfer', 'transfer_not_received_by_recipient', 'declined_transfer', 'pending_transfer', 'transfer_timing', 'beneficiary_not_allowed', 'transfer_fee_charged', 'receiving_money', 'failed_transfer', 'transfer_into_account'] },
  account_fx: { label: 'Account, identity & FX', about: 'identity checks, personal details, closing the account, currencies and exchange',
    intents: ['exchange_rate', 'fiat_currency_support', 'exchange_via_app', 'exchange_charge', 'age_limit', 'edit_personal_details', 'why_verify_identity', 'unable_to_verify_identity', 'verify_my_identity', 'verify_source_of_funds', 'terminate_account', 'country_support'] },
};
export const TEAM_IDS = Object.keys(TEAMS);
export const ALL_INTENTS = TEAM_IDS.flatMap((t) => TEAMS[t].intents);
export const HR_INTENTS = ['pto_request_status', 'next_holiday', 'insurance_change', 'insurance', 'meeting_schedule', 'payday', 'taxes', 'income', 'rollover_401k', 'pto_balance', 'pto_request', 'w2', 'schedule_meeting', 'direct_deposit', 'pto_used'];

/** teamOf(intent) — the one team an intent belongs to, or null. */
export function teamOf(intent) {
  if (!isStr(intent)) return null;
  for (const t of TEAM_IDS) if (TEAMS[t].intents.includes(intent)) return t;
  return null;
}

/** articleCode(intent) — the modelled help-centre article for a support intent: HC-101 … HC-177. */
export function articleCode(intent) {
  const i = ALL_INTENTS.indexOf(intent);
  return i < 0 ? null : 'HC-' + (101 + i);
}

/** humanize('card_not_working') → 'card not working' (display only). */
export const humanize = (s) => String(s).replace(/\?$/, '').replace(/_/g, ' ').toLowerCase();

// ── deterministic selection (seeded, re-runnable) ──────────────────────────────────────────────────
/** seededOrder(keys, seed) — the keys sorted by sha256(seed|key): a draw anyone can repeat. */
export function seededOrder(keys, seed) {
  if (!Array.isArray(keys) || !keys.every(isStr)) return { ok: false, why: 'seededOrder takes a list of strings' };
  if (!isStr(seed) || seed.length === 0) return { ok: false, why: 'seededOrder needs a seed' };
  const order = keys.map((k) => sha256(seed + '|' + k).hash + '|' + k).sort().map((x) => x.slice(65));
  return { ok: true, order };
}

// ── prompts: every station's instructions, built the same way on every node ─────────────────────────
const line = (text) => String(text).replace(/\s+/g, ' ').trim();
const schemaFor = (key, labels) => JSON.stringify({ type: 'object', properties: { [key]: { type: 'string', enum: labels } }, required: [key] });

const REPLY_RULE = (code) => 'begin the reply with "Thanks for getting in touch. Help article ' + code + ' covers this." then add one or two polite sentences. '
  + 'No other numbers, amounts, dates, times, phone numbers, emails or links. No promises of refunds or timescales.';

/** buildPrompt(job, station, ctx) → { ok, messages, labels, key, schema, maxTokens }.
 *  ctx: { text, examples, team?, intent? } — examples are [{ text, label }] from the dataset's training split. */
export function buildPrompt(job, station, ctx) {
  if (!isObj(ctx) || !isStr(ctx.text) || line(ctx.text).length === 0) return { ok: false, why: 'the message text is required' };
  const ex = Array.isArray(ctx.examples) ? ctx.examples.filter((e) => isObj(e) && isStr(e.text) && isStr(e.label)) : [];
  const msg = line(ctx.text);
  const shots = (list) => list.map((e) => '"' + line(e.text) + '" => ' + e.label).join('\n');
  if (job === 'support' && station === 'route') {
    const labels = TEAM_IDS;
    const sys = 'You route customer messages for a digital bank to exactly one team.\nTeams:\n'
      + labels.map((t) => '- ' + t + ': ' + TEAMS[t].about).join('\n')
      + (ex.length ? '\nExamples:\n' + shots(ex) : '') + '\nAnswer with JSON: {"team": "<team>"}';
    return { ok: true, messages: [{ role: 'system', content: sys }, { role: 'user', content: msg }], labels, key: 'team', schema: schemaFor('team', labels), maxTokens: 24 };
  }
  if (job === 'support' && station === 'intent') {
    if (!TEAM_IDS.includes(ctx.team)) return { ok: false, why: 'the intent station needs the routed team' };
    const own = TEAMS[ctx.team].intents, labels = [...own, NONE];
    const byIntent = new Map(ex.filter((e) => own.includes(e.label)).map((e) => [e.label, e.text]));
    const sys = 'You are the "' + TEAMS[ctx.team].label + '" team of a digital bank. Pick the exact topic of the customer message.\nTopics:\n'
      + own.map((i) => '- ' + i + (byIntent.has(i) ? ': e.g. "' + line(byIntent.get(i)) + '"' : '')).join('\n')
      + '\n- ' + NONE + ': the message belongs to a different team\nAnswer with JSON: {"intent": "<topic>"}';
    return { ok: true, messages: [{ role: 'system', content: sys }, { role: 'user', content: msg }], labels, key: 'intent', schema: schemaFor('intent', labels), maxTokens: 32 };
  }
  if (job === 'support' && station === 'reply') {
    const code = articleCode(ctx.intent), team = teamOf(ctx.intent);
    if (code === null) return { ok: false, why: 'the reply station needs a known intent' };
    // the reply opens with a fixed sentence naming the article (on the dev set the small model cited it 29 times in 30
    // this way, 19 in 30 when only told to "mention" it)
    const sys = 'You write short replies for the "' + TEAMS[team].label + '" team of a digital bank. The customer\'s topic is: ' + humanize(ctx.intent) + '. '
      + 'Our help article for it is ' + code + '.\nRules: ' + REPLY_RULE(code);
    return { ok: true, messages: [{ role: 'system', content: sys }, { role: 'user', content: 'Customer message: "' + msg + '"' }], labels: null, key: null, schema: null, maxTokens: 90 };
  }
  if (job === 'support' && station === 'baseline') {
    // the one-model alternative: everything the chain's stations see, in one prompt, answered in one call
    const byIntent = new Map(ex.filter((e) => ALL_INTENTS.includes(e.label)).map((e) => [e.label, e.text]));
    // every topic is listed with its help-article code, so the one model has what the chain's reply station is handed
    const sys = 'You handle customer messages for a digital bank. Pick the exact topic, then write the reply.\nTopics by team, each with its help article:\n'
      + TEAM_IDS.map((t) => t + ' (' + TEAMS[t].about + '):\n' + TEAMS[t].intents.map((i) => '- ' + i + ' [' + articleCode(i) + ']' + (byIntent.has(i) ? ': e.g. "' + line(byIntent.get(i)) + '"' : '')).join('\n')).join('\n')
      + '\nReply rules: ' + REPLY_RULE('<the topic\'s article>') + '\n'
      + 'Answer with JSON: {"intent": "<topic>", "reply": "<reply>"}';
    const schema = JSON.stringify({ type: 'object', properties: { intent: { type: 'string', enum: ALL_INTENTS }, reply: { type: 'string' } }, required: ['intent', 'reply'] });
    return { ok: true, messages: [{ role: 'system', content: sys }, { role: 'user', content: 'Customer message: "' + msg + '"' }], labels: ALL_INTENTS, key: 'intent', schema, maxTokens: 150 };
  }
  if (job === 'security' && station === 'screen') {
    // asked as a yes/no question, which the small model answers far better than "label it" (measured on the dev set)
    const labels = ['no', 'yes'];
    const sp = ex.filter((e) => e.label === 'spam'), lg = ex.filter((e) => e.label !== 'spam');
    const mixed = Array.from({ length: Math.max(sp.length, lg.length) }, (_, i) => [sp[i], lg[i]]).flat().filter(Boolean);
    const sys = 'You check SMS messages for spam. Spam means marketing or scams: it offers a prize, award, free gift, cash, ringtones, '
      + 'subscriptions or dating, and usually asks you to text or call a number, click a link or claim something. Anything else is legit: '
      + 'personal chat, plans, jokes, questions, even if short, rude, odd or in text-speak.'
      + (mixed.length ? '\nExamples (is it spam?):\n' + mixed.map((e) => 'SMS: "' + line(e.text) + '" -> ' + (e.label === 'spam' ? 'yes' : 'no')).join('\n') : '');
    const user = 'SMS: "' + msg + '"\nIs this SMS spam? Answer with JSON: {"spam": "yes"} or {"spam": "no"}';
    return { ok: true, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], labels, key: 'spam', schema: schemaFor('spam', labels), maxTokens: 12, answers: { no: 'legit', yes: 'spam' } };
  }
  if (job === 'hr' && station === 'helpdesk') {
    const labels = [...HR_INTENTS, NOT_HR];
    const byIntent = new Map(ex.filter((e) => HR_INTENTS.includes(e.label)).map((e) => [e.label, e.text]));
    const sys = 'You are the staff helpdesk (HR, pay and benefits). Pick the topic of the employee\'s request.\nTopics:\n'
      + HR_INTENTS.map((i) => '- ' + i + (byIntent.has(i) ? ': e.g. "' + line(byIntent.get(i)) + '"' : '')).join('\n')
      + '\n- ' + NOT_HR + ': not an HR, pay or benefits request\nAnswer with JSON: {"intent": "<topic>"}';
    return { ok: true, messages: [{ role: 'system', content: sys }, { role: 'user', content: msg }], labels, key: 'intent', schema: schemaFor('intent', labels), maxTokens: 32 };
  }
  return { ok: false, why: 'no such station: ' + String(job) + '/' + String(station) };
}

/** parseLabel(text, labels, key) — the model's answer, read strictly: JSON first, then an exact label mention. */
export function parseLabel(text, labels, key) {
  if (!isStr(text)) return { ok: false, why: 'no answer text' };
  if (!Array.isArray(labels) || labels.length === 0) return { ok: false, why: 'no label set' };
  const t = text.trim();
  let v = null;
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { const j = JSON.parse(m[0]); if (isStr(j[key])) v = j[key].trim(); } catch { v = null; } }
  if (v !== null && labels.includes(v)) return { ok: true, value: v, how: 'json' };
  const hits = labels.filter((l) => new RegExp('(^|[^a-z0-9_?])' + l.replace(/[?]/g, '\\?') + '($|[^a-z0-9_])', 'i').test(t));
  if (hits.length === 1) return { ok: true, value: hits[0], how: 'mention' };
  return { ok: true, value: null, how: hits.length === 0 ? 'unreadable' : 'ambiguous' };
}

/** readStation(prompt, text) — a classification station's answer: read strictly (parseLabel), then mapped to the job's
 *  label when the station asks its question another way (security asks "is it spam? yes/no"). */
export function readStation(pr, text) {
  if (!isObj(pr) || !Array.isArray(pr.labels)) return { ok: false, why: 'readStation(prompt, text)' };
  const p = parseLabel(text, pr.labels, pr.key);
  if (!p.ok) return p;
  if (isObj(pr.answers) && p.how !== 'json') return { ok: true, value: null, how: 'unreadable' };   // "no idea" is not a "no"
  const value = p.value !== null && isObj(pr.answers) ? (isStr(pr.answers[p.value]) ? pr.answers[p.value] : null) : p.value;
  return { ok: true, value, how: p.how };
}

/** parseBaseline(text) — the one-model answer: { intent, reply } from its JSON. */
export function parseBaseline(text) {
  if (!isStr(text)) return { ok: false, why: 'no answer text' };
  const m = text.match(/\{[\s\S]*\}/);
  let j = null;
  if (m) { try { j = JSON.parse(m[0]); } catch { j = null; } }
  const intent = isObj(j) && isStr(j.intent) && ALL_INTENTS.includes(j.intent.trim()) ? j.intent.trim() : null;
  const reply = isObj(j) && isStr(j.reply) ? j.reply.trim() : '';
  return { ok: true, intent, reply };
}

/** checkReply(draft, intent) — the deterministic gate before a reply leaves the building. It must cite the
 *  right article and nothing else: no other codes, numbers, links or emails (a small model's favourite way to
 *  make something up). A draft that fails is caught and goes to a person. */
export function checkReply(draft, intent) {
  const code = articleCode(intent);
  if (code === null) return { ok: false, why: 'checkReply needs a known intent' };
  if (!isStr(draft)) return { ok: true, pass: false, reasons: ['no draft'] };
  const reasons = [];
  const words = draft.trim().split(/\s+/).filter(Boolean).length;
  if (words < 8) reasons.push('too short');
  if (words > 90) reasons.push('too long');
  if (!draft.includes(code)) reasons.push('does not cite ' + code);
  const codes = draft.match(/HC-\d+/g) || [];
  if (codes.some((c) => c !== code)) reasons.push('cites another article');
  if (/\d/.test(draft.split(code).join(''))) reasons.push('contains a number that is not the article');
  if (/https?:\/\/|www\.|@[a-z0-9-]+\./i.test(draft)) reasons.push('contains a link or email');
  return { ok: true, pass: reasons.length === 0, reasons };
}

// ── grading: against the dataset's own gold labels, never a model's opinion ────────────────────────
/** gradeSupport(gold, out) — gold: { intent }; out: { team, intent, reply, bounced }.
 *  caught = the line stopped itself (a station said "not my team", a consistency check failed, or the reply
 *  gate failed) and a person takes over. silent = a wrong answer that went out unchallenged. */
export function gradeSupport(gold, out) {
  if (!isObj(gold) || teamOf(gold.intent) === null) return { ok: false, why: 'gold needs a known intent' };
  if (!isObj(out)) return { ok: false, why: 'the answer is missing' };
  const goldTeam = teamOf(gold.intent);
  const teamOk = out.team === goldTeam;
  const intentOk = out.intent === gold.intent;
  const known = teamOf(out.intent) !== null;
  const consistent = known && (out.team === undefined || out.team === null || teamOf(out.intent) === out.team);
  const reply = known ? checkReply(out.reply, out.intent) : { pass: false };
  const caught = out.bounced === true || !consistent || reply.pass !== true;
  const e2e = !caught && intentOk;
  return { ok: true, teamOk, intentOk, replyPass: reply.pass === true, caught, silent: !caught && !intentOk, e2e };
}

export function gradeLabel(gold, value) {
  if (!isStr(gold)) return { ok: false, why: 'gold label missing' };
  return { ok: true, correct: value === gold };
}

/** outcomeFromHops(job, arm, hops) — the answer, read ONLY from the signed hop outputs. The desk records this, the
 *  verifier rebuilds it, the page re-checks it: one rule, so a result can never say more than its receipts. */
export function outcomeFromHops(job, arm, hops) {
  if (!JOBS.includes(job) || !Array.isArray(hops)) return { ok: false, why: 'outcomeFromHops(job, arm, hops)' };
  const outOf = (h) => (isObj(h) ? h.output : undefined);
  if (job !== 'support') { const o = outOf(hops[0]); return { ok: true, out: { label: isStr(o) ? o : null } }; }
  if (arm === 'baseline') {
    const o = isObj(outOf(hops[0])) ? outOf(hops[0]) : {};
    const intent = ALL_INTENTS.includes(o.intent) ? o.intent : null;
    return { ok: true, out: { team: intent ? teamOf(intent) : null, intent, reply: isStr(o.reply) ? o.reply : '', bounced: false } };
  }
  const team = TEAM_IDS.includes(outOf(hops[0])) ? outOf(hops[0]) : null;
  if (team === null) return { ok: true, out: { team: null, intent: null, reply: '', bounced: true } };
  const intent = TEAMS[team].intents.includes(outOf(hops[1])) ? outOf(hops[1]) : null;
  if (intent === null) return { ok: true, out: { team, intent: null, reply: '', bounced: true } };
  const reply = outOf(hops[2]);
  return { ok: true, out: { team, intent, reply: isStr(reply) ? reply : '', bounced: false } };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// RECEIPTS — every hop a node makes is a signed, hash-linked record. The next hop checks the chain before it
// works; the desk checks it again; anyone can re-check it later. The signature is added at the edge (Ed25519
// in the browser); the kernel owns the bytes it covers.
// ══════════════════════════════════════════════════════════════════════════════════════════════════
const HEX64 = /^[0-9a-f]{64}$/;
export const START = 'START';

/** hopReceipt(input) → { ok, receipt } — one station's work on one item, self-hashed and linked to the last hop. */
export function hopReceipt(input) {
  if (!isObj(input)) return { ok: false, why: 'hopReceipt takes an object' };
  const { run, arm, job, item, station, node, model, input: inHash, output, prev, promptTokens, completionTokens, ms, at } = input;
  if (!isStr(run) || run.length === 0) return { ok: false, why: 'run is required' };
  if (!ARMS.includes(arm) && arm !== 'company') return { ok: false, why: 'arm must be chain, pool, baseline or company' };
  if (!JOBS.includes(job)) return { ok: false, why: 'job must be one of ' + JOBS.join(', ') };
  if (!isStr(item) || item.length === 0) return { ok: false, why: 'item is required' };
  if (!(STATIONS[job].includes(station) || (job === 'support' && station === 'baseline'))) return { ok: false, why: 'station ' + String(station) + ' is not part of ' + job };
  if (!isStr(node) || !HEX64.test(node)) return { ok: false, why: 'node must be the 64-hex public key of the node that did the work' };
  if (!isStr(model) || model.length === 0) return { ok: false, why: 'model is required' };
  if (!isStr(inHash) || !HEX64.test(inHash)) return { ok: false, why: 'input must be the 64-hex hash of what the station was given' };
  if (!(output === null || isStr(output) || isObj(output))) return { ok: false, why: 'output must be a string, an object or null' };
  if (!(prev === START || (isStr(prev) && HEX64.test(prev)))) return { ok: false, why: 'prev must be START or the previous hop\'s hash' };
  for (const [k, v] of [['promptTokens', promptTokens], ['completionTokens', completionTokens], ['ms', ms]]) if (!isInt(v) || v < 0) return { ok: false, why: k + ' must be a whole number ≥ 0' };
  if (!isStr(at) || !Number.isFinite(Date.parse(at))) return { ok: false, why: 'at must be a timestamp' };
  const body = { v: 1, kind: 'fallfloor-hop', run, arm, job, item, station, node, model, input: inHash, output, prev, promptTokens, completionTokens, ms, at };
  return { ok: true, receipt: { ...body, hash: sha256(canon(body)).hash } };
}

/** hopSignable(r) — the exact bytes a node signs: the receipt without its signature. */
export function hopSignable(r) {
  if (!isObj(r) || r.kind !== 'fallfloor-hop' || !isStr(r.hash)) return { ok: false, why: 'not a fallfloor hop receipt' };
  const body = { ...r }; delete body.signature;
  return { ok: true, payload: canon(body) };
}

/** verifyHop(r) — the receipt matches its own fingerprint. */
export function verifyHop(r) {
  if (!isObj(r) || r.kind !== 'fallfloor-hop' || !isStr(r.hash)) return { ok: false, why: 'not a fallfloor hop receipt' };
  const body = { ...r }; delete body.hash; delete body.signature;
  const valid = sha256(canon(body)).hash === r.hash;
  return { ok: true, valid, why: valid ? 'hop intact' : 'the hop does not match its own fingerprint — it was changed after it was issued' };
}

/** verifyChain(hops, stations) — one item's hops: each intact, linked START → … in station order, all about the same
 *  run, arm, job and item. Signatures are checked at the edge; this checks everything else. */
export function verifyChain(hops, stations) {
  if (!Array.isArray(hops) || hops.length === 0) return { ok: false, why: 'a chain needs at least one hop' };
  if (!Array.isArray(stations) || stations.length !== hops.length) return { ok: true, valid: false, why: 'the chain has ' + hops.length + ' hops, the line has ' + (Array.isArray(stations) ? stations.length : 0) + ' stations' };
  for (let i = 0; i < hops.length; i++) {
    const h = hops[i], v = verifyHop(h);
    if (!v.ok || !v.valid) return { ok: true, valid: false, why: 'hop ' + (i + 1) + ': ' + (v.why || 'not a hop') };
    if (h.station !== stations[i]) return { ok: true, valid: false, why: 'hop ' + (i + 1) + ' is station ' + h.station + ', expected ' + stations[i] };
    if (h.prev !== (i === 0 ? START : hops[i - 1].hash)) return { ok: true, valid: false, why: 'hop ' + (i + 1) + ' does not link to the hop before it' };
    for (const k of ['run', 'arm', 'job', 'item']) if (h[k] !== hops[0][k]) return { ok: true, valid: false, why: 'hop ' + (i + 1) + ' is about a different ' + k };
  }
  return { ok: true, valid: true, why: 'chain intact' };
}

// ── mesh envelopes: what may travel between nodes ────────────────────────────────────────────────────
export const MSG_TYPES = ['hello', 'work', 'ack', 'result', 'ping'];
export const MAX_MSG_BYTES = 64000;
/** validEnvelope(m) — refuse anything that is not a well-formed floor message (a node never executes a surprise). */
export function validEnvelope(m) {
  if (!isObj(m)) return { ok: false, why: 'a message is an object' };
  if (!MSG_TYPES.includes(m.type)) return { ok: false, why: 'unknown message type' };
  if (!isStr(m.id) || m.id.length === 0 || m.id.length > 200) return { ok: false, why: 'a message needs an id' };
  if (!isStr(m.from) || m.from.length === 0 || m.from.length > 64) return { ok: false, why: 'a message needs a sender' };
  if (!isStr(m.to) || m.to.length === 0 || m.to.length > 64) return { ok: false, why: 'a message needs a recipient' };
  if (!isInt(m.ttl) || m.ttl < 0 || m.ttl > 4) return { ok: false, why: 'ttl must be 0–4' };
  if (canon(m).length > MAX_MSG_BYTES) return { ok: false, why: 'the message is too large' };
  if (m.type === 'work') {
    const w = m.work;
    if (!isObj(w) || !JOBS.includes(w.job) || !isStr(w.item) || !isStr(w.text)) return { ok: false, why: 'work needs job, item and text' };
    if (!Array.isArray(w.route) || w.route.length === 0 || !w.route.every(isStr)) return { ok: false, why: 'work needs a route' };
    if (!isInt(w.step) || w.step < 0 || w.step >= w.route.length) return { ok: false, why: 'work step is outside its route' };
    if (!Array.isArray(w.hops)) return { ok: false, why: 'work carries its hops so far' };
  }
  if (m.type === 'ack' && (!isStr(m.of) || m.of.length === 0)) return { ok: false, why: 'an ack names the message it acknowledges' };
  if (m.type === 'result' && (!isObj(m.result) || !isStr(m.result.item))) return { ok: false, why: 'a result names its item' };
  return { ok: true };
}

// ── dispatch: which node gets which item ────────────────────────────────────────────────────────────
/** routeFor(arm, job, nodes) — the stations an item visits, as node names, ending back at the desk.
 *  chain: each station on its own node; pool: every station on one node (chosen by the desk); baseline: one call. */
export function routeFor(arm, job, nodes, desk = 'desk') {
  if (!ARMS.includes(arm) && arm !== 'company') return { ok: false, why: 'unknown arm' };
  if (!JOBS.includes(job)) return { ok: false, why: 'unknown job' };
  if (!Array.isArray(nodes) || nodes.length === 0 || !nodes.every(isStr)) return { ok: false, why: 'nodes must be a list of names' };
  const stations = arm === 'baseline' ? ['baseline'] : STATIONS[job];
  if (arm === 'chain') {
    if (nodes.length < stations.length) return { ok: false, why: 'the chain needs one node per station (' + stations.length + ')' };
    return { ok: true, stations, route: [...stations.map((_, i) => nodes[i]), desk] };
  }
  return { ok: true, stations, route: [...stations.map(() => nodes[0]), desk] };
}

/** reassign(pending, live, now, timeoutMs) — pool only: work stuck on a node that is not live is handed to the
 *  least-loaded live node once it has waited past the timeout. Returns [{ item, from, to }]. The chain has no
 *  such move: each station exists on exactly one node. */
export function reassign(pending, live, now, timeoutMs) {
  if (!Array.isArray(pending) || !Array.isArray(live) || !isNum(now) || !isNum(timeoutMs) || timeoutMs < 0) return { ok: false, why: 'reassign(pending, live, now, timeoutMs)' };
  const load = new Map(live.map((n) => [n, 0]));
  for (const p of pending) if (isObj(p) && load.has(p.node)) load.set(p.node, load.get(p.node) + 1);
  const moves = [];
  if (load.size === 0) return { ok: true, moves };
  for (const p of pending) {
    if (!isObj(p) || !isStr(p.item) || !isNum(p.since) || load.has(p.node)) continue;
    if (now - p.since < timeoutMs) continue;
    const least = Math.min(...load.values());
    const best = [...load.keys()].filter((n) => load.get(n) === least).sort()[0];
    moves.push({ item: p.item, from: p.node, to: best });
    load.set(best, load.get(best) + 1);
  }
  return { ok: true, moves };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// SCORING — from the ledger, never from a node's say-so.
// ══════════════════════════════════════════════════════════════════════════════════════════════════
/** percentile(values, p) — nearest-rank; null for an empty list. */
export function percentile(values, p) {
  if (!Array.isArray(values) || !isNum(p) || p <= 0 || p > 100) return null;
  const xs = values.filter(isNum).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  return xs[Math.ceil((p / 100) * xs.length) - 1];
}

/** exactMcNemar(b, c) — two-sided exact p for paired right/wrong disagreements (b: A right & B wrong; c: A wrong & B right). */
export function exactMcNemar(b, c) {
  if (!isInt(b) || !isInt(c) || b < 0 || c < 0) return null;
  const n = b + c;
  if (n === 0) return 1;
  let tail = 0, coef = 1;                       // C(n, 0)
  for (let k = 0; k <= Math.min(b, c); k++) { tail += coef; coef = coef * (n - k) / (k + 1); }
  return Math.min(1, 2 * tail / Math.pow(2, n));
}

const r3 = (x) => Math.round(x * 1000) / 1000;
/** scoreRun(records, expected) — one arm (or one job) over its items.
 *  records: [{ item, gold, out, startMs, endMs, results, tokens: { prompt, completion }, gpuMs }]; expected: the item ids sent. */
export function scoreRun(records, expected, job = 'support') {
  if (!Array.isArray(records) || !Array.isArray(expected) || !expected.every(isStr)) return { ok: false, why: 'scoreRun(records, expectedItemIds)' };
  if (!JOBS.includes(job)) return { ok: false, why: 'unknown job' };
  const byItem = new Map();
  let duplicates = 0;
  for (const r of records) {
    if (!isObj(r) || !isStr(r.item)) continue;
    if (byItem.has(r.item)) { duplicates++; continue; }
    byItem.set(r.item, r);
  }
  const extra = [...byItem.keys()].filter((k) => !expected.includes(k)).length;
  const done = expected.filter((k) => byItem.has(k)).map((k) => byItem.get(k));
  const lost = expected.length - done.length;
  let e2e = 0, correct = 0, teamOk = 0, intentOk = 0, replyPass = 0, caught = 0, silent = 0;
  const lat = [], per = { prompt: 0, completion: 0, gpuMs: 0 };
  for (const r of done) {
    if (job === 'support') {
      const g = gradeSupport(r.gold, r.out);
      if (!g.ok) continue;
      e2e += g.e2e ? 1 : 0; teamOk += g.teamOk ? 1 : 0; intentOk += g.intentOk ? 1 : 0; replyPass += g.replyPass ? 1 : 0;
      caught += g.caught ? 1 : 0; silent += g.silent ? 1 : 0;
    } else {
      correct += isObj(r.gold) && isObj(r.out) && r.gold.label === r.out.label ? 1 : 0;
    }
    if (isNum(r.startMs) && isNum(r.endMs) && r.endMs >= r.startMs) lat.push(r.endMs - r.startMs);
    if (isObj(r.tokens)) { per.prompt += isNum(r.tokens.prompt) ? r.tokens.prompt : 0; per.completion += isNum(r.tokens.completion) ? r.tokens.completion : 0; }
    per.gpuMs += isNum(r.gpuMs) ? r.gpuMs : 0;
  }
  const n = expected.length, d = done.length || 1;
  const timed = done.filter((r) => isNum(r.startMs) && isNum(r.endMs));
  const spanMin = timed.length ? (Math.max(...timed.map((r) => r.endMs)) - Math.min(...timed.map((r) => r.startMs))) / 60000 : 0;
  const out = {
    ok: true, job, n, completed: done.length, lost, duplicates, extra,
    latencyMs: { p50: percentile(lat, 50), p95: percentile(lat, 95), max: lat.length ? Math.max(...lat) : null },
    throughputPerMin: spanMin > 0 ? r3(done.length / spanMin) : null,
    perItem: { promptTokens: r3(per.prompt / d), completionTokens: r3(per.completion / d), gpuSeconds: r3(per.gpuMs / d / 1000) },
  };
  if (job === 'support') Object.assign(out, { e2e: r3(e2e / n), teamAcc: r3(teamOk / n), intentAcc: r3(intentOk / n), replyPass: r3(replyPass / n), caught: r3(caught / n), silent: r3(silent / n) });
  else out.accuracy = r3(correct / n);
  return out;
}

/** labelBreakdown(records, positive) — a two-way job, taken apart: positives caught, positives missed, negatives
 *  wrongly flagged, and what answering the majority label every time would have scored — the bar a model must beat
 *  before its accuracy means anything. One record per item (the first); records without a gold label are skipped. */
export function labelBreakdown(records, positive) {
  if (!Array.isArray(records) || !isStr(positive)) return { ok: false, why: 'labelBreakdown(records, positiveLabel)' };
  let tp = 0, fp = 0, fn = 0, tn = 0;
  const seen = new Set();
  for (const r of records) {
    if (!isObj(r) || !isObj(r.gold) || !isStr(r.gold.label) || seen.has(r.item)) continue;
    seen.add(r.item);
    const g = r.gold.label === positive, p = isObj(r.out) && r.out.label === positive;
    if (g && p) tp++; else if (g) fn++; else if (p) fp++; else tn++;
  }
  const n = tp + fp + fn + tn, pos = tp + fn;
  return { ok: true, n, caught: tp, missed: fn, wronglyFlagged: fp, correctlyPassed: tn, majorityAccuracy: n ? r3(Math.max(pos, n - pos) / n) : null };
}

/** pairedCompare(recA, recB, expected) — the same items, two arms: how many A got right that B did not, and back. */
export function pairedCompare(recA, recB, expected) {
  if (!Array.isArray(recA) || !Array.isArray(recB) || !Array.isArray(expected)) return { ok: false, why: 'pairedCompare(recordsA, recordsB, expected)' };
  const right = (recs) => { const m = new Map(); for (const r of recs) if (isObj(r) && isStr(r.item) && !m.has(r.item)) { const g = gradeSupport(r.gold, r.out); m.set(r.item, g.ok && g.e2e); } return m; };
  const a = right(recA), b = right(recB);
  let onlyA = 0, onlyB = 0, both = 0, neither = 0;
  for (const k of expected) { const x = a.get(k) === true, y = b.get(k) === true; if (x && y) both++; else if (x) onlyA++; else if (y) onlyB++; else neither++; }
  return { ok: true, both, onlyA, onlyB, neither, diffPts: r3(100 * (onlyA - onlyB) / (expected.length || 1)), p: exactMcNemar(onlyA, onlyB) };
}

// ── pre-registration: the thresholds, fixed and hashed before the first run ─────────────────────────
/** evaluatePrereg(prereg, s) — s: { chain, pool, baseline, chainVsBaseline, chainVsPool, coldStartSec }.
 *  Every rule is reported PASS or FAIL with the number that decided it. */
export function evaluatePrereg(prereg, s) {
  if (!isObj(prereg) || !isObj(prereg.thresholds)) return { ok: false, why: 'prereg needs thresholds' };
  if (!isObj(s) || !isObj(s.chain) || !isObj(s.pool) || !isObj(s.baseline) || !isObj(s.chainVsBaseline) || !isObj(s.chainVsPool)) return { ok: false, why: 'the summary needs chain, pool, baseline and both comparisons' };
  const t = prereg.thresholds, rules = [];
  const add = (id, rule, value, pass) => rules.push({ id, rule, value, pass: pass === true });
  add('capability', 'chain end-to-end ≥ baseline − ' + t.capabilityMaxDropPts + ' points (same items)', s.chainVsBaseline.diffPts, s.chainVsBaseline.diffPts >= -t.capabilityMaxDropPts);
  add('no-loss', 'no item lost and no item accepted twice, in either kill test', { chainLost: s.chain.lost, poolLost: s.pool.lost, chainDup: s.chain.duplicates, poolDup: s.pool.duplicates },
    s.chain.lost <= t.lostMax && s.pool.lost <= t.lostMax && s.chain.duplicates <= t.duplicatesMax && s.pool.duplicates <= t.duplicatesMax);
  add('latency', 'chain p95 ≤ ' + t.chainP95MaxSec + ' s per item', s.chain.latencyMs.p95 === null ? null : r3(s.chain.latencyMs.p95 / 1000), s.chain.latencyMs.p95 !== null && s.chain.latencyMs.p95 <= t.chainP95MaxSec * 1000);
  const chainBetter = s.chainVsPool.diffPts >= t.chainVsPoolMinGainPts || (s.chain.lost < s.pool.lost) || (isNum(s.chainStallSec) && isNum(s.poolStallSec) && s.chainStallSec < s.poolStallSec);
  add('chain-shape', 'the chain beats the pool by ≥ ' + t.chainVsPoolMinGainPts + ' points, or loses less, or stalls less, when a node dies', { diffPts: s.chainVsPool.diffPts, chainStallSec: s.chainStallSec ?? null, poolStallSec: s.poolStallSec ?? null }, chainBetter);
  add('cold-start', 'every node gives its first answer within ' + t.coldStartMaxSec + ' s of starting, model download included', s.coldStartSec ?? null, isNum(s.coldStartSec) && s.coldStartSec <= t.coldStartMaxSec);
  return { ok: true, rules, passed: rules.filter((r) => r.pass).length, of: rules.length };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// COSTS — the same work, priced two ways. Cloud: tokens × public list price (each with its source and the date
// it was checked). Local: the laptops are already owned; what the work adds is electricity (GPU seconds measured,
// wattage an estimate from the chip's published power, the unit rate from the price cap). No figure is invented:
// every input carries where it came from, and the page lets you change the volumes.
// ══════════════════════════════════════════════════════════════════════════════════════════════════
/** costModel(input) → { ok, cloud: [{ id, usdPerMonth, gbpPerMonth }], local: { kwhLow, kwhHigh, gbpLow, gbpHigh, laptopHours }, savingsGbp } */
export function costModel(input) {
  if (!isObj(input)) return { ok: false, why: 'costModel takes an object' };
  const { jobs, prices, fx, power, electricity } = input;
  if (!Array.isArray(jobs) || jobs.length === 0) return { ok: false, why: 'jobs: the monthly volume and measured cost of each job' };
  for (const j of jobs) {
    if (!isObj(j) || !isStr(j.job)) return { ok: false, why: 'each job needs a name' };
    for (const k of ['volumePerMonth', 'promptTokensPerItem', 'completionTokensPerItem', 'gpuSecondsPerItem']) if (!isNum(j[k]) || j[k] < 0) return { ok: false, why: j.job + ': ' + k + ' must be a number ≥ 0' };
  }
  if (!Array.isArray(prices) || prices.length === 0) return { ok: false, why: 'prices: at least one public list price' };
  for (const p of prices) {
    if (!isObj(p) || !isStr(p.id) || !isNum(p.inPerM) || !isNum(p.outPerM) || p.inPerM < 0 || p.outPerM < 0) return { ok: false, why: 'each price needs id, inPerM and outPerM' };
    if (!isStr(p.source) || !/^https:\/\//.test(p.source) || !isStr(p.checked)) return { ok: false, why: p.id + ': a price needs its https source and the date it was checked' };
  }
  if (!isObj(fx) || !isNum(fx.gbpPerUsd) || fx.gbpPerUsd <= 0 || !isStr(fx.source)) return { ok: false, why: 'fx: GBP per USD, with its source' };
  if (!isObj(power) || !isNum(power.wattsLow) || !isNum(power.wattsHigh) || power.wattsLow < 0 || power.wattsHigh < power.wattsLow || !isStr(power.source)) return { ok: false, why: 'power: an estimated watt range, low ≤ high, with its source' };
  if (!isObj(electricity) || !isNum(electricity.pencePerKwh) || electricity.pencePerKwh < 0 || !isStr(electricity.source)) return { ok: false, why: 'electricity: pence per kWh, with its source' };
  let inTok = 0, outTok = 0, gpuSec = 0;
  for (const j of jobs) { inTok += j.volumePerMonth * j.promptTokensPerItem; outTok += j.volumePerMonth * j.completionTokensPerItem; gpuSec += j.volumePerMonth * j.gpuSecondsPerItem; }
  const cloud = prices.map((p) => { const usd = (inTok / 1e6) * p.inPerM + (outTok / 1e6) * p.outPerM; return { id: p.id, usdPerMonth: r3(usd), gbpPerMonth: r3(usd * fx.gbpPerUsd) }; });
  const hours = gpuSec / 3600;
  const kwhLow = hours * power.wattsLow / 1000, kwhHigh = hours * power.wattsHigh / 1000;
  const local = { kwhLow: r3(kwhLow), kwhHigh: r3(kwhHigh), gbpLow: r3(kwhLow * electricity.pencePerKwh / 100), gbpHigh: r3(kwhHigh * electricity.pencePerKwh / 100), laptopHours: r3(hours) };
  return { ok: true, tokensPerMonth: { prompt: inTok, completion: outTok }, cloud, local, savingsGbp: cloud.map((c) => ({ id: c.id, low: r3(c.gbpPerMonth - local.gbpHigh), high: r3(c.gbpPerMonth - local.gbpLow) })) };
}
