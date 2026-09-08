# The inferred rubric, and a replica prompt for the qualitative pass

`score_submission.py --rubric` prints this file. It is for a human, or an agent, to
do the pass the linear model cannot: reading the submission the way the assessor
reads it. Nothing here is documentation from ETHGlobal — every claim is either
MEASURED on 602 scored projects or labelled INFERRED.

---

## Part 1 — what the thing actually is

**MEASURED.** ETHGlobal publishes, inside the Next.js RSC payload of every showcase
page, a `project.meta` object with exactly seven keys and nothing more:

    autoSummary          602/670   1-2 neutral sentences describing the project
    autoOriginality      602/670   integer
    autoPracticality     602/670   integer
    autoTechnicality     602/670   integer
    demoVideoReady       509/670   ALWAYS true, never once false -> a presence flag
    tmpVideoId           536/670   a monotone global video-upload counter
    timer                398/670   the live-judging clock (duration 420s for all 396)

There are no tracks, no eligibility fields, no per-prize confidence, no moderation
flags and no embeddings in the public payload. The scores are never rendered in
visible markup — they exist only inside the script blobs.

**MEASURED.** Observed range is **1-9**, not 5-10. No axis ever reached 10 in 602
observations. Practicality is effectively capped at 8 (only 4 projects at 9);
originality likewise (4 at 9); only technicality routinely reaches 9 (n=71). The
realistic ceiling is T=9 / O=8 / P=8 = **25**.

**MEASURED.** Distribution:

| score | originality | practicality | technicality |
|---|---|---|---|
| <=5 | 3.5% | 1.9% | 2.5% |
| 6 | 10.1% | 3.3% | 3.7% |
| 7 | 47.3% | 34.1% | 16.3% |
| 8 | 38.4% | 60.1% | **65.8%** |
| 9 | 0.7% | 0.7% | 11.8% |

Mean 7.20 / 7.53 / 7.76. The modal triple is (7,8,8) — 30% of the whole field.
44.5% of all projects sum to exactly 23.

**MEASURED.** Win rate by total: `<=17` 0% (n=14) · `18-20` 8.0% (n=50) ·
`21-23` 35.2% (n=401) · `24-26` 46.0% (n=137). It is a **floor, not a ladder**:
the jump happens between 20 and 21, then it flattens.

**MEASURED.** It is a **one-shot batch**. ~10% of projects at every 2026 IRL event
carry no scores at all (including 13 prize winners); three unscored Cannes projects
re-fetched five months later still have no `auto*` keys. There is no submission-order
effect. The score is computed at the cutoff and never recomputed.

**MEASURED.** A team **cannot see its own score**. `getProjectSelfByEventSlug`, the
query behind the team's dashboard, selects 57 fields and `meta` is not one of them.
The score becomes readable only when the showcase is published, and only from page
source. There is no iteration loop: everything must be right before the deadline.

---

## Part 2 — the rubric the three numbers come from

**MEASURED (extracted verbatim from ETHGlobal's own judging bundle,
`js/2s62istus5qpi.js`).** The human judge scorecard, all `StarRating max:10`:

    Project Quality:     Technicality · Practicality · Originality · UI/UX/DX (`design`) · WOW Factor
    Submission Quality:  Demo Quality · Presentation Quality
    plus:                Flag / Favorite / Marked-missing toggles, an `unclear` flag, a notes box
    also rendered:       "AI Usage: {useOfAI}", and a Continuity-track vs Building-from-scratch badge

Sponsor review is a **different** five-axis rubric: `status, disqualifiedReason,
technicality, practicality, originality, design, protocolUsage, notes` — partners
additionally rate **protocolUsage** and can disqualify with a reason.

**INFERRED.** `autoTechnicality` / `autoOriginality` / `autoPracticality` are
literally the first three axes of that human scorecard, on the same 1-10 scale.
The auto triad is a machine pre-fill of the judge's own card. This is inferred from
the exact field-name match plus the absence of any competing explanation — the
judging bundle that was decompiled does **not** display the AI values.

**MEASURED, and the single most important finding.** The scorer reads your
**repository**, not just your write-up:

- 74-96 of 602 `autoSummary` strings (12-16%) name a technology that appears
  **nowhere** in the entire submitted text (Next.js 25/141 unsourced, Solidity
  11/57, Supabase 4/8).
- It makes absence claims that require inspection: ETHGlobal's own test project
  scored 1/1/1 with *"The provided **repositories** contain only minimal top-level
  files and no accessible application code or **dependency manifests**"* — plural,
  so every linked repo is read.
- Long write-ups do not rescue empty repos: 2,730 chars → technicality 2
  (*"no implementation files are provided"*); 1,688 chars naming 8 technologies →
  technicality 2 (*"a concept repository"*).
- Repo shape out-predicts every text feature (commits ρ=+0.533, root dirs ρ=+0.527,
  vs +0.44 for the best text feature), on a stratified n=122 sample.

