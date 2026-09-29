#!/usr/bin/env node
// tools/page-gate.mjs — the page's own gate (ui-gate + surface rules). Runs in CI.
//   dead controls · broken in-page and repo links · ids the scripts use but the page lacks · undefined CSS variables ·
//   scripts that do not parse · placeholders · own-product pricing · every third-party price sourced and dated ·
//   the credits and the "not a real client" line present · the AI-GEO files present and well-formed · nothing private.
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const html = read('index.html');
const fails = [];
const check = (cond, what) => { if (!cond) fails.push(what); };

// the static page: markup outside scripts and styles
const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].map((m) => ({ attrs: m[1], body: m[2] }));
const markup = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
const code = scripts.filter((s) => !/application\/(ld\+)?json/.test(s.attrs)).map((s) => s.body).join('\n');
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const staticIds = new Set([...markup.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

// 1 · in-page anchors land on something
for (const [, a] of markup.matchAll(/href="#([^"]*)"/g)) check(staticIds.has(a), 'anchor #' + a + ' has no target');
// 2 · relative links resolve to files in the repo; absolute links are https
for (const [, h] of markup.matchAll(/href="([^"#][^"]*)"/g)) {
  if (h.startsWith('data:')) continue;
  if (/^https?:/.test(h)) { check(h.startsWith('https://'), 'insecure link ' + h); continue; }
  check(existsSync(join(root, h.split('?')[0])), 'relative link ' + h + ' has no file');
}
// 3 · every id a script reaches for exists; every button is wired
for (const [, id] of code.matchAll(/\$\('([A-Za-z][\w-]*)'\)/g)) check(ids.has(id), "the script uses $('" + id + "') but the page has no such id");
for (const [, id] of code.matchAll(/getElementById\('([A-Za-z][\w-]*)'\)/g)) check(ids.has(id), 'the script uses #' + id + ' but the page has no such id');
for (const [, id] of markup.matchAll(/<button[^>]*id="([^"]+)"/g)) check(new RegExp("(on\\('" + id + "'|\\$\\('" + id + "'\\)\\.(addEventListener|onclick))").test(code), 'dead control: button #' + id + ' has no handler');
check(!/<button(?![^>]*\sid=)/.test(markup), 'a button without an id cannot be checked for a handler');
// 4 · CSS variables used are defined
const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n') + html;
const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
for (const [, v] of css.matchAll(/var\((--[\w-]+)/g)) check(defined.has(v), 'CSS variable ' + v + ' is used but never defined');
// 5 · every script parses (the module is checked as a module)
const tmp = mkdtempSync(join(tmpdir(), 'ffgate-'));
scripts.forEach((s, i) => {
  if (/application\/ld\+json/.test(s.attrs) || /application\/json/.test(s.attrs)) { try { JSON.parse(s.body); } catch (e) { fails.push('JSON script ' + i + ' does not parse: ' + e.message); } return; }
  const f = join(tmp, 's' + i + (/type="module"/.test(s.attrs) ? '.mjs' : '.cjs'));
  writeFileSync(f, s.body);
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { fails.push('script ' + i + ' does not parse: ' + String(e.stderr).split('\n').slice(0, 5).join(' ')); }
});
// 6 · no placeholders, no private notation
const text = markup.replace(/<[^>]+>/g, ' ');
for (const w of ['TODO', 'TBD', 'lorem', 'XXX', 'coming soon', 'FIXME', 'placeholder text']) check(!text.toLowerCase().includes(w.toLowerCase()), 'placeholder on the page: ' + w);
for (const f of ['index.html', 'README.md', 'llms.txt']) if (existsSync(join(root, f))) check(!/[κφ]/.test(read(f)), f + ' carries private notation (κ/φ)');
// 7 · no own-product pricing: the static page names no money amounts at all; the third-party prices it renders come
//     from sources/costs.json, where every one carries an https source and the date it was checked
check(!/[£$€]\s?\d/.test(text), 'the static page shows a money amount (own-product pricing is never shown; third-party prices come from sources/costs.json)');
// 'per seat' is allowed: the page describes how the corporate model is sold; it never offers a price of its own
check(!/\b(pricing|\/mo\b|subscribe|buy now|free trial)/i.test(text), 'the static page reads like a price list');
const costs = JSON.parse(read('sources/costs.json'));
for (const p of costs.prices) check(/^https:\/\//.test(p.source) && /^\d{4}-\d{2}-\d{2}$/.test(p.checked), 'price ' + p.id + ' lacks an https source or a checked date');
for (const k of ['fx', 'power', 'electricity']) check(/^https:\/\//.test(costs[k].source) && costs[k].checked, 'cost input ' + k + ' lacks a source or date');
check(/ESTIMATE/.test(costs.power.how), 'the wattage must be labelled an estimate');
check(/MODELLED ASSUMPTIONS/.test(costs.volumes.how), 'the volumes must be labelled modelled assumptions');
const why = JSON.parse(read('sources/why.json'));
for (const x of [...why.removes, ...why.stays]) check(/^https:\/\//.test(x.url) && typeof x.ref === 'string' && x.ref.length > 3, 'why: every claim cites its primary text (' + x.what.slice(0, 40) + ')');
check(/^\d{4}-\d{2}-\d{2}$/.test(why.checked), 'why: the date the law was checked');
// 8 · credits and the honest framing
check(html.includes('Powered by the Konomi architecture, created by Thomas Frumkin'), 'the Konomi credit is missing or not verbatim');
check(/Not a real client/.test(markup), 'the page must say it is not a real client');
check(/One laptop/i.test(markup), 'the page must state the machine count');
for (const d of ['Banking77', 'SMS Spam Collection', 'CLINC150']) check(markup.includes(d), 'dataset credit missing: ' + d);
// 9 · AI-GEO
const ld = scripts.find((s) => /application\/ld\+json/.test(s.attrs));
check(ld && /"FAQPage"/.test(ld.body), 'schema.org JSON-LD with an FAQPage is missing');
check(/<link rel="canonical" href="https:\/\/sjgant80-hub\.github\.io\/fallfloor\/"/.test(html), 'canonical URL missing');
check(/<meta name="viewport" content="width=device-width, initial-scale=1"/.test(html), 'viewport meta missing');
check(/<meta name="description" content="[^"]{60,}"/.test(html), 'meta description missing');
for (const f of ['llms.txt', 'robots.txt', 'sitemap.xml', 'manifest.webmanifest', 'NOTICE', 'LICENSE']) check(existsSync(join(root, f)), f + ' is missing');
if (existsSync(join(root, 'robots.txt'))) check(/Sitemap: https:\/\/sjgant80-hub\.github\.io\/fallfloor\/sitemap\.xml/.test(read('robots.txt')), 'robots.txt does not point to the sitemap');
if (existsSync(join(root, 'sitemap.xml'))) check(read('sitemap.xml').includes('<loc>https://sjgant80-hub.github.io/fallfloor/</loc>'), 'sitemap.xml does not list the page');
if (existsSync(join(root, 'manifest.webmanifest'))) { try { const m = JSON.parse(read('manifest.webmanifest')); check(m.name && m.start_url, 'manifest lacks name/start_url'); } catch { fails.push('manifest.webmanifest does not parse'); } }
if (existsSync(join(root, 'README.md'))) check(read('README.md').split('\n').slice(0, 6).join('\n').includes('https://sjgant80-hub.github.io/fallfloor/'), 'the live URL is not at the top of the README');

if (fails.length) { console.error('PAGE GATE FAILED (' + fails.length + '):\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('page gate CLEAN — ' + staticIds.size + ' ids, ' + [...markup.matchAll(/<button/g)].length + ' buttons wired, ' + defined.size + ' CSS variables, ' + scripts.length + ' scripts parse, ' + costs.prices.length + ' third-party prices sourced and dated');
