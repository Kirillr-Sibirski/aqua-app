# score-submission

Predicts the three numbers ETHGlobal's automated assessment will attach to a project
(`autoTechnicality`, `autoOriginality`, `autoPracticality`), says where the implied
total sits in the measured win-rate bands, and prints **ranked, measured edits** with
a predicted point gain for each.

> ## READ THIS FIRST
>
> **This is a reverse-engineered approximation of a black box.** ETHGlobal has never
> documented the assessment, never published a rubric, and never shows a team its own
> score. Nothing here comes from ETHGlobal. Everything here was inferred from 602
> already-published scores by fitting models to them.
>
> **The model is weak in absolute terms.** Held-out 5-fold CV explains ~20% of
> technicality variance and ~9% of practicality variance. Its MAE beats "always guess
> the field mean" by 6-9%. That is a real edge, and it is a small one.
>
> **The biggest input to the real scorer is your repository, and this tool cannot see
> it.** See section 4 of any report, and "What the model cannot price" below.
>
> Use it to **rank two drafts of the same project against each other**. Do not report
> its integer as a forecast of the score you will get.

---

## Install

Nothing to install. `python3` 3.8+, stdlib only — no pandas, no numpy, no pip.

```
tools/score-submission/
  score_submission.py     the CLI
  subfeatures.py          feature extraction (ported from the study's features.py)
  calibration.json        every number the CLI uses, all measured on n=602  (50 KB)
  fit_calibration.py      regenerates calibration.json from the corpus
  rubric.md               the inferred rubric + the blind-tested replica prompt
  README.md               this file
```

## Use

```bash
python3 score_submission.py docs/submission-draft.md
python3 score_submission.py docs/submission-draft.md --repo .        # also measure the repo
python3 score_submission.py draft.json --json                        # machine-readable
python3 score_submission.py draft.md --brief                         # one line
python3 score_submission.py --rubric                                 # qualitative pass
python3 score_submission.py --self-test                              # verify calibration
```

### Input

Markdown with headings, optional front matter:

```markdown
---
has_repo: true
has_demo: false
has_video: true
---

## Tagline
...

## Description
...

## How it's made
...
```

Heading names are matched loosely (`How it's made`, `How It Was Made`,
`Technical description`, …). JSON works too:

```json
{"tagline": "...", "description": "...", "how_its_made": "...",
 "has_repo": true, "has_demo": false, "has_video": true}
```

Key aliases accepted: `howItsMade`, `hasRepo`, `hasDemoUrl`, `hasVideo`, `demo`,
`video`, `repo`. A URL string counts as `true`.

### Options

| flag | effect |
|---|---|
| `--json` | full machine-readable output including every extracted feature |
| `--brief` | one line: the three integers, the total, the band, the win rate |
| `--repo PATH` | also measure the git repo's shape and compare it to the measured buckets |
| `--event {auto,cannes,newyork,lisbon}` | event fixed effect. Default `auto` = corpus mean, the honest choice for an unknown future event. Lisbon scored +0.36 technicality over the rest of the field |
| `--rubric` | print `rubric.md` |
| `--self-test` | check the shipped `calibration.json` still reproduces the study's headline numbers |
| `--calibration PATH` | use a different calibration file |

---

## What is MEASURED and what is INFERRED

### Measured — the corpus

670 projects scraped from the public showcase of **cannes2026 / newyork2026 /
lisbon2026**, of which **602 carry auto scores**. The scores live in the Next.js RSC
payload of each showcase page under `project.meta`. Every number in `calibration.json`
is computed from those 602 rows by `fit_calibration.py`. There are no hand-written
constants in it.

Measured facts the tool reports, with their n:

- Observed range is **1-9 on every axis**. No project in 602 observations scored 10.
  Practicality reached 9 four times; originality four times; technicality 71 times.
- Distribution is compressed: technicality is 8 for 65.8% of the field, practicality
  is 7-or-8 for 94.2%, originality is 7-or-8 for 85.7%. 44.5% of all projects sum to
  exactly 23.
- Win rate by total: `<=17` 0% (n=14) · `18-20` 8.0% (n=50) · `21-23` 35.2% (n=401) ·
  `24-26` 46.0% (n=137). A floor, not a ladder.
- `how_its_made` length saturates hard. Measured points of technicality per +1000
  characters, within band: **+1.31** (0-1000, n=144), **+0.22** (1000-2000, n=244),
  **+0.00** (2000-3000, n=120), **-0.13** (5000+, n=27).
- Named technology count is the one text lever that keeps paying: 0-5 distinct →
  technicality 6.82 and P(9)=1.5% (n=66); 21+ → 8.45 and P(9)=48.4% (n=31).
- Readability, first person, exclamation marks and URLs are indistinguishable from
  zero (Spearman +0.010 for Flesch, +0.052 for words-per-sentence).
- Admitting incompleteness ("not yet", "mocked", "time constraints") measures **+0.20**
  technicality, n=176. Hedging about what the thing *is* ("aims to", "would allow")
  measures **-0.25**, n=86.

### Measured — the models

Two models are fitted, both z-scored ridge with λ chosen by 5-fold CV per target:

| model | features | source |
|---|---|---|
| `primary` | 26 | `MODEL_FEATS` from the study's `features.py` |
| `alloc` | 9 | the reparameterised budget-allocation model from the same script |

Held-out 5-fold CV on n=602 (`--self-test` re-checks these):