**MEASURED.** It does **not** read the video and does not visit the demo. Only 2/602
summaries contain the word "video"; `has_demo_url` has a negative fitted weight; the
`demoVideoReady` effect collapses under length control (+0.59 short → +0.08 long).
The video matters enormously for **winning** (43% vs 9% among long write-ups) — it
just is not a scorer input.

**MEASURED, upstream of all of this.** Round-1 screeners tick "Code verified" and
"Demo verified" and give three max-10 stars (Video Quality, Submission Quality,
Project Quality); the "Promote to Live Judging?" control is gated on a literal
`sum(...) >= 10`. And `checkProjectRepositoriesForGithubRules(projectUuid)` returns
per-repo `flags { tooFewCommits, tooManyLinesChangedPerCommit, firstCommitTooOld,
lastCommitTooRecent, tooManyCommitAuthors }` plus `isFork`, rendered to the screener
as "Too few commits (N)", "Large diffs", "Too many authors", "(Fork)". Thresholds are
server-side and unknown.

---

## Part 3 — the replica prompt

Below is a scoring prompt that was **blind-tested on four disjoint 60-project
holdouts** (240 predictions). Pooled result: originality MAE 0.433 / r 0.650;
practicality MAE 0.429 / r 0.533; technicality MAE 0.450 / r 0.640, against constant
baselines of 0.629 / 0.483 / 0.471.

**Read the caveat before you use it.** On the ordinary body of the distribution
(true score 6-9) technicality actually **loses** to "always write 8" (0.385 vs 0.342).
The correlation is the real signal; the exact integer is not. And the accuracy
numbers measure *one particular model following this prompt*, not a portable artifact.

Calibration map from the blind rounds (pooled n=240) — deflate whatever the replica
says:

| replica says | true mean | share truly >= 8 |
|---|---|---|
| technicality 7 | 7.40 | 58% were really 8 |
| technicality 8 | 7.98 | 91% |
| technicality 9 | 8.42 | 96% (so "a 9" means "almost certainly 8, plausibly 9") |
| practicality 7 | 7.42 | |
| practicality 8 | 7.81 | |
| originality 6 | 6.23 | |
| originality 7 | 7.13 | |
| originality 8 | 7.73 | |

---

### PROMPT (v4, verbatim)

Reproduce ETHGlobal's automated project assessment. Input: a project's tagline,
description, how-it's-made, and three booleans (has_repo, has_demo_url, has_video).
Output three integers: originality, practicality, technicality.

#### The one thing to internalise

This scorer is **generous and compressed**. Measured on 602 scored 2026 IRL
projects (Cannes / New York / Lisbon):

| score | orig | prac | tech |
|---|---|---|---|
| <=5 | 3.5% | 1.9% | 2.5% |
| 6 | 10.1% | 3.3% | 3.7% |
| 7 | 47.3% | 34.1% | 16.3% |
| 8 | 38.4% | 60.1% | 65.8% |
| 9 | 0.7% | 0.7% | 11.8% |

Mean 7.20 / 7.53 / 7.76. The modal triple is (7,8,8) — 30% of all projects. Write
(7,8,8) first and move a number only when you can name the reason.

Judge holistically. The rules below are calibration guards, not a decision tree —
when a guard and your reading of the project disagree, trust the reading and use
the guard only to check you have not drifted off the base rates.

#### Step 1 — named-artifact count (N), used as a floor only

In the **how-it's-made only**, count distinct things specific enough to look up:
contract/file/function names (`RiskEngine.sol`, `_humanGate`, `executor.ts`),
standard numbers (EIP-712, ERC-4626, ENSIP-10), version numbers (Solidity 0.8.24,
Skandha v2.4.5), addresses / chain ids / topic ids, specific API calls
(`NameWrapper.setSubnodeRecord()`), and narrated concrete failures with their fix.

Do **not** count bare product names in a stack list (Next.js, Postgres, World ID,
Hedera, viem, Tailwind) or capability claims ("we integrated ENS for identity").

| N | n=362 | tech mean | floor it sets |
|---|---|---|---|
| 0-2 | 109 | 7.20 | none |
| 3-7 | 125 | 7.81 | 7 |
| 8-14 | 76 | 8.03 | **7** (nothing below 7 was observed) |
| 15+ | 52 | 8.24 | **8** (only 8s and 9s were observed) |

N never *forces* a score up. A high N with a thin system is still an 8, not a 9.

#### Step 2 — technicality. Anchor 8.

**8 is the answer two-thirds of the time.** Write 8, then look for a reason.

**7** (16%) — the build is real but thin: mostly SDK wiring with no contract of
its own, or a how-it's-made under ~900 chars, or the text admits the core is
simulated / mocked / unfinished. One clear deficiency is enough; do not demand two.

**6 and below** (6%) — the how-it's-made describes essentially no software the
team wrote: a static file served, one HTTP call, a plain CRUD app with no chain
logic, an explicit "I built this to learn X" / "vibe-coded" / "a lot of ChatGPT" /
"we are planning to build". **Bad writing is not a reason.** Buzzword prose, a
how-it's-made copy-pasted from the description, and unfamiliar proprietary jargon
all score normally — measured, "how duplicates description" has 0% precision for a
low score (n=2) and hedging phrases have 5% (n=42). No text feature predicts the
low tail with better than 20% precision, so when in doubt, do not go there.

