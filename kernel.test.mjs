import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sha256, canon, JOBS, ARMS, STATIONS, NONE, NOT_HR, SECURITY_LABELS, TEAMS, TEAM_IDS, ALL_INTENTS, HR_INTENTS,
  teamOf, articleCode, humanize, seededOrder, buildPrompt, parseLabel, parseBaseline, checkReply, gradeSupport, gradeLabel, outcomeFromHops, readStation, labelBreakdown,
  START, hopReceipt, hopSignable, verifyHop, verifyChain, MSG_TYPES, MAX_MSG_BYTES, validEnvelope, routeFor, reassign,
  percentile, exactMcNemar, scoreRun, pairedCompare, evaluatePrereg, costModel,
} from './kernel.mjs';

const H = (c) => c.repeat(64);

test('sha256 + canon: FIPS vectors, order-blind, type-distinct', () => {
  assert.equal(sha256('abc').hash, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256('').hash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256('a'.repeat(1000)).hash, '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  assert.equal(sha256(5).ok, false);
  assert.equal(canon({ b: 1, a: [2, 'x', null, true] }), '{"a":[2,"x",null,true],"b":1}');
  assert.notEqual(canon({ x: 1 }), canon({ x: '1' }));
  assert.equal(canon(undefined), '"?"');
});

test('the company: 77 support intents in 7 teams, each exactly once; articles HC-101…HC-177', () => {
  assert.equal(ALL_INTENTS.length, 77);
  assert.equal(new Set(ALL_INTENTS).size, 77);
  assert.equal(TEAM_IDS.length, 7);
  for (const t of TEAM_IDS) assert.ok(TEAMS[t].intents.length >= 7 && TEAMS[t].intents.length <= 14, t);
  assert.equal(teamOf('card_arrival'), 'cards_delivery');
  assert.equal(teamOf('country_support'), 'account_fx');
  assert.equal(teamOf('reverted_card_payment?'), 'card_payments');
  assert.equal(teamOf('nope'), null);
  assert.equal(teamOf(7), null);
  assert.equal(articleCode('card_arrival'), 'HC-101');
  assert.equal(articleCode('country_support'), 'HC-177');
  assert.equal(articleCode('nope'), null);
  assert.equal(humanize('reverted_card_payment?'), 'reverted card payment');
  assert.equal(humanize('Refund_not_showing_up'), 'refund not showing up');
  assert.deepEqual(JOBS, ['support', 'security', 'hr']);
  assert.deepEqual(ARMS, ['chain', 'pool', 'baseline']);
  assert.deepEqual(STATIONS.support, ['route', 'intent', 'reply']);
  assert.equal(HR_INTENTS.length, 15);
  assert.deepEqual(SECURITY_LABELS, ['legit', 'spam']);
  assert.equal(NONE, 'not_my_team'); assert.equal(NOT_HR, 'not_hr');
});

test('seededOrder: a repeatable draw; the seed changes it; bad input refused', () => {
  const keys = ['a', 'b', 'c', 'd', 'e', 'f'];
  const a = seededOrder(keys, 's1'), b = seededOrder(keys, 's1'), c = seededOrder(keys, 's2');
  assert.deepEqual(a.order, b.order);
  assert.notDeepEqual(a.order, c.order);
  assert.deepEqual([...a.order].sort(), keys);
  const expect = keys.map((k) => [k, sha256('s1|' + k).hash]).sort((x, y) => (x[1] < y[1] ? -1 : 1)).map((x) => x[0]);
  assert.deepEqual(a.order, expect);
  assert.deepEqual(seededOrder(['x', 'x'], 's').order, ['x', 'x']);
  assert.equal(seededOrder('ab', 's').ok, false);
  assert.equal(seededOrder([1], 's').ok, false);
  assert.equal(seededOrder(['a'], '').ok, false);
  assert.equal(seededOrder(['a'], 3).ok, false);
});

test('buildPrompt: route — every team, the examples, a schema that only allows a team', () => {
  const p = buildPrompt('support', 'route', { text: '  my card\n never came ', examples: [{ text: 'where is my card', label: 'cards_delivery' }, { bad: 1 }] });
  assert.equal(p.ok, true);
  assert.equal(p.messages[1].content, 'my card never came');
  for (const t of TEAM_IDS) assert.ok(p.messages[0].content.includes('- ' + t + ': ' + TEAMS[t].about));
  assert.ok(p.messages[0].content.includes('Examples:\n"where is my card" => cards_delivery'));
  assert.ok(p.messages[0].content.endsWith('Answer with JSON: {"team": "<team>"}'));
  assert.deepEqual(JSON.parse(p.schema), { type: 'object', properties: { team: { type: 'string', enum: TEAM_IDS } }, required: ['team'] });
  assert.deepEqual([p.key, p.maxTokens, p.labels], ['team', 24, TEAM_IDS]);
  assert.equal(buildPrompt('support', 'route', { text: 'x' }).messages[0].content.includes('Examples'), false);
  const half = buildPrompt('support', 'route', { text: 'x', examples: [{ text: 5, label: 'transfers' }, { text: 'lonely text', label: 5 }, 'x'] }).messages[0].content;
  assert.equal(half.includes('Examples'), false);
  assert.equal(buildPrompt('support', 'route', { text: '   ' }).ok, false);
  assert.equal(buildPrompt('support', 'route', null).ok, false);
  assert.equal(buildPrompt('support', 'route', { text: 5 }).ok, false);
});

test('buildPrompt: intent — only the routed team\'s topics, with examples, plus the escape', () => {
  const p = buildPrompt('support', 'intent', { text: 'x', team: 'cash_atm', examples: [{ text: 'atm ate it', label: 'atm_support' }, { text: 'other team', label: 'card_arrival' }] });
  assert.deepEqual(p.labels, [...TEAMS.cash_atm.intents, NONE]);
  assert.ok(p.messages[0].content.includes('- atm_support: e.g. "atm ate it"'));
  assert.ok(p.messages[0].content.includes('- pending_cash_withdrawal\n'));
  assert.equal(p.messages[0].content.includes('card_arrival'), false);
  assert.ok(p.messages[0].content.includes('- ' + NONE + ': the message belongs to a different team'));
  assert.ok(p.messages[0].content.startsWith('You are the "Cash & ATMs" team'));
  assert.deepEqual([p.key, p.maxTokens], ['intent', 32]);
  assert.match(buildPrompt('support', 'intent', { text: 'x', team: 'nope' }).why, /routed team/);
});

test('buildPrompt: reply — the article to cite, the rules, free text', () => {
  const p = buildPrompt('support', 'reply', { text: ' my  card ', intent: 'card_arrival' });
  assert.equal(p.messages[0].content, 'You write short replies for the "Card orders & delivery" team of a digital bank. The customer\'s topic is: card arrival. Our help article for it is HC-101.\n'
    + 'Rules: begin the reply with "Thanks for getting in touch. Help article HC-101 covers this." then add one or two polite sentences. No other numbers, amounts, dates, times, phone numbers, emails or links. No promises of refunds or timescales.');
  assert.equal(p.messages[1].content, 'Customer message: "my card"');
  assert.deepEqual([p.labels, p.key, p.schema, p.maxTokens], [null, null, null, 90]);
  assert.match(buildPrompt('support', 'reply', { text: 'x', intent: 'nope' }).why, /known intent/);
});

test('buildPrompt: baseline — every topic by team, the article rule, one JSON answer', () => {
  const p = buildPrompt('support', 'baseline', { text: 'x', examples: [{ text: 'hi atm', label: 'atm_support' }, { text: 'route ex', label: 'cash_atm' }] });
  for (const i of ALL_INTENTS) assert.ok(p.messages[0].content.includes('- ' + i + ' [' + articleCode(i) + ']'), i);
  assert.ok(p.messages[0].content.includes('- atm_support [HC-143]: e.g. "hi atm"'));
  assert.ok(p.messages[0].content.includes('cash_atm (cash withdrawals and ATMs):\n- pending_cash_withdrawal [HC-137]\n'));
  assert.equal(p.messages[0].content.includes('route ex'), false);
  assert.ok(p.messages[0].content.includes('Reply rules: begin the reply with "Thanks for getting in touch. Help article <the topic\'s article> covers this."'));
  assert.ok(p.messages[0].content.endsWith('Answer with JSON: {"intent": "<topic>", "reply": "<reply>"}'));
  assert.equal(p.messages[1].content, 'Customer message: "x"');
  assert.deepEqual(JSON.parse(p.schema), { type: 'object', properties: { intent: { type: 'string', enum: ALL_INTENTS }, reply: { type: 'string' } }, required: ['intent', 'reply'] });
  assert.deepEqual([p.key, p.maxTokens, p.labels], ['intent', 150, ALL_INTENTS]);
});

test('buildPrompt: security and HR; unknown stations refused', () => {
  const s = buildPrompt('security', 'screen', { text: ' WIN  a prize', examples: [{ text: 'hi mum', label: 'legit' }, { text: 'free money', label: 'spam' }, { text: 'call  me', label: 'legit' }, { text: 'txt WIN', label: 'spam' }, { text: 'k', label: 'legit' }] });
  assert.deepEqual([s.labels, s.key, s.maxTokens, s.answers], [['no', 'yes'], 'spam', 12, { no: 'legit', yes: 'spam' }]);
  assert.ok(s.messages[0].content.endsWith('\nExamples (is it spam?):\nSMS: "free money" -> yes\nSMS: "hi mum" -> no\nSMS: "txt WIN" -> yes\nSMS: "call me" -> no\nSMS: "k" -> no'));
  assert.ok(s.messages[0].content.startsWith('You check SMS messages for spam. Spam means marketing or scams'));
  assert.equal(s.messages[1].content, 'SMS: "WIN a prize"\nIs this SMS spam? Answer with JSON: {"spam": "yes"} or {"spam": "no"}');
  assert.deepEqual(JSON.parse(s.schema), { type: 'object', properties: { spam: { type: 'string', enum: ['no', 'yes'] } }, required: ['spam'] });
  assert.equal(buildPrompt('security', 'screen', { text: 'x', examples: [{ text: 'a', label: 'spam' }, { text: 'b', label: 'spam' }] }).messages[0].content.endsWith('SMS: "a" -> yes\nSMS: "b" -> yes'), true);
  assert.equal(buildPrompt('security', 'screen', { text: 'x' }).messages[0].content.includes('Examples'), false);
  assert.deepEqual(readStation(s, '{"spam": "yes"}'), { ok: true, value: 'spam', how: 'json' });
  assert.deepEqual(readStation(s, '{"spam": "no"}'), { ok: true, value: 'legit', how: 'json' });
  assert.deepEqual(readStation(s, 'no idea'), { ok: true, value: null, how: 'unreadable' });
  assert.deepEqual(readStation(s, 'yes'), { ok: true, value: null, how: 'unreadable' });
  assert.deepEqual(readStation({ ...s, answers: { no: 5 } }, '{"spam": "no"}').value, null);
  assert.equal(readStation(s, 5).ok, false);
  assert.equal(readStation(null, 'x').ok, false);
  assert.equal(readStation({ labels: 'x' }, 'x').ok, false);
  const r = buildPrompt('support', 'route', { text: 'x' });
  assert.deepEqual(readStation(r, '{"team": "transfers"}'), { ok: true, value: 'transfers', how: 'json' });
  const h = buildPrompt('hr', 'helpdesk', { text: 'x', examples: [{ text: 'when is payday', label: 'payday' }] });
  assert.deepEqual(h.labels, [...HR_INTENTS, NOT_HR]);
  assert.ok(h.messages[0].content.includes('- payday: e.g. "when is payday"'));
  assert.ok(h.messages[0].content.includes('- w2\n'));
  assert.equal(h.maxTokens, 32);
  assert.match(buildPrompt('hr', 'route', { text: 'x' }).why, /no such station: hr\/route/);
  assert.equal(buildPrompt('support', 'screen', { text: 'x' }).ok, false);
});

test('parseLabel: JSON first, then a single exact mention; ambiguous or unreadable is null', () => {
  const L = ['cards_delivery', 'transfers', 'reverted_card_payment?'];
  assert.deepEqual(parseLabel(' {"team": " transfers "} ', L, 'team'), { ok: true, value: 'transfers', how: 'json' });
  assert.deepEqual(parseLabel('I think transfers.', L, 'team'), { ok: true, value: 'transfers', how: 'mention' });
  assert.equal(parseLabel('reverted_card_payment?', L, 'team').value, 'reverted_card_payment?');
  assert.deepEqual(parseLabel('transfers or cards_delivery', L, 'team'), { ok: true, value: null, how: 'ambiguous' });
  assert.deepEqual(parseLabel('no idea', L, 'team'), { ok: true, value: null, how: 'unreadable' });
  assert.equal(parseLabel('{"team": "made_up"}', L, 'team').value, null);
  assert.deepEqual(parseLabel('{"team": 5}', L, 'team'), { ok: true, value: null, how: 'unreadable' });
  assert.deepEqual(parseLabel('["transfers"]', L, 'team'), { ok: true, value: 'transfers', how: 'mention' });
  assert.equal(parseLabel('{"other": "transfers"}', L, 'team').how, 'mention');
  assert.equal(parseLabel('{bad json transfers}', L, 'team').value, 'transfers');
  assert.equal(parseLabel('xtransfers', L, 'team').value, null);
  assert.equal(parseLabel('transfers2', L, 'team').value, null);
  assert.equal(parseLabel(3, L, 'team').ok, false);
  assert.equal(parseLabel('x', [], 'team').ok, false);
  assert.equal(parseLabel('x', 'transfers', 'team').ok, false);
});

test('parseBaseline: the one-model JSON answer, with an unknown topic read as null', () => {
  assert.deepEqual(parseBaseline('{"intent":"card_arrival","reply":" See HC-101. "}'), { ok: true, intent: 'card_arrival', reply: 'See HC-101.' });
  assert.deepEqual(parseBaseline('{"intent":"nope","reply":"x"}'), { ok: true, intent: null, reply: 'x' });
  assert.deepEqual(parseBaseline('not json'), { ok: true, intent: null, reply: '' });
  assert.deepEqual(parseBaseline('{"intent": 3, "reply": 4}'), { ok: true, intent: null, reply: '' });
  assert.deepEqual(parseBaseline('{broken'), { ok: true, intent: null, reply: '' });
  assert.equal(parseBaseline(null).ok, false);
});

test('checkReply: cite the right article; nothing invented; a sensible length', () => {
  const good = 'Thanks for reaching out. Please see article HC-101 for how card delivery works and what to do next.';
  assert.deepEqual(checkReply(good, 'card_arrival'), { ok: true, pass: true, reasons: [] });
  assert.deepEqual(checkReply('See HC-101.', 'card_arrival').reasons, ['too short']);
  assert.deepEqual(checkReply(good.replace('HC-101', 'HC-102'), 'card_arrival').reasons, ['does not cite HC-101', 'cites another article', 'contains a number that is not the article']);
  assert.deepEqual(checkReply(good + ' Also see HC-150.', 'card_arrival').reasons, ['cites another article', 'contains a number that is not the article']);
  assert.deepEqual(checkReply(good + ' It takes 3 days.', 'card_arrival').reasons, ['contains a number that is not the article']);
  assert.deepEqual(checkReply(good + ' Visit www.bank.example today.', 'card_arrival').reasons, ['contains a link or email']);
  assert.deepEqual(checkReply(good + ' Email help@bank.example now.', 'card_arrival').reasons, ['contains a link or email']);
  assert.deepEqual(checkReply(good + ' https://x.y', 'card_arrival').reasons, ['contains a link or email']);
  assert.deepEqual(checkReply(good + (' word').repeat(80), 'card_arrival').reasons, ['too long']);
  const eight = 'One two three four five six seven HC-101';
  assert.equal(checkReply(eight, 'card_arrival').pass, true);
  assert.deepEqual(checkReply('One two three four five six HC-101', 'card_arrival').reasons, ['too short']);
  assert.equal(checkReply((' w').repeat(89) + ' HC-101', 'card_arrival').pass, true);
  assert.deepEqual(checkReply((' w').repeat(90) + ' HC-101', 'card_arrival').reasons, ['too long']);
  assert.deepEqual(checkReply(null, 'card_arrival'), { ok: true, pass: false, reasons: ['no draft'] });
  assert.equal(checkReply(good, 'nope').ok, false);
});

test('gradeSupport: right, caught, or silently wrong — against the dataset label', () => {
  const good = 'Thanks for reaching out. Please see article HC-101 for how card delivery works and what to do next.';
  const gold = { intent: 'card_arrival' };
  assert.deepEqual(gradeSupport(gold, { team: 'cards_delivery', intent: 'card_arrival', reply: good }), { ok: true, teamOk: true, intentOk: true, replyPass: true, caught: false, silent: false, e2e: true });
  assert.deepEqual(gradeSupport(gold, { intent: 'card_arrival', reply: good }), { ok: true, teamOk: false, intentOk: true, replyPass: true, caught: false, silent: false, e2e: true });
  const wrong = gradeSupport(gold, { team: 'cards_delivery', intent: 'card_linking', reply: good.replace('HC-101', 'HC-110') });
  assert.deepEqual([wrong.intentOk, wrong.caught, wrong.silent, wrong.e2e, wrong.replyPass], [false, false, true, false, true]);
  const bounced = gradeSupport(gold, { team: 'transfers', intent: null, bounced: true });
  assert.deepEqual([bounced.caught, bounced.silent, bounced.e2e, bounced.teamOk], [true, false, false, false]);
  const badReply = gradeSupport(gold, { team: 'cards_delivery', intent: 'card_arrival', reply: 'It takes 3 days, HC-101, sorry about that friend.' });
  assert.deepEqual([badReply.caught, badReply.e2e, badReply.replyPass], [true, false, false]);
  const inconsistent = gradeSupport(gold, { team: 'transfers', intent: 'card_arrival', reply: good });
  assert.deepEqual([inconsistent.caught, inconsistent.e2e], [true, false]);
  assert.equal(gradeSupport(gold, { team: null, intent: 'card_arrival', reply: good }).e2e, true);
  assert.equal(gradeSupport(gold, { team: 'cards_delivery', intent: 'card_arrival', reply: good, bounced: 'yes' }).caught, false);
  assert.equal(gradeSupport({ intent: 'nope' }, {}).ok, false);
  assert.equal(gradeSupport(null, {}).ok, false);
  assert.equal(gradeSupport(gold, null).ok, false);
  assert.deepEqual(gradeLabel('spam', 'spam'), { ok: true, correct: true });
  assert.equal(gradeLabel('spam', 'legit').correct, false);
  assert.equal(gradeLabel(null, 'x').ok, false);
});

test('outcomeFromHops: the answer comes only from the signed outputs', () => {
  const h = (output) => ({ output });
  assert.deepEqual(outcomeFromHops('security', 'company', [h('spam')]), { ok: true, out: { label: 'spam' } });
  assert.deepEqual(outcomeFromHops('hr', 'company', [h(null)]).out, { label: null });
  assert.deepEqual(outcomeFromHops('hr', 'company', [h({ x: 1 })]).out, { label: null });
  assert.deepEqual(outcomeFromHops('hr', 'company', []).out, { label: null });
  assert.deepEqual(outcomeFromHops('support', 'chain', [h('cards_delivery'), h('card_arrival'), h('See HC-101.')]).out, { team: 'cards_delivery', intent: 'card_arrival', reply: 'See HC-101.', bounced: false });
  assert.deepEqual(outcomeFromHops('support', 'pool', [h('cards_delivery'), h('card_arrival')]).out, { team: 'cards_delivery', intent: 'card_arrival', reply: '', bounced: false });
  assert.deepEqual(outcomeFromHops('support', 'pool', [h('cards_delivery'), h('card_arrival'), h(5)]).out.reply, '');
  assert.deepEqual(outcomeFromHops('support', 'chain', [h(null)]).out, { team: null, intent: null, reply: '', bounced: true });
  assert.deepEqual(outcomeFromHops('support', 'chain', [h('nope')]).out.bounced, true);
  assert.deepEqual(outcomeFromHops('support', 'chain', []).out.bounced, true);
  assert.deepEqual(outcomeFromHops('support', 'chain', [h('cards_delivery'), h(NONE)]).out, { team: 'cards_delivery', intent: null, reply: '', bounced: true });
  assert.deepEqual(outcomeFromHops('support', 'chain', [h('cards_delivery'), h('atm_support'), h('x')]).out, { team: 'cards_delivery', intent: null, reply: '', bounced: true });
  assert.deepEqual(outcomeFromHops('support', 'chain', [null, h('card_arrival')]).out.bounced, true);
  assert.deepEqual(outcomeFromHops('support', 'baseline', [h({ intent: 'atm_support', reply: 'See HC-120.' })]).out, { team: 'cash_atm', intent: 'atm_support', reply: 'See HC-120.', bounced: false });
  assert.deepEqual(outcomeFromHops('support', 'baseline', [h({ intent: 'nope', reply: 5 })]).out, { team: null, intent: null, reply: '', bounced: false });
  assert.deepEqual(outcomeFromHops('support', 'baseline', [h('text')]).out, { team: null, intent: null, reply: '', bounced: false });
  assert.deepEqual(outcomeFromHops('support', 'baseline', []).out.intent, null);
  assert.equal(outcomeFromHops('x', 'chain', []).ok, false);
  assert.equal(outcomeFromHops('support', 'chain', 'x').ok, false);
});

const base = { run: 'r1', arm: 'chain', job: 'support', item: 'sup-1', station: 'route', node: H('a'), model: 'm', input: H('b'), output: 'cards_delivery', prev: START, promptTokens: 10, completionTokens: 2, ms: 300, at: '2026-09-29T10:00:00.000Z' };
test('hopReceipt: a self-hashed, linked record; every field checked', () => {
  const r = hopReceipt(base).receipt;
  assert.equal(r.kind, 'fallfloor-hop'); assert.equal(r.v, 1);
  const body = { ...r }; delete body.hash;
  assert.equal(r.hash, sha256(canon(body)).hash);
  assert.deepEqual(verifyHop(r), { ok: true, valid: true, why: 'hop intact' });
  assert.equal(verifyHop({ ...r, output: 'transfers' }).valid, false);
  assert.match(verifyHop({ ...r, ms: 1 }).why, /changed after it was issued/);
  assert.equal(verifyHop({ ...r, signature: { sig: 'x' } }).valid, true);
  assert.equal(verifyHop({ ...r, kind: 'x' }).ok, false);
  assert.equal(verifyHop(null).ok, false);
  assert.equal(hopReceipt({ ...base, arm: 'company', job: 'security', station: 'screen' }).ok, true);
  assert.equal(hopReceipt({ ...base, station: 'baseline', arm: 'baseline' }).ok, true);
  assert.equal(hopReceipt({ ...base, output: null }).ok, true);
  assert.equal(hopReceipt({ ...base, output: { intent: 'x' } }).ok, true);
  assert.equal(hopReceipt({ ...base, prev: H('c') }).ok, true);
  assert.equal(hopReceipt({ ...base, promptTokens: 0, completionTokens: 0, ms: 0 }).ok, true);
  for (const [k, v, re] of [['run', '', /run/], ['arm', 'x', /arm/], ['job', 'x', /job/], ['item', '', /item/], ['station', 'screen', /not part of support/], ['node', 'abc', /public key/], ['model', '', /model/], ['input', 'x', /input/], ['output', 5, /output/], ['prev', 'x', /prev/], ['promptTokens', -1, /promptTokens/], ['completionTokens', 1.5, /completionTokens/], ['ms', 'x', /ms/], ['at', 'soon', /timestamp/]])
    assert.match(hopReceipt({ ...base, [k]: v }).why, re, k);
  assert.equal(hopReceipt({ ...base, station: 'baseline', job: 'hr', arm: 'baseline' }).ok, false);
  assert.equal(hopReceipt('x').ok, false);
  assert.equal(hopReceipt({ ...base, run: 5 }).ok, false);
  assert.equal(hopReceipt({ ...base, item: 5 }).ok, false);
  assert.equal(hopReceipt({ ...base, model: 5 }).ok, false);
  assert.equal(hopReceipt({ ...base, at: 5 }).ok, false);
  const s = hopSignable({ ...r, signature: { sig: 'x' } });
  assert.equal(s.payload, canon(r));
  assert.equal(hopSignable({ kind: 'x' }).ok, false);
  assert.equal(hopSignable(null).ok, false);
  assert.equal(hopSignable({ kind: 'fallfloor-hop' }).ok, false);
});

test('verifyChain: in order, linked, about one item — and it names the break', () => {
  const h1 = hopReceipt(base).receipt;
  const h2 = hopReceipt({ ...base, station: 'intent', prev: h1.hash, output: 'card_arrival' }).receipt;
  const h3 = hopReceipt({ ...base, station: 'reply', prev: h2.hash, output: 'text' }).receipt;
  assert.deepEqual(verifyChain([h1, h2, h3], ['route', 'intent', 'reply']), { ok: true, valid: true, why: 'chain intact' });
  assert.equal(verifyChain([h1, h2], ['route', 'intent']).valid, true);
  assert.match(verifyChain([h1, h3], ['route', 'intent']).why, /hop 2 is station reply/);
  assert.match(verifyChain([h1, { ...h2, prev: H('d') }], ['route', 'intent']).why, /hop 2: the hop does not match/);
  const relinked = hopReceipt({ ...base, station: 'intent', prev: H('d') }).receipt;
  assert.match(verifyChain([h1, relinked], ['route', 'intent']).why, /hop 2 does not link/);
  const first = hopReceipt({ ...base, prev: H('e') }).receipt;
  assert.match(verifyChain([first], ['route']).why, /hop 1 does not link/);
  for (const k of ['run', 'arm', 'job', 'item']) {
    const v = k === 'arm' ? 'pool' : k === 'job' ? 'support' : 'other';
    const other = hopReceipt({ ...base, station: 'intent', prev: h1.hash, [k]: v }).receipt;
    if (k === 'job') continue;
    assert.equal(verifyChain([h1, other], ['route', 'intent']).why, 'hop 2 is about a different ' + k, k);
  }
  assert.match(verifyChain([h1, h2], ['route']).why, /2 hops, the line has 1/);
  assert.match(verifyChain([h1], 'route').why, /the line has 0/);
  assert.match(verifyChain([{ kind: 'x' }], ['route']).why, /hop 1: not a fallfloor hop/);
  assert.equal(verifyChain([], ['route']).ok, false);
  assert.equal(verifyChain('x', ['route']).ok, false);
});

const env = (o) => ({ type: 'ping', id: 'm1', from: 'n1', to: 'n2', ttl: 3, ...o });
test('validEnvelope: only well-formed floor messages travel', () => {
  assert.deepEqual(validEnvelope(env()), { ok: true });
  assert.deepEqual(MSG_TYPES, ['hello', 'work', 'ack', 'result', 'ping']);
  for (const [o, re] of [[{ type: 'x' }, /unknown message type/], [{ id: '' }, /id/], [{ id: 'x'.repeat(201) }, /id/], [{ from: '' }, /sender/], [{ from: 'x'.repeat(65) }, /sender/], [{ to: '' }, /recipient/], [{ to: 'x'.repeat(65) }, /recipient/], [{ ttl: 5 }, /ttl/], [{ ttl: -1 }, /ttl/], [{ ttl: 1.5 }, /ttl/]])
    assert.match(validEnvelope(env(o)).why, re, JSON.stringify(o).slice(0, 40));
  assert.equal(validEnvelope(env({ id: 'x'.repeat(200), from: 'x'.repeat(64), to: 'x'.repeat(64), ttl: 4 })).ok, true);
  assert.equal(validEnvelope(env({ ttl: 0 })).ok, true);
  assert.equal(validEnvelope(null).ok, false);
  assert.equal(validEnvelope(env({ id: 5 })).ok, false);
  assert.match(validEnvelope(env({ pad: 'x'.repeat(MAX_MSG_BYTES) })).why, /too large/);
  const size = (o) => canon(o).length, fill = MAX_MSG_BYTES - size(env({ pad: '' }));
  assert.equal(size(env({ pad: 'x'.repeat(fill) })), MAX_MSG_BYTES);
  assert.equal(validEnvelope(env({ pad: 'x'.repeat(fill) })).ok, true);
  assert.equal(validEnvelope(env({ pad: 'x'.repeat(fill + 1) })).ok, false);
  const work = { job: 'support', item: 'i', text: 't', route: ['n1', 'desk'], step: 0, hops: [] };
  assert.equal(validEnvelope(env({ type: 'work', work })).ok, true);
  for (const [w, re] of [[{ ...work, job: 'x' }, /job, item and text/], [{ ...work, item: 5 }, /job, item/], [{ ...work, text: null }, /text/], [{ ...work, route: [] }, /route/], [{ ...work, route: [5] }, /route/], [{ ...work, route: 'n1' }, /route/], [{ ...work, step: 2 }, /outside its route/], [{ ...work, step: -1 }, /outside/], [{ ...work, step: 'x' }, /outside/], [{ ...work, hops: 'x' }, /hops/]])
    assert.match(validEnvelope(env({ type: 'work', work: w })).why, re);
  assert.equal(validEnvelope(env({ type: 'work', work: { ...work, step: 1 } })).ok, true);
  assert.match(validEnvelope(env({ type: 'work', work: null })).why, /job, item/);
  assert.match(validEnvelope(env({ type: 'ack' })).why, /ack names/);
  assert.match(validEnvelope(env({ type: 'ack', of: '' })).why, /ack names/);
  assert.equal(validEnvelope(env({ type: 'ack', of: 'm0' })).ok, true);
  assert.match(validEnvelope(env({ type: 'result' })).why, /result names its item/);
  assert.match(validEnvelope(env({ type: 'result', result: { item: 5 } })).why, /result names/);
  assert.equal(validEnvelope(env({ type: 'result', result: { item: 'i' } })).ok, true);
  assert.equal(validEnvelope(env({ type: 'hello' })).ok, true);
});

test('routeFor: the chain spreads the stations, the pool and baseline keep them on one node', () => {
  assert.deepEqual(routeFor('chain', 'support', ['n1', 'n2', 'n3']), { ok: true, stations: ['route', 'intent', 'reply'], route: ['n1', 'n2', 'n3', 'desk'] });
  assert.deepEqual(routeFor('pool', 'support', ['n2']), { ok: true, stations: ['route', 'intent', 'reply'], route: ['n2', 'n2', 'n2', 'desk'] });
  assert.deepEqual(routeFor('baseline', 'support', ['n4'], 'hq'), { ok: true, stations: ['baseline'], route: ['n4', 'hq'] });
  assert.deepEqual(routeFor('company', 'security', ['n1']).route, ['n1', 'desk']);
  assert.match(routeFor('chain', 'support', ['n1', 'n2']).why, /one node per station \(3\)/);
  assert.equal(routeFor('chain', 'hr', ['n1']).ok, true);
  assert.equal(routeFor('x', 'support', ['n1']).ok, false);
  assert.equal(routeFor('pool', 'x', ['n1']).ok, false);
  assert.equal(routeFor('pool', 'support', []).ok, false);
  assert.equal(routeFor('pool', 'support', [1]).ok, false);
  assert.equal(routeFor('pool', 'support', 'n1').ok, false);
});

test('reassign: stuck work moves to the least-loaded live node, only after the timeout', () => {
  const pending = [{ item: 'a', node: 'n2', since: 0 }, { item: 'b', node: 'n2', since: 0 }, { item: 'c', node: 'n1', since: 0 }, { item: 'd', node: 'n2', since: 9000 }];
  const r = reassign(pending, ['n1', 'n3'], 10000, 5000);
  assert.deepEqual(r.moves, [{ item: 'a', from: 'n2', to: 'n3' }, { item: 'b', from: 'n2', to: 'n1' }]);
  assert.deepEqual(reassign(pending, ['n1', 'n3'], 4999, 5000).moves, []);
  assert.deepEqual(reassign([{ item: 'a', node: 'n2', since: 0 }], ['n1'], 5000, 5000).moves, [{ item: 'a', from: 'n2', to: 'n1' }]);
  assert.deepEqual(reassign(pending, [], 10000, 5000).moves, []);
  assert.deepEqual(reassign(pending, ['n1', 'n2', 'n3'], 10000, 5000).moves, []);
  assert.deepEqual(reassign([null, { item: 5, node: 'x', since: 0 }, { item: 'z', node: 'x' }], ['n1'], 10000, 1).moves, []);
  assert.deepEqual(reassign([{ item: 'a', node: 'x', since: 0 }, { item: 'b', node: 'x', since: 0 }], ['n2', 'n1'], 10, 1).moves, [{ item: 'a', from: 'x', to: 'n1' }, { item: 'b', from: 'x', to: 'n2' }]);
  assert.equal(reassign('x', [], 0, 0).ok, false);
  assert.equal(reassign([], 'x', 0, 0).ok, false);
  assert.equal(reassign([], [], 'x', 0).ok, false);
  assert.equal(reassign([], [], 0, -1).ok, false);
  assert.deepEqual(reassign([{ item: 'a', node: 'x', since: 5 }], ['n1'], 5, 0).moves, [{ item: 'a', from: 'x', to: 'n1' }]);
  assert.deepEqual(reassign([{ item: 'a', node: 'x', since: 0 }], ['n1', 'n2'], 10, 1).moves, [{ item: 'a', from: 'x', to: 'n1' }]);
  assert.deepEqual(reassign([{ item: 'a', node: 'x', since: 0 }, { item: 'b', node: 'n1', since: 0 }], ['n1', 'n2'], 10, 1).moves, [{ item: 'a', from: 'x', to: 'n2' }]);
  assert.equal(reassign([], [], 0, 'x').ok, false);
});

test('percentile + exactMcNemar: exact numbers', () => {
  const xs = [5, 1, 4, 2, 3, 6, 7, 8, 9, 10];
  assert.equal(percentile(xs, 50), 5);
  assert.equal(percentile(xs, 95), 10);
  assert.equal(percentile(xs, 90), 9);
  assert.equal(percentile(xs, 100), 10);
  assert.equal(percentile([7], 1), 7);
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([1, 'x', null, 2], 50), 1);
  assert.equal(percentile([NaN, 3, Infinity, 1], 50), 1);
  assert.equal(percentile(xs, 0), null);
  assert.equal(percentile(xs, 101), null);
  assert.equal(percentile('x', 50), null);
  assert.equal(percentile(xs, 'x'), null);
  assert.equal(exactMcNemar(0, 0), 1);
  assert.equal(exactMcNemar(10, 3), 0.09228515625);
  assert.equal(exactMcNemar(3, 10), 0.09228515625);
  assert.equal(exactMcNemar(5, 5), 1);
  assert.equal(exactMcNemar(6, 0), 0.03125);
  assert.equal(exactMcNemar(1, 0), 1);
  assert.equal(exactMcNemar(-1, 2), null);
  assert.equal(exactMcNemar(1.5, 2), null);
  assert.equal(exactMcNemar(1, 'x'), null);
});

