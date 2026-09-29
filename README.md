# fallfloor — a company's AI, run on the laptops it already owns

**Live page: https://sjgant80-hub.github.io/fallfloor/** — the results, every signed receipt (with a "verify the ledger" button that re-checks them in your browser), the cost comparison with its sources, and a node console to join from your own machine.

A **reference build** for a **modelled** digital bank. It is not a real client: no client, name, quote or testimonial is involved. Everything runs on public labelled data, so every answer is checked against a label someone else wrote.

The question, fixed before the first run ([`prereg.json`](prereg.json), pushed in commit [`f4d80b0`](https://github.com/sjgant80-hub/fallfloor/commit/f4d80b0827e133de0994d284c5e0215d939b428a) at 2026-09-29T09:31:50Z):

> Can a company's everyday AI work run on WebLLM in the browsers of laptops it already owns, passed node to node over WebRTC with no server, and is a chain of stations the right shape for it?

## Results

<!-- ⟦RESULTS-BEGIN⟧ generated from runs/latest.json by make-page.mjs — do not edit here -->
Run `floor-2026-09-29` · 2026-09-29T12:44:34.590Z → 2026-09-29T16:22:09.783Z · 898 signed hops · ledger sha256 `aec73531c3a0ec4099a845038436e38c8bbf64aa370b2bb71453edfc9a17f5c0`

**Machines: ONE laptop: intel gen-12lp GPU (WebGPU), 12 logical cores. Each node was its own headless Chrome process with its own profile, linked by real WebRTC data channels on this machine; the harness carried the signalling codes between them as a person would paste them. No signalling server, no relay server, no cloud model.**

**Pre-registered rules: 3 of 5 passed.**

| Rule | Measured | Verdict |
|---|---|---|
| capability — chain end-to-end ≥ baseline − 5 points (same items) | 7 | PASS |
| no-loss — no item lost and no item accepted twice, in either kill test | `{"chainLost":0,"poolLost":0,"chainDup":0,"poolDup":0}` | PASS |
| latency — chain p95 ≤ 60 s per item | 61.962 | FAIL |
| chain-shape — the chain beats the pool by ≥ 5 points, or loses less, or stalls less, when a node dies | `{"diffPts":0,"chainStallSec":80.6,"poolStallSec":50}` | FAIL |
| cold-start — every node gives its first answer within 600 s of starting, model download included | 234.4 | PASS |

Customer support — the same 100 held-out items:

| | Chain | Pool | One model (3B) |
|---|---|---|---|
| Correct end to end | 39% | 39% | 32% |
| Right team | 69% | 69% | 78% |
| Right topic | 45% | 45% | 40% |
| Reply passed the gate | 91% | 91% | 50% |
| Caught (went to a person) | 9% | 9% | 50% |
| Silent errors (wrong, and sent) | 52% | 52% | 18% |
| Time per item p50 / p95 | 52.5 s / 62 s | 51.3 s / 64.6 s | 237.8 s / 248.3 s |
| Items per minute | 3.322 | 3.418 | 0.756 |
| Lost / accepted twice | 0 / 0 | 0 / 0 | 0 / 0 |
| Duplicate deliveries dropped | 0 | 1 | 0 |
| Longest gap between answers | 80.6 s | 50 s | 86.9 s |
| Tokens per item (in / out) | 830.62 / 73.01 | 830.62 / 73.01 | 2484.96 / 35.18 |

Paired on the same items: chain vs one model 7 points (exact McNemar p = 0.311); chain vs pool 0 points (p = 1). Under about 5 points is a tie; a p above 0.05 means the difference could be chance.

**What that means:** 39% correct end to end, with 52% of replies wrong but passing the gate. At this accuracy the support line is not good enough to answer customers on its own — every reply needs a person to check it. The plumbing held (nothing lost, every hop signed and verified); the small models are the limit.

The rest of the company, on the pool: security screening 82% correct (100/100 completed); HR helpdesk 85% correct (100/100 completed).

Security, taken apart: spam caught 8 of 8; legitimate messages wrongly flagged 18 of 92. Answering "legit" every time would have scored 92% on these items — so the small model's accuracy is below that bar: it over-flags.

What went wrong on the hardware: 0 unplanned node restarts during the work; 0 GPU faults while a model was loading; Windows standby entries during the run: 0.

Cold starts (browser launch → first answer, model download included): n1 122.6 s (828 MB downloaded), n2 114.8 s (828 MB downloaded), n3 116.1 s (828 MB downloaded), n4 234.4 s (1656 MB downloaded).

Cost of one month at the **modelled** volumes (support 15,000, security 40,000, hr 2,000 items — assumptions, change them on the page):

| The same month of work, sent to… | Per month | Source |
|---|---|---|
| These laptops (already owned) — electricity only | £0.51 – £1.87 | 128.944 laptop-GPU hours × 15–55 W (estimate, [Intel](https://www.intel.com/content/www/us/en/products/sku/226259/intel-core-i71255u-processor-12m-cache-up-to-4-70-ghz/specifications.html)) × 26.32p/kWh ([Ofgem](https://www.ofgem.gov.uk/your-energy-supply/your-energy-bill/energy-price-cap-unit-rates-and-standing-charges)) |
| OpenAI · gpt-5-nano | £1.45 | [list price](https://developers.openai.com/api/docs/pricing), checked 2026-09-29 |
| OpenAI · gpt-4o-mini | £3.73 | [list price](https://developers.openai.com/api/docs/pricing), checked 2026-09-29 |
| OpenAI · gpt-5-mini | £7.24 | [list price](https://developers.openai.com/api/docs/pricing), checked 2026-09-29 |
| Google · Gemini 3.1 Flash-Lite | £6.73 | [list price](https://ai.google.dev/gemini-api/docs/pricing), checked 2026-09-29 |
| Anthropic · Claude Haiku 4.5 | £25.90 | [list price](https://platform.claude.com/docs/en/about-claude/pricing), checked 2026-09-29 |
| Anthropic · Claude Sonnet 5 | £51.80 | [list price](https://platform.claude.com/docs/en/about-claude/pricing), checked 2026-09-29 |

Tokens are measured with the local model's tokenizer; cloud tokenizers differ, so cloud figures are approximate. FX 0.75396 GBP/USD ([ECB](https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml)).

**This prices the same tokens, not the same quality.** No cloud model was run here; a larger cloud model would very likely answer more of these items correctly. The local figure is electricity only — the laptops are already owned, and their time is the real cost: at these volumes the work needs about 129 laptop-GPU hours a month, about 0.8 laptops' worth of office hours (8 h × 21 days) on laptops like this one.
<!-- ⟦RESULTS-END⟧ -->

## How it works, step by step

1. **The company.** Three departments, each fed by a public dataset: customer support (Banking77, 77 topics, re-grouped into 7 teams), security screening of inbound messages (SMS Spam Collection), and a staff HR helpdesk (CLINC150 "work" domain plus out-of-scope). 100 held-out items per department, drawn with a published seed; the few-shot examples come from the training data and never overlap them (`tools/prepare-data.mjs` checks this).
2. **The laptops and the mesh.** A node is a browser tab running a small open model on the machine's own GPU through WebGPU ([WebLLM](https://github.com/mlc-ai/web-llm)). The desk hands out work and keeps the ledger; it runs no model. Nodes join by pasting two short codes (a WebRTC offer and answer): there is no signalling server and no relay server. A message for a node that is not directly linked is relayed through the peers that are (meshos-style, bounded hops).
3. **The line.** Support runs as three stations: **route** (one of 7 teams, forced by a JSON schema) → **intent** (that team's topics, or "not my team", which stops the line) → **reply** (opens by naming the topic's help article). A deterministic gate then checks the reply: the right article, and no other codes, numbers, links or emails. Anything that fails is *caught* and goes to a person instead of being sent.
4. **Receipts.** Every hop writes a record — which node (its Ed25519 public key), which model, a hash of what it was given, what it answered, tokens, time, and the hash of the hop before — and signs it. The next station checks the whole chain and every signature before it adds to it; the desk checks again; `tools/verify-run.mjs` and the page check again from the published ledger alone.
5. **The test.** The same 100 support items three ways: a **chain** (each station on its own node), a **pool** (each node runs the whole line on its share, and the desk moves work off a node that has gone), and a **one-model baseline** (the largest model this laptop holds, Qwen2.5-3B, answering topic and reply in one prompt that lists every topic, example and article code). In the chain and the pool, the middle node is killed after 40 results and brought back 60 s later. Security and HR run on the pool.
6. **Grading.** Deterministic, against the datasets' own labels, by the same kernel the page runs. No model judges another model.
7. **Cost.** Cloud: measured tokens per item × public list prices (each linked, with the date it was checked). Local: the laptops are already owned, so the work adds electricity — laptop time measured in the run × an *estimated* wattage from the chip's published power × the Ofgem price-cap unit rate. Monthly volumes are modelled assumptions; the page lets you change them.

## Check it yourself

```
node --test kernel.test.mjs                       # the kernel's contract
node tools/witness.mjs mutate kernel.mjs --timeout 30000 --cap 900 --test node --test kernel.test.mjs   # mutation gate
node make-page.mjs && git diff --exit-code index.html README.md llms.txt                                # the page IS this kernel
node tools/page-gate.mjs                          # the page's own gate
node tools/verify-run.mjs                         # re-hash, re-sign-check, re-score the committed run from its receipts
```

CI runs all five on every push. `verify-run` trusts nothing the desk wrote about outcomes: it rebuilds every answer from the signed hop outputs, reads the gold labels from the data files, re-scores every arm, re-evaluates the pre-registered rules, and checks that `prereg.json` is byte-identical to the file committed before the run. What it cannot check: the start and end time of each item are the desk's clock, not signed.

## Run it on more than one machine

Open the live page on a second computer with Chrome or Edge (WebGPU), open **Run it yourself**, load a model, then swap two codes with a node on the first machine (offer → answer). On the same network no server is involved; across networks, tick "use a public STUN server" (it only helps the two machines find each other's address — no traffic goes through it). The measured run in this repo used **one laptop**: every node was a separate Chrome process with its own profile and model copy, joined by real WebRTC data channels on that machine, and the test harness carried the codes between them as a person would paste them.

To reproduce the measured run on your own machine: `node tools/run-floor.mjs --run <id>` (needs Node, Chrome, and Playwright; see the top of the file). Smoke tests use `--dev --limit N` (development items, never the held-out ones).

## What changed after the pre-registration

Logged in [`prereg-log.json`](prereg-log.json) and committed before the measured run: a development set for prompt writing and smoke tests; the security station asks "is this SMS spam? yes/no" (still schema-constrained, still the same examples); the reply rule opens with the article; engine faults on this laptop's GPU are handled and reported; every answer is rebuilt from the signed hops by one kernel function. The thresholds, arms, models, held-out items and examples did not change.

Prompt variants measured on the development set before the run (1.5B station model; single development runs on this laptop, not receipted — the prompts that were kept can be re-measured with `node tools/tune.mjs --job security|hr|support`):

| Station | Variant | Dev score |
|---|---|---|
| security (40 items, 10 spam) | "label it legit or spam", long rules | 21 / 40 |
| | the same, strict rules, no examples | 20 / 40 |
| | strict rules + examples | 10–11 / 40 |
| | yes/no, plain text | 28 / 40 |
| | yes/no as JSON `{"spam": "yes"/"no"}`, no examples | 33 / 40 |
| | **yes/no as JSON, with the examples (used)** | **34 / 40** |
| reply (30 items, true topic given) | "mention article HC-…" | 19 / 30 |
| | fixed last sentence | 13 / 30 |
| | **open with "Help article HC-… covers this." (used, both reply paths)** | **29 / 30** |
| route (40 items) | **teams + 14 examples (kept)** | **30 / 40** |
| | teams with all their topics, no examples | 18 / 40 |
| | teams with topics + examples | 32 / 40 (within noise, 85% slower — not used) |

## Limits

- **One laptop.** The nodes share one GPU; several laptops would add throughput, which this run does not measure.
- **Small models, narrow jobs.** Classification and short templated replies. Open-ended work is out of scope.
- **Grading is by label.** The reply gate checks the citation and invented figures, not tone.
- **Cost is electricity only.** The laptops, their wear and the time to set a node up are not costed. The wattage is an estimate.
- **Licences.** The station model (Qwen2.5-1.5B-Instruct) is Apache 2.0. The 3B baseline model's licence is research-only; it is here as the comparison, not as something to run in production.
- **Downloads.** The page, WebLLM and the model weights are fetched once from public hosts (GitHub Pages, jsDelivr, Hugging Face). After that the work runs on the laptop.

## Credits

A reference build by AI-Native Solutions. MIT licence. Powered by the Konomi architecture, created by Thomas Frumkin.

Data: Banking77 by PolyAI (Casanueva et al., 2020), CC BY 4.0 · SMS Spam Collection v.1 by Tiago A. Almeida and José María Gómez Hidalgo, CC BY 4.0 · CLINC150 by Larson et al., 2019, CC BY 3.0. Models: Qwen2.5 Instruct (Qwen team) via WebLLM (MLC, Apache 2.0). See [`NOTICE`](NOTICE).