**9** (12%) — **hard cap: at most one project in eight.** All three must hold:
- how-it's-made >= ~1800 chars (or comparably dense if shorter), **and**
- N >= 12, **and**
- at least one artifact is work an SDK cannot give you: a hand-written ZK circuit
  with its constraint tricks named, a custom VM opcode or bytecode encoder,
  device firmware, an EVM/interpreter written from scratch, a hand-implemented
  cryptographic primitive, real RF/embedded/hardware work, or a Uniswap v4 hook
  used as a novel data source.

A long, dense, five-integration app with many contracts is still an **8**. Breadth
of integration is not depth. This is the single most common replica error: a
replica that hands out 9 to a quarter of a batch is wrong about two-thirds of them.

#### Step 3 — practicality. Anchor 8, and stay there.

60% are 8, 34% are 7, and nothing else matters. **A replica's practicality 7s are
usually wrong** — across three blind holdouts, projects scored 7 by a replica had a
true mean of 7.33, 7.42 and 7.57. Write 8 unless the project is one of:

- a pure game, toy or joke (measured mean 7.31, n=26),
- an economy only agents inhabit, with no human user named,
- something the authors themselves call a prototype, experiment or concept demo,
- a core the text admits is simulated or mocked.

Even then, 7 — not 6. 6 is for a thing whose market is imaginary; 9 (0.7%) is for
real non-crypto users in a high-consequence domain. Do not use 5 or below unless
the project is barely a project.

#### Step 4 — originality. Anchor 7.

- **8** (38%) — the **mechanism** is outside the obvious sponsor-prompt template:
  a new primitive; an unusual physical/digital pairing (EMV bank-card signatures
  as wallet recovery, satellite ground stations, robot teleoperation as a labor
  market, onion futures, HRV as wallet auth); or a known problem attacked a
  genuinely different way (auction-managed AMM, one-way directional liquidity,
  factoring applied to withdrawal queues, LVR-net APR). An interesting *domain*
  wrapped around a standard mechanism is a 7. Calibration: a replica's 8s have run
  ~0.3 too generous every round, so when the case for 8 rests on the subject
  matter rather than the mechanism, write 7.
- **7** (47%) — DEFAULT. Competent, familiar category with a coherent twist.
- **6** (10%) — a clone of one of the twenty obvious ideas for this sponsor set,
  nothing distinguishing: another privacy wallet on the sponsor SDK, another
  notary, another agent reputation registry, another AI chat wallet, another
  NFT ticketing app.
- **<=5** (3.5%) — derivative or trivial: a tutorial project, a stated learning
  exercise, a habit tracker, a curated list.
- **9** — essentially never (0.7%).

#### Step 5 — batch sanity check (do this, it catches the systematic errors)

Before returning, tabulate your batch and compare to the base rates:

- technicality 9s > 15% of the batch → too many, demote the weakest back to 8;
- technicality <=7 > 25% → too harsh, revisit each and check the deficiency was
  really named in the text;
- practicality 7s > 40% → too harsh, promote the ones with a named real user;
- originality 8s > 40% → too generous, demote the ones whose novelty was domain
  rather than mechanism.

Tie-breaks: technicality 7 vs 8 → 8. Practicality 7 vs 8 → 8. Originality 7 vs 8 →
7. Technicality 8 vs 9 → 8 unless the full three-part test is met. Never output 10.

#### Output format

One line per project: `id O P T`

---

## Part 4 — the 1inch Aqua / SwapVM peer table

**MEASURED, but NOT blind-tested** (it spans all 602 including the replica's own
holdouts, so it was derived after seeing test data — use it as an anchor, not as
evidence of the prompt's accuracy).

`fit_calibration.py` recomputes this table into `calibration.json` under `peers`.
As measured there: 28 projects in the corpus mention Aqua or SwapVM
(mean T 8.54 / O 7.79 / P 7.50, sum 23.8, 50% won). The 20 that also mention a
custom opcode/instruction: mean T 8.70 / O 7.90 / P 7.50, sum 24.1, 55% won, with
technicality {7:1, 8:4, 9:15} against a 12% field-wide base rate for T=9.

**INFERRED, weak (n=15 in the original hand-coded subset).** Practicality splits on
framing. The opcode peers scoring P=8 lead with an *instrument or an outcome a
holder gets* ("On-Chain Fixed Funding Rate", "revolving credit that settles itself",
"sell on the way up, never re-buy"). The ones scoring P=7 lead with a
*market-making mechanism* ("Auction-Managed AMMs", "Inventory-healing MM",
"leveraged, oracle-anchored liquidity"). Superpose — covered calls on Aqua — scored
(8,7,8)=23; Smile — vol-surface MM on Aqua — scored (8,7,8)=23. Both won prizes anyway.
