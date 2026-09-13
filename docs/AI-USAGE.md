# AI usage disclosure

ETHOnline 2026 asks every submission to say where and how AI tools were used, and to include the
prompts and planning artifacts that directed them. This is that disclosure.

## Who did what

**The code was mostly written by AI.** Claude Code (Anthropic), running parallel sub-agents, wrote
the great majority of `contracts/`, `web/` and `scripts/`. No other AI tool was used.

**The project was run by one person, @Kirillr-Sibirski, who made the decisions:**

- **The idea and the direction.** Choosing to build on 1inch Aqua, and choosing covered calls
  written as a pricing curve from the candidates explored, over the alternatives.
- **Scope and priorities.** What the product is for, who it is for, what ships and what gets cut:
  for example collapsing the app to one screen, dropping routes and features that did not serve
  it, and deciding which sponsor prizes the work genuinely fits.
- **Managing the build.** Breaking the work into stages, directing and re-directing the agents,
  and setting the bar each stage had to meet before moving on.
- **Making sure it executed.** Running the app and the demo, reporting what was broken or unclear
  (for example the charts, which were redesigned on that feedback), and rejecting claims that did
  not hold up.
- **What the submission says.** The README, the pitch and the
  claims in the video were reviewed and approved by him, and several were corrected after checks.

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
