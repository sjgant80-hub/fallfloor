#!/usr/bin/env node
// tools/tune.mjs — write the prompts against the DEVELOPMENT set only (data/dev.json), one node, no mesh.
//   node tools/tune.mjs --job support|security|hr|baseline [--model <id>] [--limit N]
// Never touches the held-out items. The prompts live in kernel.mjs; rebuild the page (node tools/make-page.mjs) first.
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const K = await import(pathToFileURL(join(root, 'kernel.mjs')).href);
const { chromium } = createRequire(import.meta.url)('C:/Users/sjgan/Downloads/si-didy-agent/node_modules/playwright');
const argv = process.argv.slice(2), flag = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const JOB = flag('--job') || 'support';
const MODEL = flag('--model') || (JOB === 'baseline' ? 'Qwen2.5-3B-Instruct-q4f16_1-MLC' : 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC');
const LIMIT = Number(flag('--limit') || 1e9);
const dev = JSON.parse(readFileSync(join(root, 'data', 'dev.json'), 'utf8'));
const data = (j) => JSON.parse(readFileSync(join(root, 'data', j + '.json'), 'utf8'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json' };
const srv = createServer((req, res) => { const p = join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html'); if (!p.startsWith(root) || !existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p)); });
await new Promise((r) => srv.listen(8871, '127.0.0.1', r));
const ctx = await chromium.launchPersistentContext('C:/Users/sjgan/.ffnodes/tune/' + (MODEL.includes('3B') ? 'big' : 'n1'), { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-webgpu', ...(process.env.EXTRA_ARGS ? process.env.EXTRA_ARGS.split(' ') : [])] });
try {
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('http://127.0.0.1:8871/index.html?node=tune');
  await page.waitForFunction(() => window.FLOOR && FLOOR.id);
  await page.evaluate((m) => FLOOR.load([m]), MODEL);
  let calls = 0;
  const ask = async (job, station, c) => { calls++; try { return await page.evaluate(([a, b, x]) => FLOOR.ask(a, b, x), [job, station, c]); } catch (e) { console.log('  ! call ' + calls + ' (' + station + ') failed: ' + e.message.split('\n')[0].slice(0, 160)); return { text: '', parsed: station === 'reply' ? { reply: '' } : station === 'baseline' ? { intent: null, reply: '' } : { value: null }, promptTokens: 0 }; } };
  let right = 0, n = 0, tok = 0;
  if (JOB === 'security' || JOB === 'hr') {
    const ex = data(JOB).examples[JOB === 'security' ? 'screen' : 'helpdesk'];
    for (const x of dev[JOB].slice(0, LIMIT)) {
      const r = await ask(JOB, JOB === 'security' ? 'screen' : 'helpdesk', { text: x.text, examples: ex });
      n++; tok += r.promptTokens; const ok = r.parsed.value === x.gold.label; right += ok ? 1 : 0;
      if (!ok) console.log('  ✗ gold ' + x.gold.label + ' · got ' + r.parsed.value + ' · ' + x.text.slice(0, 90));
    }
    console.log(JOB + ' dev accuracy ' + right + '/' + n + ' · prompt tokens/item ' + Math.round(tok / n));
  } else {
    const ex = data('support').examples;
    let team = 0, intent = 0, reply = 0, caught = 0, silent = 0;
    for (const x of dev.support.slice(0, LIMIT)) {
      n++;
      const out = { team: null, intent: null, reply: '', bounced: false };
      if (JOB === 'baseline') {
        const b = await ask('support', 'baseline', { text: x.text, examples: [...ex.route, ...ex.intent] }); tok += b.promptTokens;
        out.intent = b.parsed.intent; out.team = out.intent ? K.teamOf(out.intent) : null; out.reply = b.parsed.reply;
      } else {
        const r = await ask('support', 'route', { text: x.text, examples: ex.route }); out.team = r.parsed.value; tok += r.promptTokens;
        if (!out.team) out.bounced = true;
        else {
          const i = await ask('support', 'intent', { text: x.text, examples: ex.intent, team: out.team }); tok += i.promptTokens;
          if (!i.parsed.value || i.parsed.value === K.NONE) out.bounced = true;
          else { out.intent = i.parsed.value; const p = await ask('support', 'reply', { text: x.text, intent: out.intent }); out.reply = p.parsed.reply; tok += p.promptTokens; }
        }
      }
      const g = K.gradeSupport(x.gold, out);
      team += g.teamOk ? 1 : 0; intent += g.intentOk ? 1 : 0; reply += g.replyPass ? 1 : 0; caught += g.caught ? 1 : 0; silent += g.silent ? 1 : 0; right += g.e2e ? 1 : 0;
      if (!g.e2e) console.log('  ✗ ' + (g.caught ? 'caught' : 'SILENT') + ' · gold ' + x.gold.team + '/' + x.gold.intent + ' · got ' + out.team + '/' + out.intent + (g.intentOk && !g.replyPass ? ' · reply: ' + K.checkReply(out.reply, x.gold.intent).reasons.join(', ') + ' · "' + out.reply.slice(0, 120) + '"' : '') + ' · ' + x.text.slice(0, 70));
    }
    console.log(JOB + ' dev: e2e ' + right + '/' + n + ' · team ' + team + ' · intent ' + intent + ' · reply-gate ' + reply + ' · caught ' + caught + ' · silent ' + silent + ' · prompt tokens/item ' + Math.round(tok / n));
  }
  console.log("node stats " + JSON.stringify(await (ctx.pages()[0]).evaluate(() => FLOOR.stats)) + " · log: " + JSON.stringify(await (ctx.pages()[0]).evaluate(() => FLOOR.log.filter((l) => /engine error/.test(l)))));
} finally { await ctx.close(); srv.close(); }
