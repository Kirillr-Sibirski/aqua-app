# AI usage disclosure

ETHOnline 2026 requires submissions to state where and how AI tools were used, and to include
the spec, prompt and planning artifacts that directed them. This document is that disclosure.

## Tool

Claude Code (Anthropic) driving a fleet of parallel sub-agents. One human operator
(@Kirillr-Sibirski) set the goal, the constraints and the acceptance bar, reviewed every
stage, and made the product decisions. No other AI tooling was used.

## How the work was directed

The project was run as four explicit stages. Every stage is reproducible from the artifacts in
this repository.

| Stage | Artifact | What it produced |
|---|---|---|
| 1. Research | [`docs/workflows/01-research.js`](workflows/01-research.js) | 14 parallel researchers, a completeness critic and a gap-filling round wrote [`docs/research/`](research/) — protocol internals read from source, hackathon rules, prior-winner analysis, market evidence, UX benchmarks, fork recipes. |
| 2. Design | [`docs/workflows/02-design-workshop.js`](workflows/02-design-workshop.js) | 10 ideators working from distinct lenses proposed 20 product concepts; each was attacked by three adversarial critics (protocol judge / staff engineer / skeptical founder); three judges ranked the survivors; a synthesizer produced the concept brief. |
| 3. Infrastructure | [`03-prep-harness-encoder.js`](workflows/03-prep-harness-encoder.js), [`04-prep-fork-infra.js`](workflows/04-prep-fork-infra.js) | The Foundry harness, the TypeScript SwapVM encoder with byte-for-byte Solidity cross-checks, the Base-fork demo stack, and the live-liquidity proof. Each ran with an independent verifier that re-executed every claim from scratch. |
| 4. Build | see commit history | Implementation of the chosen position, its custom SwapVM instructions, tests and UI. |

The workflow scripts are the literal inputs: they contain the prompts, the schemas each agent
had to satisfy, and the orchestration logic (fan-out, adversarial verification, judging).

## What the AI wrote, and what was checked

AI agents wrote the great majority of the code in `contracts/`, `web/` and `scripts/`, and all
of `docs/research/`. That output was not taken on trust:

- **Every factual claim in the research was re-derived from source.** Protocol behaviour is
  cited to file and line in the vendored `@1inch/aqua` and `@1inch/swap-vm` packages, or
  verified on-chain with `cast` against the live deployments. Contradictions between agents
  were resolved by a critic pass reading the source ([`docs/research/completeness-review.md`](research/completeness-review.md)).
- **Every design claim was attacked before it was accepted.** Three independent critics per
  concept, instructed to refute rather than improve. Several concepts were killed by critics
  who read our own contracts and reproduced the numbers; one caught a 10-15x gas error, one
  disproved an assumed instruction behaviour by reading `MinRate.sol`.
- **Every build claim was re-run by an independent verifier** that did not write the code, on a
  clean tree. Their corrections are in the commit history.
- **The test suite is the contract.** Claims in this repository are backed by tests that run:
  `make test` (unit), `make test-fork` (against the official Aqua registry on a fork), and
  `npm test` in `web/` (encoder parity against Solidity-generated vectors).

## Limitations we are explicit about

- Interactive browser behaviour (wallet pop-ups, hydration) was verified by React server render
  and by driving `@wagmi/core` actions directly against a fork, not by a human clicking through
  every path in a browser.
- The live-liquidity fork test pins a Base block; if the referenced maker strategies are docked
  upstream, those assertions must be re-pinned.