| target | primary MAE | alloc MAE | predict-the-mean MAE | primary R² | alloc R² |
|---|---|---|---|---|---|
| autoTechnicality | 0.570 | **0.550** | 0.610 | 0.196 | **0.223** |
| autoOriginality | **0.589** | 0.590 | 0.637 | **0.179** | 0.174 |
| autoPracticality | **0.528** | 0.532 | 0.583 | 0.092 | **0.109** |

The headline number is `primary`; `alloc` is printed as a cross-check and the report
warns when the two disagree by more than 0.40 on any axis.

Before predicting, every feature is clamped to the **observed [min, max]** of the
corpus, so the linear model is never evaluated outside the region it was fitted on.
Clamps that fire are reported. Predictions are clipped to [1, 9].

The `--brief` and report totals are the sum of the three **rounded** axes — what
ETHGlobal would actually publish — not the rounding of the continuous sum.

### Inferred

- **That the three fields correspond to the human judge scorecard.** ETHGlobal's
  judging bundle contains a `StarRating max:10` card with axes
  Technicality / Practicality / Originality / UI-UX-DX / WOW Factor. The names and the
  scale match exactly, and no competing explanation was found — but the AI values were
  never observed being shown to a judge.
- **That the scorer reads your repository.** Established by convergent evidence, not by
  observing the scorer: 12-16% of `autoSummary` strings name technologies absent from
  the entire write-up; low scorers get summaries describing repo contents; repo shape
  out-predicts every text feature. It is *not* known which repo artefacts it reads.
- **The peer-set framing effect** (that practicality 8 goes to write-ups leading with an
  instrument, 7 to write-ups leading with a market-making mechanism) rests on n=15 and
  is labelled weak everywhere it appears.
- **Everything in section 4 of the report about screening thresholds** — the numeric
  thresholds behind `tooFewCommits` etc. are server-side and were never observed.

---

## What the model cannot price

The single largest measured driver of technicality is not in this tool, because it is
not in your text. On a stratified sample of 122 repositories of scored projects:

| bucket | n | commits | root entries | root dirs | has contracts/ | has foundry.toml |
|---|---|---|---|---|---|---|
| technicality ≤7 | 39 | 41 | 12.6 | 4.4 | 31% | 3% |
| technicality =8 | 39 | 205 | 16.0 | 6.3 | 41% | 3% |
| technicality =9 | 44 | 207 | 20.6 | 9.1 | 59% | 16% |

Spearman vs technicality: commits **+0.533**, root dirs **+0.527**, root entries +0.408,
contracts dir +0.246, foundry +0.218, **hardhat -0.140**. The sample was deliberately
stratified 45/45/45, which inflates the magnitudes — read the ordering and the bucket
means, not the ρ values. Commit counts were also scraped months after the events, so
they are an upper bound.

`--repo PATH` measures your repo against those buckets and warns about the shapes that
fire ETHGlobal's own screener flags.

Also outside every model here:

- Round-1 human screening. Promotion to live judging is gated on
  `sum(videoQuality, submissionQuality, projectQuality) >= 10` — three human 1-10 stars.
- `checkProjectRepositoriesForGithubRules`, which shows a human screener
  `tooFewCommits` / `tooManyLinesChangedPerCommit` / `firstCommitTooOld` /
  `lastCommitTooRecent` / `tooManyCommitAuthors` / `isFork` per repository.
- The demo video. It is not a scorer input (only 2/602 summaries mention video) but it
  is the biggest **winning** lever measured: among long write-ups, 43% of projects with
  a video won versus 9% without (n=178 vs 22).

---

## Known limitations

1. **Observational, not causal.** Every point gain is a regression coefficient on 602
   self-selected submissions. Teams that write 4,000 careful characters also build more.
   Treat every number as an upper bound on what an edit actually buys.
2. **Weak absolute accuracy.** ~80% of technicality variance and ~91% of practicality
   variance is unexplained by the text.
3. **Practicality is unoptimisable.** 94% of the field scores exactly 7 or 8. Effort
   spent moving it is close to wasted.
4. **The technology vocabulary is hand-built** (~330 terms, DeFi/ZK/AI-weighted) and will
   undercount unusual stacks. It is the most load-bearing feature in the model, so that
   bias matters.
5. **Event fixed effects are real and unexplained.** Lisbon scored +0.36 technicality
   over the rest of the field (n=150, p=5e-05). Model or rubric drift across events is a
   plausible unmodelled confound, which is why `--event auto` is the default.
6. **The corpus is three events in 2026.** The feature went live between HackMoney 2026
   (0.5% coverage) and Cannes 2026 (89.8%). If ETHGlobal changes the model, everything
   here goes stale silently — there is no version string in the payload to detect it.
7. **The scores are computed once, at the cutoff, and never recomputed**, and a team
   cannot read its own. There is no iterate-and-resubmit loop. This tool is only useful
   *before* the deadline.

## Reproducing

```bash
python3 fit_calibration.py --corpus /path/to/corpus-irl2026.jsonl
python3 score_submission.py --self-test
```

The corpus is not shipped here (3.1 MB of scraped showcase payloads). The build
scripts that produced it, and the full measurement scripts this tool is a distillation
of, live in the study directory referenced at the top of `fit_calibration.py`.

## A note on shipping this in a submitted repo

The study that produced this tool also established that the assessor reads your
repository. A directory whose visible purpose is predicting the assessor's own output
is a thing a human screener may also read. If that is not the impression you want,
keep this tool out of the submitted tree.