const REPLY = (i) => 'Thanks for reaching out. Please see article ' + articleCode(i) + ' for what to do next with this today.';
const rec = (item, intent, out, t0 = 0, t1 = 1000) => ({ item, gold: { intent }, out, startMs: t0, endMs: t1, tokens: { prompt: 100, completion: 20 }, gpuMs: 2000 });
test('scoreRun: accuracy, caught vs silent, lost, duplicates, latency and throughput', () => {
  const records = [
    rec('a', 'card_arrival', { team: 'cards_delivery', intent: 'card_arrival', reply: REPLY('card_arrival') }, 0, 1000),
    rec('b', 'card_arrival', { team: 'cards_delivery', intent: 'card_linking', reply: REPLY('card_linking') }, 0, 3000),
    rec('c', 'atm_support', { team: 'transfers', intent: null, bounced: true }, 1000, 2000),
    rec('a', 'card_arrival', { team: 'cards_delivery', intent: 'card_linking', reply: '' }, 0, 9000),
    rec('x', 'card_arrival', { intent: 'card_arrival', reply: REPLY('card_arrival') }, 0, 500),
    null, { item: 5 },
  ];
  const s = scoreRun(records, ['a', 'b', 'c', 'd']);
  assert.deepEqual([s.n, s.completed, s.lost, s.duplicates, s.extra], [4, 3, 1, 1, 1]);
  assert.deepEqual([s.e2e, s.teamAcc, s.intentAcc, s.replyPass, s.caught, s.silent], [0.25, 0.5, 0.25, 0.5, 0.25, 0.25]);
  assert.deepEqual(s.latencyMs, { p50: 1000, p95: 3000, max: 3000 });
  assert.equal(s.throughputPerMin, 60);
  assert.deepEqual(s.perItem, { promptTokens: 100, completionTokens: 20, gpuSeconds: 2 });
  const sec = scoreRun([{ item: 'p', gold: { label: 'spam' }, out: { label: 'spam' }, startMs: 0, endMs: 60000 }, { item: 'q', gold: { label: 'legit' }, out: { label: 'spam' } }, { item: 'r', gold: { label: 'legit' }, out: { label: 'legit' } }, { item: 's', gold: { label: 'legit' }, out: null }], ['p', 'q', 'r', 's'], 'security');
  assert.deepEqual([sec.accuracy, sec.completed, sec.throughputPerMin], [0.5, 4, 4]);
  assert.deepEqual(scoreRun([rec('a', 'card_arrival', {}, 7, 7)], ['a']).latencyMs, { p50: 0, p95: 0, max: 0 });
  assert.equal(scoreRun([rec('a', 'card_arrival', {}, 0, 30000), { ...rec('b', 'card_arrival', {}), startMs: 5, endMs: 'x' }, { ...rec('c', 'card_arrival', {}), startMs: 'x', endMs: 90000 }], ['a', 'b', 'c']).throughputPerMin, 6);
  assert.equal(sec.e2e, undefined);
  const empty = scoreRun([], ['a']);
  assert.deepEqual([empty.lost, empty.e2e, empty.latencyMs.p50, empty.throughputPerMin], [1, 0, null, null]);
  assert.deepEqual(scoreRun([rec('a', 'card_arrival', {}, 5, 4)], ['a']).latencyMs.p50, null);
  assert.deepEqual(scoreRun([{ item: 'a', gold: { intent: 'card_arrival' }, out: {}, tokens: { prompt: 'x' } }], ['a']).perItem, { promptTokens: 0, completionTokens: 0, gpuSeconds: 0 });
  assert.equal(scoreRun([{ item: 'a', gold: { intent: 'nope' }, out: {} }], ['a']).e2e, 0);
  assert.equal(scoreRun('x', []).ok, false);
  assert.equal(scoreRun([], [5]).ok, false);
  assert.equal(scoreRun([], 'a').ok, false);
  assert.equal(scoreRun([], [], 'x').ok, false);
});

