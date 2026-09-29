# fallfloor — specification

## Purpose

fallfloor — a company's AI, run on the laptops it already owns

## Contract

- **articleCode** — part of the fallfloor public surface; deterministic, total (never throws).
- **buildPrompt** — part of the fallfloor public surface; deterministic, total (never throws).
- **canon** — part of the fallfloor public surface; deterministic, total (never throws).
- **checkReply** — part of the fallfloor public surface; deterministic, total (never throws).
- **costModel** — part of the fallfloor public surface; deterministic, total (never throws).
- **evaluatePrereg** — part of the fallfloor public surface; deterministic, total (never throws).
- **exactMcNemar** — part of the fallfloor public surface; deterministic, total (never throws).
- **gradeLabel** — part of the fallfloor public surface; deterministic, total (never throws).
- **gradeSupport** — part of the fallfloor public surface; deterministic, total (never throws).
- **hopReceipt** — part of the fallfloor public surface; deterministic, total (never throws).
- **hopSignable** — part of the fallfloor public surface; deterministic, total (never throws).
- **humanize** — part of the fallfloor public surface; deterministic, total (never throws).
- **labelBreakdown** — part of the fallfloor public surface; deterministic, total (never throws).
- **outcomeFromHops** — part of the fallfloor public surface; deterministic, total (never throws).
- **pairedCompare** — part of the fallfloor public surface; deterministic, total (never throws).
- **parseBaseline** — part of the fallfloor public surface; deterministic, total (never throws).
- **parseLabel** — part of the fallfloor public surface; deterministic, total (never throws).
- **percentile** — part of the fallfloor public surface; deterministic, total (never throws).
- **readStation** — part of the fallfloor public surface; deterministic, total (never throws).
- **reassign** — part of the fallfloor public surface; deterministic, total (never throws).
- **routeFor** — part of the fallfloor public surface; deterministic, total (never throws).
- **scoreRun** — part of the fallfloor public surface; deterministic, total (never throws).
- **seededOrder** — part of the fallfloor public surface; deterministic, total (never throws).
- **sha256** — part of the fallfloor public surface; deterministic, total (never throws).
- **teamOf** — part of the fallfloor public surface; deterministic, total (never throws).
- **validEnvelope** — part of the fallfloor public surface; deterministic, total (never throws).
- **verifyChain** — part of the fallfloor public surface; deterministic, total (never throws).
- **verifyHop** — part of the fallfloor public surface; deterministic, total (never throws).

## Guarantees

- **Deterministic** — the same input yields the same output on any machine, any run.
- **Total** — hostile or malformed input returns a defined value, never an exception.
- **Zero-dependency** — no third-party runtime code inside the trust boundary.

## Verification

The suite exercises the public surface directly and is mutation-checked: a change to any guarded line makes a
test fail. konomify admits fallfloor only when both the structure rubric (acg-assessor) and the behaviour gate
(witness) pass.
