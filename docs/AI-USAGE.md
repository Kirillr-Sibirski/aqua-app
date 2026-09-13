# AI usage disclosure

ETHOnline 2026 asks every submission to say where and how AI tools were used, and to include the
prompts and planning artifacts that directed them. This is that disclosure.

## Who decided what

The project was designed and run by one person, @Kirillr-Sibirski:

- **The idea.** Covered calls written as an RMM-01 pricing curve on 1inch Aqua, chosen over the
  alternatives explored.
- **The design.** The Coverage check that lets one wallet back many offers (portfolio margin), the
  protocol fee, the buy side, and what the product should and should not do.
- **Scope, UX and visual direction.** The one-screen app, the landing and docs pages, the
  animations, and what to cut.
- **The demo.** The hosted fork, the demo wallet and the recorded walkthrough.
- **Verification.** Testing everything end to end, and catching and correcting explanations that
  were wrong (for example the premium economics and the charts) before submission.

## How AI was used

Claude Code (Anthropic) was used as a coding assistant, including its sub-agents: much of the
implementation code (contracts, scripts, frontend), refactors and codebase research was generated
with it under my direction and review. No other AI tool was used.

## How the work was directed

| Stage | Artifact | What it produced |
|---|---|---|
| 1. Research | [`workflows/01-research.js`](workflows/01-research.js) | Protocol internals read from source, hackathon rules, prior winners, market evidence. The notes were removed from the tree before submission and are [kept in history](https://github.com/Kirillr-Sibirski/strikeline/tree/6912633/docs/research). |
| 2. Design | [`workflows/02-design-workshop.js`](workflows/02-design-workshop.js) | Candidate product concepts, each attacked by adversarial critics, from which the final direction was chosen. |
| 3. Infrastructure | [`03-prep-harness-encoder.js`](workflows/03-prep-harness-encoder.js), [`04-prep-fork-infra.js`](workflows/04-prep-fork-infra.js) | The Foundry harness, the TypeScript SwapVM encoder, and the Base-fork demo stack. |
| 4. Build | commit history | Directed interactively in Claude Code sessions. There are no separate spec files for this stage beyond the commits. |

The workflow scripts are the literal prompts, schemas and orchestration used in stages 1 to 3.

## How AI output was checked

- **Tests are the bar.** Claims in this repository are backed by tests that run: `make test`
  (147 offline tests), `make test-fork` (against the official Aqua registry on a fork), and
  `npm test` in `web/`.
- **Research was checked against source.** Protocol behaviour is cited to the vendored
  `@1inch/aqua` and `@1inch/swap-vm` packages or verified on-chain.
- **Claims were re-verified before submission.** Documentation and figures were audited against the
  code, and claims that did not hold up were corrected or removed.