test('labelBreakdown: caught, missed, wrongly flagged — and the majority-label bar', () => {
  const r = (item, g, o) => ({ item, gold: { label: g }, out: o === undefined ? null : { label: o } });
  const recs = [r('a', 'spam', 'spam'), r('b', 'spam', 'legit'), r('c', 'legit', 'spam'), r('d', 'legit', 'legit'), r('e', 'legit', 'legit'), r('f', 'legit'), r('a', 'spam', 'legit'), { item: 'g', gold: {} }, null, { item: 'h', gold: { label: 'spam' }, out: 'spam' }];
  assert.deepEqual(labelBreakdown(recs, 'spam'), { ok: true, n: 7, caught: 1, missed: 2, wronglyFlagged: 1, correctlyPassed: 3, majorityAccuracy: 0.571 });
  assert.deepEqual(labelBreakdown([r('a', 'spam', 'spam'), r('b', 'spam', 'spam'), r('c', 'legit', 'spam')], 'spam').majorityAccuracy, 0.667);
  assert.deepEqual(labelBreakdown([], 'spam'), { ok: true, n: 0, caught: 0, missed: 0, wronglyFlagged: 0, correctlyPassed: 0, majorityAccuracy: null });
  assert.equal(labelBreakdown('x', 'spam').ok, false);
  assert.equal(labelBreakdown([], 5).ok, false);
});

