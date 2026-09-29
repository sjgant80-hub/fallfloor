# fallfloor — agent instructions

fallfloor — a company's AI, run on the laptops it already owns

## Boundaries

- Keep fallfloor zero-dependency and deterministic. Do not add runtime dependencies.
- Every change to a source line must be covered by a test that fails when the line changes (witness gate).
- Do not skip, disable, or weaken a test to make the suite green. Fix the code or the test's premise.
- Structure and behaviour are gated by konomify; a change ships only when it stays konomified.
