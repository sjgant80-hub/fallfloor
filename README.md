# fallfloor — a company's AI, run on the laptops it already owns

**Live page: https://sjgant80-hub.github.io/fallfloor/** — the results, every signed receipt (with a "verify the ledger" button that re-checks them in your browser), the cost comparison with its sources, and a node console to join from your own machine.

A **reference build** for a **modelled** digital bank. It is not a real client: no client, name, quote or testimonial is involved. Everything runs on public labelled data, so every answer is checked against a label someone else wrote.

The question, fixed before the first run ([`prereg.json`](prereg.json), pushed in commit [`f4d80b0`](https://github.com/sjgant80-hub/fallfloor/commit/f4d80b0827e133de0994d284c5e0215d939b428a) at 2026-09-29T09:31:50Z):

> Can a company's everyday AI work run on WebLLM in the browsers of laptops it already owns, passed node to node over WebRTC with no server, and is a chain of stations the right shape for it?

## Results

<!-- ⟦RESULTS-BEGIN⟧ generated from runs/latest.json by make-page.mjs — do not edit here -->
The measured run has not been published yet.
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

Prompt variants measured on the development set before the run (1.5B station model):

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