test('pairedCompare: the same items, both arms, with the exact test', () => {
  const ok = (id) => rec(id, 'card_arrival', { team: 'cards_delivery', intent: 'card_arrival', reply: REPLY('card_arrival') });
  const bad = (id) => rec(id, 'card_arrival', { team: 'cards_delivery', intent: 'card_linking', reply: REPLY('card_linking') });
  const A = [ok('a'), ok('b'), ok('c'), bad('d'), ok('e'), ok('a')], B = [ok('a'), bad('b'), bad('c'), ok('d')];
  const p = pairedCompare(A, B, ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual([p.both, p.onlyA, p.onlyB, p.neither, p.diffPts], [1, 3, 1, 0, 40]);
  assert.equal(p.p, exactMcNemar(3, 1));
  assert.equal(pairedCompare([bad('a')], [ok('a')], ['a']).diffPts, -100);
  assert.equal(pairedCompare([null, { item: 5 }], [], ['a']).neither, 1);
  assert.equal(pairedCompare([], [], []).diffPts, 0);
  assert.equal(pairedCompare('x', [], []).ok, false);
  assert.equal(pairedCompare([], 'x', []).ok, false);
  assert.equal(pairedCompare([], [], 'x').ok, false);
});

const PRE = { thresholds: { capabilityMaxDropPts: 5, lostMax: 0, duplicatesMax: 0, chainP95MaxSec: 60, chainVsPoolMinGainPts: 5, coldStartMaxSec: 600 } };
const arm = (o) => ({ lost: 0, duplicates: 0, latencyMs: { p95: 30000 }, ...o });
const S0 = { chain: arm(), pool: arm(), baseline: arm(), chainVsBaseline: { diffPts: -5 }, chainVsPool: { diffPts: 5 }, coldStartSec: 600 };
test('evaluatePrereg: each rule at its exact boundary, and the number that decided it', () => {
  const e = evaluatePrereg(PRE, S0);
  assert.deepEqual(e.rules.map((r) => [r.id, r.pass]), [['capability', true], ['no-loss', true], ['latency', true], ['chain-shape', true], ['cold-start', true]]);
  assert.deepEqual([e.passed, e.of], [5, 5]);
  assert.equal(e.rules[2].value, 30);
  const f = (o) => Object.fromEntries(evaluatePrereg(PRE, { ...S0, ...o }).rules.map((r) => [r.id, r.pass]));
  assert.equal(f({ chainVsBaseline: { diffPts: -5.001 } }).capability, false);
  assert.equal(f({ chain: arm({ lost: 1 }) })['no-loss'], false);
  assert.equal(f({ pool: arm({ lost: 1 }) })['no-loss'], false);
  assert.equal(f({ chain: arm({ duplicates: 1 }) })['no-loss'], false);
  assert.equal(f({ pool: arm({ duplicates: 1 }) })['no-loss'], false);
  assert.equal(f({ chain: arm({ latencyMs: { p95: 60000 } }) }).latency, true);
  assert.equal(f({ chain: arm({ latencyMs: { p95: 60001 } }) }).latency, false);
  assert.equal(f({ chain: arm({ latencyMs: { p95: null } }) }).latency, false);
  assert.equal(evaluatePrereg(PRE, { ...S0, chain: arm({ latencyMs: { p95: null } }) }).rules[2].value, null);
  assert.equal(f({ chainVsPool: { diffPts: 4.999 } })['chain-shape'], false);
  assert.equal(f({ chainVsPool: { diffPts: 0 }, pool: arm({ lost: 2 }), chain: arm({ lost: 1 }) })['chain-shape'], true);
  assert.equal(f({ chainVsPool: { diffPts: 0 }, chainStallSec: 10, poolStallSec: 20 })['chain-shape'], true);
  assert.equal(f({ chainVsPool: { diffPts: 0 }, chainStallSec: 20, poolStallSec: 20 })['chain-shape'], false);
  assert.equal(f({ chainVsPool: { diffPts: 0 }, chainStallSec: 10 })['chain-shape'], false);
  assert.equal(f({ coldStartSec: 601 })['cold-start'], false);
  assert.equal(f({ coldStartSec: undefined })['cold-start'], false);
  assert.deepEqual(evaluatePrereg(PRE, { ...S0, chainVsPool: { diffPts: 0 } }).rules[3].value, { diffPts: 0, chainStallSec: null, poolStallSec: null });
  assert.equal(evaluatePrereg({}, S0).ok, false);
  assert.equal(evaluatePrereg(PRE, { ...S0, pool: null }).ok, false);
  assert.equal(evaluatePrereg(PRE, 'x').ok, false);
  for (const k of ['chain', 'baseline', 'chainVsBaseline', 'chainVsPool']) assert.equal(evaluatePrereg(PRE, { ...S0, [k]: undefined }).ok, false, k);
});

const PRICES = [{ id: 'cheap', inPerM: 0.1, outPerM: 0.4, source: 'https://example.com/p', checked: '2026-09-29' }, { id: 'dear', inPerM: 1, outPerM: 5, source: 'https://example.com/q', checked: '2026-09-29' }];
const CM = { jobs: [{ job: 'support', volumePerMonth: 1000, promptTokensPerItem: 1000, completionTokensPerItem: 100, gpuSecondsPerItem: 36 }], prices: PRICES, fx: { gbpPerUsd: 0.75, source: 'ecb' }, power: { wattsLow: 15, wattsHigh: 55, source: 'intel' }, electricity: { pencePerKwh: 25, source: 'ofgem' } };
test('costModel: tokens × list price vs GPU time × watts × unit rate — exact arithmetic', () => {
  const m = costModel(CM);
  assert.deepEqual(m.tokensPerMonth, { prompt: 1000000, completion: 100000 });
  assert.deepEqual(m.cloud, [{ id: 'cheap', usdPerMonth: 0.14, gbpPerMonth: 0.105 }, { id: 'dear', usdPerMonth: 1.5, gbpPerMonth: 1.125 }]);
  assert.deepEqual(m.local, { kwhLow: 0.15, kwhHigh: 0.55, gbpLow: 0.038, gbpHigh: 0.138, laptopHours: 10 });
  assert.deepEqual(m.savingsGbp, [{ id: 'cheap', low: -0.033, high: 0.067 }, { id: 'dear', low: 0.987, high: 1.087 }]);
  const two = costModel({ ...CM, jobs: [...CM.jobs, { job: 'hr', volumePerMonth: 500, promptTokensPerItem: 200, completionTokensPerItem: 10, gpuSecondsPerItem: 7.2 }] });
  assert.deepEqual(two.tokensPerMonth, { prompt: 1100000, completion: 105000 });
  assert.equal(two.local.laptopHours, 11);
  assert.equal(costModel({ ...CM, jobs: [{ ...CM.jobs[0], volumePerMonth: 0 }] }).local.gbpHigh, 0);
  for (const [o, re] of [
    [{ jobs: [] }, /jobs/], [{ jobs: [{ volumePerMonth: 1 }] }, /name/], [{ jobs: [{ ...CM.jobs[0], gpuSecondsPerItem: -1 }] }, /gpuSecondsPerItem/], [{ jobs: [{ ...CM.jobs[0], promptTokensPerItem: 'x' }] }, /promptTokensPerItem/],
    [{ prices: [] }, /list price/], [{ prices: [{ ...PRICES[0], inPerM: -1 }] }, /inPerM/], [{ prices: [{ ...PRICES[0], outPerM: -1 }] }, /inPerM and outPerM/], [{ prices: [{ ...PRICES[0], source: 'http://x' }] }, /https source/], [{ prices: [{ ...PRICES[0], checked: 5 }] }, /checked/], [{ prices: [{ ...PRICES[0], id: 5 }] }, /id/],
    [{ fx: { gbpPerUsd: 0, source: 'x' } }, /fx/], [{ fx: { gbpPerUsd: 1 } }, /fx/], [{ fx: null }, /fx/],
    [{ power: { wattsLow: 20, wattsHigh: 10, source: 'x' } }, /power/], [{ power: { wattsLow: -1, wattsHigh: 10, source: 'x' } }, /power/], [{ power: { wattsLow: 1, wattsHigh: 2 } }, /power/], [{ power: { wattsLow: 'x', wattsHigh: 2, source: 'x' } }, /power/],
    [{ electricity: { pencePerKwh: -1, source: 'x' } }, /electricity/], [{ electricity: { pencePerKwh: 1 } }, /electricity/], [{ electricity: 'x' }, /electricity/],
  ]) assert.match(costModel({ ...CM, ...o }).why, re, JSON.stringify(o).slice(0, 60));
  assert.equal(costModel({ ...CM, power: { wattsLow: 10, wattsHigh: 10, source: 'x' } }).ok, true);
  assert.equal(costModel({ ...CM, power: { wattsLow: 0, wattsHigh: 10, source: 'x' } }).ok, true);
  assert.equal(costModel({ ...CM, electricity: { pencePerKwh: 0, source: 'x' } }).ok, true);
  assert.equal(costModel({ ...CM, electricity: { pencePerKwh: 'x', source: 'x' } }).ok, false);
  assert.equal(costModel({ ...CM, power: { wattsLow: 1, wattsHigh: Infinity, source: 'x' } }).ok, false);
  assert.equal(costModel({ ...CM, prices: [{ ...PRICES[0], inPerM: 'x' }] }).ok, false);
  assert.equal(costModel({ ...CM, prices: [{ ...PRICES[0], outPerM: 'x' }] }).ok, false);
  assert.equal(costModel({ ...CM, prices: [{ ...PRICES[0], inPerM: 0, outPerM: 0 }] }).ok, true);
  assert.equal(costModel(null).ok, false);
  assert.equal(costModel({ ...CM, jobs: 'x' }).ok, false);
  assert.equal(costModel({ ...CM, prices: [null] }).ok, false);
  assert.equal(costModel({ ...CM, jobs: [null] }).ok, false);
});
