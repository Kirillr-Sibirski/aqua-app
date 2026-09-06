# ETHOnline 2026 — 1inch "Build an Aqua App" — Hackathon Rules Bible

Compiled 2026-09-05 ~22:40 CEST from ethglobal.com (raw HTML + embedded JSON payloads), the 1inch prize pages of four ETHGlobal events, ETHGlobal's rules/info pages, Kartik Talwar's Continuity-Track article, two 1inch workshop transcripts, and the ETHGlobal showcase pages of every project that applied for a 1inch prize at the last three events. Raw sources are on disk under `scratchpad/raw/` (paths at the end). Anything not directly quoted from a source is marked UNCERTAIN.

---

## 0. TL;DR (read this first)

| Item | Value |
|---|---|
| Event | **ETHOnline 2026** — ETHGlobal "Async Hackathon", event id 622, slug `ethonline2026` |
| Event timezone | `America/New_York` (EDT, UTC-4 during the event) — every ETHGlobal time below is EDT unless noted |
| Hacking began | **Fri Sep 4 2026, 12:00 pm EDT** (16:00 UTC / 18:00 CEST) |
| **SUBMISSION DEADLINE** | **Sunday, September 13 2026, 12:00 pm EDT = 16:00 UTC = 18:00 CEST** (JSON: `"submissionDeadline":"2026-09-13T16:00:00.000Z"`). "Late submissions won't be accepted." |
| Time remaining from Sat 2026-09-05 22:00 local | This machine's local tz is **CEST (UTC+2)** → 22:00 CEST = 20:00 UTC → **188 hours = 7 days 20 hours** to the deadline. (If your "local" is EDT instead: 22:00 EDT Sep 5 = 02:00 UTC Sep 6 → 182 h.) |
| Judging | Round 1 async starts Sun Sep 13 3:00 pm EDT; Round 2 live judging Mon Sep 14 12:00 pm EDT (120 min); Finale/closing Wed Sep 16 12:00 pm EDT (90 min keynote, Kartik Talwar) |
| 1inch prize pool | **$7,000 USDC total**: "Build an Aqua App" $5,000 (1st $2,500 / 2nd $1,500 / 3rd $1,000) + "Build an Aqua App – Continuity Track" $2,000 (1st $1,500 / 2nd $500; Continuity-Track registrants only) |
| Event prize pool | **$80,000 across 11 sponsors** (sum of per-sponsor `totalPrizeAmount` in the event JSON: The Graph 15k, Hedera 15k, Arc 10k, World 7k, 1inch 7k, ENS 5k, Uniswap Foundation 5k, Ledger 5k, Privy 5k, Chainlink 3k, Bazantic 3k). A WebFetch summary said "$86,000" — UNVERIFIED, the JSON sums to $80,000. |
| Hard 1inch requirements | (1) official Aqua/SwapVM contracts (modified SwapVM redeploy OK); (2) **on-chain token transfers executed in the final demo (local fork OK)**; (3) proper git history — "no single-commit entries on the final day" |
| Scoring tilt | "**Projects that utilize SwapVM will be scored higher during the final judging.**" |
| Deliverables | Hacker-dashboard form (title, description, repo link, "how it's made", partner-prize selections with per-prize explanation + feedback), **demo video 2–4 min, ≥720p, real voice (no TTS), no phone recording, no speed-up**; open-source repo with full commit history; pick **up to 3 partner prizes** |
| Team size | up to 5; each member applies + stakes individually |

---

## 1. Event facts (ETHOnline 2026)

Source: embedded JSON in `https://ethglobal.com/events/ethonline2026` (`raw/root.html`) and `/events/ethonline2026/prizes/1inch` (`raw/root_prizes_1inch.html`), plus `/events/ethonline2026/info/details` and `/info/start`.

Event-level JSON fields (verbatim):

```json
"startTime":"2026-09-04T05:00:00.000Z",
"endTime":"2026-09-16T05:00:00.000Z",
"signupDeadline":"2026-09-06T17:00:00.000Z",
"submissionDeadline":"2026-09-13T16:00:00.000Z",
"judgingStartTime":"2026-09-14T16:00:00.000Z",
"enableHackerApplications":false,
"autoAcceptPreviousHackers":true,
"timezone":{"id":83,"name":"America/New_York","offset":"-05:00"}
```

Notes:
- The events listing shows "September 4–16, Fri — Wed, ETHOnline 2026, Async Hackathon".
- `signupDeadline` = Sun Sep 6 2026 1:00 pm EDT (19:00 CEST), but the published schedule item "Deadline to Apply" was **Thu Sep 3 11:59 pm EDT** and the JSON says `enableHackerApplications:false`. UNCERTAIN whether new applications are still accepted; if any teammate is not yet accepted + staked, check the Hacker Dashboard (`https://ethglobal.com/events/ethonline2026/home`) immediately — `autoAcceptPreviousHackers:true` means past ETHGlobal hackers are auto-accepted.
- Staking: "To participate in the hackathon, you'll need to stake a small amount of ... ETH ... your stake will be returned to you when you submit a project!" (returned ~3 weeks after; "Partial or incomplete hacks are still eligible for stake being returned.")

### 1.1 Full published schedule (all 24 items that were published; times converted)

| EDT | CEST | Len | Type | Item | Speaker / link |
|---|---|---|---|---|---|
| Thu Sep 3 11:59 pm | Fri Sep 4 05:59 | — | notification | Deadline to Apply | |
| Fri Sep 4 12:00 pm | 18:00 | — | notification | **Hacking Begins!** | |
| Mon Sep 7 10:00 am | 16:00 | 30m | workshop | Ledger Tracks Explained | Etienne Waldron, Oscar Chaix (Ledger) — https://youtube.com/live/a06GK98Fmqw |
| Mon Sep 7 11:59 pm | Tue 05:59 | — | notification | **Project Check-in #1 Due** | via Hacker Dashboard |
| Tue Sep 8 9:00 am | 15:00 | 30m | workshop | Build for the Agentic Economy With USDC on Arc | Blessing Adesiji (Circle) — https://youtube.com/live/-RLhOI4Ycr0 |
| Tue Sep 8 10:00 am | 16:00 | 30m | workshop | Confidential Workflows | Solange Gueiros (Chainlink Labs) — https://youtube.com/live/sa4mInWn5YY |
| Tue Sep 8 2:00 pm | 20:00 | 120m | workshop | Project Feedback Session #1 | Pascal Rüger (ETHGlobal Hacker Success) |
| Tue Sep 8 3:30 pm | 21:30 | 30m | workshop | Build and Use Agentic Recipes with Bazantic | Tom Hay — https://youtube.com/live/MoF7FuwWeas |
| Thu Sep 10 9:00 am | 15:00 | 120m | workshop | Project Feedback Session #2 | Pascal Rüger |
| Thu Sep 10 11:59 pm | Fri 05:59 | — | notification | **Project Check-in #2 Due** | |
| **Sun Sep 13 12:00 pm** | **18:00** | — | notification | **Project Submissions Due!** | |
| Sun Sep 13 3:00 pm | 21:00 | — | notification | Judging Round 1: Asynchronous Project Judging | |
| Mon Sep 14 12:00 pm | 18:00 | 120m | notification | Judging Round 2: Live Project Judging | |
| Wed Sep 16 12:00 pm | 18:00 | 90m | keynote | ETHOnline 2026 Finale | Kartik Talwar (ETHGlobal) |

**There is NO 1inch workshop or office-hours item in the published schedule** (the 1inch prize JSON has `"schedule":null` and `"workshopLink":null`). However **Tanner Moore (1inch, @tanz0rz) is listed in the event's `people` array with a non-empty `speakers` entry**, so a 1inch session may exist but be unpublished — UNCERTAIN; re-check `https://ethglobal.com/events/ethonline2026#schedule`. Other sponsor speakers listed: Austin Griffith (EF), Luke Forrest (Hedera), Angela Ocando (Uniswap), Kevin Krone (ENS), Mateo Sauton (World). People flagged as **judges** in the JSON: Emilio Silva (Independent, @abcdemilio), Karim Halabi (NGMI Labs, @0xkarim) — these are ETHGlobal finalist-round judges; **partner prizes are judged by the partner (1inch) asynchronously.**

### 1.2 Check-ins and feedback sessions
- "Check-ins are in place to help track your progress ... your Hacker Dashboard will notify you when it's time to check in ... Following your check-in, our team, along with partners, may reach out with additional support or guidance." Two check-ins due: Sep 7 and Sep 10, 11:59 pm EDT.
- Feedback sessions (Sep 8, Sep 10): "share your progress—whether it's a demo, Figma designs, slide decks, or just your ideas. Mentors and partners will give you constructive feedback".
- Mentors: Discord `#mentorship-help`; teams: `#find-a-team`. Discord: https://ethglobal.com/discord (all official comms happen there).

---

## 2. The 1inch prizes — verbatim

Source: `https://ethglobal.com/events/ethonline2026/prizes/1inch` (raw + JSON). Sponsor id 12571, slug `1inch`, `totalPrizeAmount: 7000`, package "Core". Prize token: USDC (`"token":{"id":2,"name":"USD Coin","symbol":"USDC"}`).

**About (verbatim):** "1inch is a network of decentralized protocols that focus on unifying DeFi liquidity. Most known for our DEX aggregator launched in 2019, we have continued to improve and ship protocols, maintaining our position as one of the premiere players in the token swapping space. Our most recent release, Aqua, reimagines how DEXes are designed by introducing self-custodial liquidity provisioning. This allows users to earn yield on their tokens without depositing them into another contract."

### 2.1 💧 Build an Aqua App — $5,000  (prize id 2898, slug `build-an-aqua-app`, type `tier`, category `building-from-scratch`)
- 🥇 1st place $2,500 · 🥈 2nd place $1,500 · 🥉 3rd place $1,000 (one winner each, `quantity:1`)

**Description (verbatim):**
> Create a custom Aqua app that implements a sophisticated DeFi position. If you use SwapVM, you may modify SwapVM opcodes and define your own instructions. The final positions must be demonstrated through tests scripts or a UI.
>
> Projects that utilize SwapVM will be scored higher during the final judging.

**Qualification Requirements (verbatim):**
> - Official Aqua/SwapVM contracts must be used (redeployments of a modified SwapVM contract is allowed)
> - Onchain execution of token transfers should be presented during the final demo (local forks are ok)
> - Proper Git commit history (no single-commit entries on the final day)

**Links and Resources (on the prize):**
- SwapVM Smart Contracts — https://github.com/1inch/swap-vm/tree/main
- Aqua Smart Contracts — https://github.com/1inch/aqua
- Aqua SDK — https://github.com/1inch/sdks/tree/master/typescript/aqua

### 2.2 💦 Build an Aqua App – Continuity Track — $2,000  (prize id 2899, slug `build-an-aqua-app-continuity-track`, category `continuity-track`)
- 🥇 1st place $1,500 · 🥈 2nd place $500
- Banner: "🆕 This prize is only available to Continuity Track participants →" (links to https://x.com/ETHGlobal/status/2056399209767866682)
- Description and Qualification Requirements are **identical** to 2.1 (same three bullets, same "scored higher" sentence). Same three resource links.

### 2.3 Sponsor-level resources on the 1inch page
- SwapVM Whitepaper — https://github.com/1inch/swap-vm/blob/release/1.1/docs/whitepaper-swap-vm-1.0.pdf
- Aqua Whitepaper — https://github.com/1inch/aqua/blob/main/docs/whitepaper-aqua-1.0.pdf
- Jobs: "Software Engineer Blockchain / Web3" (1inch talent pool) — https://jobs.lever.co/1inch/266dfaec-9e81-452a-be11-54e927af7ce1
- Sponsor links: https://1inch.com/ , https://x.com/1inch

### 2.4 How the same prize was worded at earlier 2026 events (useful signal)
- **ETHGlobal New York 2026 (Jun 12–14)** — "Build an Aqua App ⸺ $7,000" (1st $2,500 / 2nd $2,000 / 3rd $1,500 / 4th $1,000). Description added: "**Examples: Leverage · AMM · Lending · Options**". Qualification then lacked the "official contracts" bullet. Extra resources listed there: Anton Bukov's workshop video, **SwapVM Template https://github.com/1inch/swap-vm-template** (public, default branch `main`, last push 2026-07-24), and Tanner Moore's slides https://docs.google.com/presentation/d/1qA9l8lMKBG-Jd9-wVgmM7jOLE8hxaB0e . Workshop: "Reimagining the AMM with 1inch Aqua" (Fri Jun 12 6:00 pm EDT) — video https://www.youtube.com/watch?v=VrtWeUR3Vq4 .
- **ETHGlobal Lisbon 2026 (Jul 24–26)** — identical $5,000 + $2,000 Continuity structure and identical text to ETHOnline. Workshop "Reimagining the AMM with 1inch Aqua" (Fri Jul 24 5:30 pm WEST): "Explore how 1inch Aqua rethinks liquidity by letting one self-custodial balance support multiple on-chain strategie…".
- **ETHGlobal Buenos Aires (Nov 21–23 2025)** — 1inch pool $20,000: "Build an Aqua App ⸺ $17,000" (1st $7,000 / 2nd $3,000 / 2nd $2,000 ×2 / 4th $1,000 ×3) with text "Create a custom Aqua app **based on SwapVM** ... Examples: Leverage, AMM, Lending, Options" and requirement "SwapVM is used to power Aqua app"; plus "Utilize 1inch APIs ⸺ $3,000". Resource: "1inch Hackathon Guide" https://hackathon.1inch.community — **today this URL 302-redirects to https://ethglobal.com/events/tokyo2026/prizes/1inch** (ETHGlobal Tokyo, Sep 25–27 2026, same $5k+$2k Aqua prizes, same text).
- Takeaway: the prize text has been stable for 3 events; SwapVM went from mandatory (BA) to "scored higher" (NY/Lisbon/Online); 1inch's own example list of "sophisticated DeFi positions" is **Leverage, AMM, Lending, Options**.

---

## 3. Submission requirements (ETHGlobal, ETHOnline 2026)

Source: `https://ethglobal.com/events/ethonline2026/info/details` ("Rules, project submission & judging") and `/info/start`.

**Key Information (verbatim):**
> 📅 Submission Deadline: All projects must be submitted by Sunday, September 13th 2026 at 12:00 pm EDT. Late submissions won't be accepted, so be sure to plan ahead!
> 🔗 How to Submit: Head over to your Hacker Dashboard to submit your project. You'll fill out the form with essential details like your project title, description, and a link to your repository.
> 🎥 Demo Video: You are required to submit a 2-4 minute demo video showcasing your project. This video will be featured on the ETHGlobal Showcase, so take your time making it clear and informative.
> 💰 Partner Prizes: On the last step of the submission form, you can select up to 3 Partner Prizes to apply for. If a partner has multiple tracks, you can be eligible for all of them while only counting as 1 Partner Prize. Please ensure to select these prizes carefully as it is the only way for partners to assess your project.

**Two submission modes (verbatim):**
> 1. Finalist and Partner Prizes — Opting for this will require you to present your project to judges in the Finalist judging session. Partners will be judging your project asynchronously. There is no action required from you here.
> 2. Partner Prizes Only — You can select up to 3 Partner Prizes during submission. For each partner prize, you'll need to explain how you've used or integrated their tools, provide feedback, and share relevant comments. Partners will be judging your project asynchronously.

**Showcase page fields observed on past projects** (what the form produces): title, tagline (~100 chars), "Project Description", "How it's Made", Live Demo link, Source Code link, demo video, selected prizes. ETHGlobal auto-generates `autoSummary`, `autoOriginality/autoPracticality/autoTechnicality` scores (0–10) in the project JSON — i.e. an automated first read of your description exists; write the description for that reader too.

**Important Rules (verbatim):**
> Start Fresh (Classic Track): If you're entering the Classic "From Scratch" track, all work on your project must begin after the hackathon officially starts. Any prior project-specific code, designs, or assets are not allowed unless they're from public libraries or starter kits. Projects built before the event may still participate but won't qualify for partner prizes or the Finalist category.
> Continuity Tracks (Extend Open Source / Ship a Feature): If you've selected a Continuity track, you may build on an existing codebase according to that track's rules. Continuity submissions must clearly document pre-existing work and include new features or functionality developed during the hackathon; eligibility for partner prizes may vary by event and partner.
> Version Control: Use version control to track your code during the event. Submissions with large single commits or missing histories may be disqualified, as it's important to show your progress throughout the hackathon.
> Open Source Libraries & Boilerplates: You're welcome to use open-source libraries and starter kits to kickstart your project, but be transparent.
> Include Everything: Your submission should include a GitHub Repo, Figma files, or equivalent, proving the work was done during the hackathon. Clearly distinguish between what's new and what's reused.

**Use of AI Tools (verbatim — directly relevant to us):**
> The use of AI tools (e.g., ChatGPT, Claude Code, GitHub Copilot, Cursor, etc.) is generally permitted, but with the following guidelines to ensure transparency and integrity:
> Attribution: Clearly document in your submission where and how AI tools were used in the project. This includes specifying which parts of the code, specific files, or assets were generated or assisted by AI.
> Involvement: AI tools should be used to assist your development process, not to create the entire project. Submissions that rely entirely on AI without meaningful contributions from team members may not be eligible for partner prizes or finalist consideration.
> Spec-Driven Development: Using spec-driven workflows (e.g., OpenSpec, Kiro, spec-kit) is permitted. If you use one, you must include all spec files, prompts, and planning artifacts in your submission repository. Judges need to see the full picture of how you directed the AI, not just the generated output.

**Demo video rules (verbatim):**
> Must be between 2 and 4 minutes: Videos under 2 minutes or over 4 minutes will be automatically rejected during upload.
> Don't rush ... Avoid background noise and echo ... Keep introductions short: You don't need to spend more than 20 seconds on your backstory. Show your project in action and skip any unnecessary waiting ... Use slides to summarize key points: no more than 4 bullet points per slide.
> 🚨 DO NOT export the video in any resolution less than 720p (Upload will fail if the video is less than 720p)
> 🚨 DO NOT exceed the 4-minute submission length (Upload will fail if the video is over 4 minutes)
> 🚨 DO NOT speed up the video to fit under the time limit
> 🚨 DO NOT play music with text on the video describing your project (instead of talking)
> 🚨 DO NOT use mobile phones to record the video submission
> 🚨 DO NOT use a text to speech synthesizer / AI Voiceover

Open-source: ETHGlobal requires a repo "proving the work was done during the hackathon"; Continuity rules say "All new parts of extending an existing project must remain open source." 1inch's prize text does not state a license requirement, but the repo must be inspectable (git history is a qualification bullet). Several other sponsors explicitly require a public GitHub repo.

---

## 4. Judging process

**Criteria (verbatim, ETHGlobal finalist judging — partners are free to weigh differently):**
> Technicality: How complex is the problem you're addressing, and how sophisticated is your solution?
> Originality: Is your project introducing a new idea or creatively solving an existing problem?
> Practicality: How complete and functional is your project? Could it be used by its target audience today?
> Usability (UI/UX/DX): How intuitive is your project? Have you made it easy for users to interact with your solution?
> WOW Factor: Does your project leave a lasting impression? ...

**Async-event specifics (verbatim):**
> For most async events, there are two rounds of judging. The first round is asynchronous, and the second round is live judging at the event. The judging criteria for both rounds is the same and the first round of async judging is used to screen projects. Typically, only the top 20% of projects advance to the live judging session.
> The first round of judging has no impact on your project's eligibility for partner prizes and partners do not have access to the results of the first round of judging. At most async events, the majority of prizes are paid out to projects that do not advance to the live judging.

**Live (finalist) session:** "Each team has 7 minutes to present: 4 minutes for the demo, followed by 3 minutes for Q&A with the judges." Prepare: "What inspired your project? What tools did you use, and why? What challenges did you solve, and how?" (Past Lisbon project JSON shows a 420 s timer: ~244 s demo + Q&A.)

**Partner (1inch) judging:** asynchronous, from the submission page + video + repo. 1inch wording "scored higher during the **final** judging" and "presented during the **final demo**" implies the demo video (and possibly a follow-up call) is where on-chain transfers must be visible. UNCERTAIN whether 1inch holds live partner-judging calls at async events; plan for the video to be self-sufficient: show the tx hashes / fork logs of token transfers through the Aqua router.

"Focus on Quality: When it comes to judging, only the work you complete during the hackathon will be evaluated."

---

## 5. General rules that bind us

Source: https://ethglobal.com/rules ("Rules & Code of Conduct") + info pages + Continuity Track announcement.

- **Team size:** "Teams can have up to 5 people." Applications are individual; each member must be accepted and stake.
- **Pre-existing work (verbatim):** "If you're participating in the Classic 'From Scratch' track, you must begin your project when hacking officially begins at event kick-off. Pre-existing project-specific code, designs, or assets are not allowed for Classic track submissions. ... In all cases, you must disclose any pre-existing work in writing to the ETHGlobal team and include full details in your submission (repo history, video, and description). If, upon inspection (during or after the event), a submission contains undisclosed pre-existing work or materially misrepresents what was built during the hackathon, the project may be disqualified, prizes revoked, and the team may be banned from future events."
- "Any repositories with single commits of large files without proper history will be default assumed to be unqualified unless proven otherwise."
- "Historically, projects that use a majority of pre-existing work do not score as high in the judging as projects which present wholly new and novel approaches - the goal of our hackathons is to create interesting experiments."
- **What counts as "built during the hackathon":** commits after Fri Sep 4 12:00 pm EDT; public libraries, starter kits and boilerplates are allowed if disclosed ("be transparent", "Clearly distinguish between what's new and what's reused"). Using 1inch's official repos / `swap-vm-template` / SDK as dependencies is explicitly the intended path.
- **IP:** "You (and your team) will own any developments made by you during The Event".
- **Continuity Track** (opt-in at application time; "This track is opt-in so applying ahead of time and notifying us is required"): three paths — "01 — From Scratch ... 02 — Extend Open Source. Bring an open source repository you already maintain ... 03 — Ship a Feature. Take an existing private product and build one new feature on top of it, in the open. Whatever you ship across the weekend is released as open source." (Kartik Talwar, X article 2056258666123415552, May 18 2026). ETHGlobal tweet: "We've got 3 ways to hack at ETHGlobal events: ↪︎ [classic] start from scratch ↪︎ [new] extend an open source repo ↪︎ [new] ship a new feature to an existing product". **If we did not register as Continuity, we are Classic/From-Scratch and eligible only for the $5,000 prize, not the $2,000 Continuity prize** (and a From-Scratch project competing against Continuity entries is not possible the other way either — prize `category` fields are `building-from-scratch` vs `continuity-track`). UNCERTAIN which track our team registered under — check the dashboard.
- Code of conduct: standard anti-harassment; violations → expulsion.

---

## 6. 1inch-provided resources and what 1inch engineers emphasized

### 6.1 Official links (from the ETHOnline / NY / Lisbon / BA prize pages)
| Resource | URL |
|---|---|
| SwapVM contracts | https://github.com/1inch/swap-vm/tree/main (whitepaper on branch `release/1.1`) |
| Aqua contracts | https://github.com/1inch/aqua (docs dir: https://github.com/1inch/aqua/tree/main/docs) |
| Aqua TypeScript SDK | https://github.com/1inch/sdks/tree/master/typescript/aqua |
| SwapVM template repo | https://github.com/1inch/swap-vm-template (listed at NY 2026) |
| Aqua app template | "1inch aqua-app-template" — cited by BA 2nd-place winner aqua-flash-loans ("I have used the 1inch aqua-app-template in order to speed up the development"); exact URL UNCERTAIN (likely https://github.com/1inch/aqua-app-template) |
| SwapVM whitepaper 1.0 | https://github.com/1inch/swap-vm/blob/release/1.1/docs/whitepaper-swap-vm-1.0.pdf |
| Aqua whitepaper 1.0 | https://github.com/1inch/aqua/blob/main/docs/whitepaper-aqua-1.0.pdf |
| Workshop video — Anton Bukov, "The Art of AMM" (1inch co-founder; BA Nov 21 2025; uploaded 2025-11-18 on 1inch's channel) | https://www.youtube.com/watch?v=bdhba23BEzg (transcript: `raw/transcript_bdhba23BEzg.txt`) |
| Workshop video — Tanner Moore, "Reimagining the AMM with 1inch Aqua" (NY Jun 12 2026, ETHGlobal channel) | https://www.youtube.com/watch?v=VrtWeUR3Vq4 (transcript: `raw/transcript_VrtWeUR3Vq4.txt`; slides text: `raw/slides.txt`) |
| Tanner's slides | https://docs.google.com/presentation/d/1qA9l8lMKBG-Jd9-wVgmM7jOLE8hxaB0e |
| Deployed contracts (from task context, not from ETHGlobal pages) | Aqua registry `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a`; SwapVM router `0x111111338c5091e8440b67b168bae16a668ac0de` on Ethereum, Base, Arbitrum, Optimism, Polygon, … |
| 1inch contact at ETHGlobal events | Tanner Moore, Technical Account Manager, 1inch — X @tanz0rz (listed as ETHOnline 2026 speaker). Support during the event: ETHGlobal Discord partner channel (exact channel name UNCERTAIN — look for a `#1inch` channel under the ETHOnline category) |
| Old hackathon guide | https://hackathon.1inch.community → now redirects to the Tokyo 2026 1inch prize page |

### 6.2 What 1inch emphasized — Anton Bukov, "The Art of AMM" (Nov 2025)
- Motivation: ~"90%" of liquidity in the largest pools sits idle ("in Uniswap v2 most of the days 85% of USDC or ETH ... was not moving; it was defining the price but not utilized"); LP capital is fragmented across pairs and "DeFi-disabled" once locked in a pool.
- Aqua model: "all the capital sits in LP wallet and AMMs get access to this capital on demand ... Aqua smart contract is a settlement layer to provide shared liquidity access ... AMMs use API called **pull and push**. When assets are pulled, balances decrease; when pushed, balances increase. Swap turns into pull/push."
- Aqua storage: "records for each maker, for each application, for each strategy hash, for each token: what is the balance. Maker just puts some balances for some strategies." No registration needed beyond setting balances for an app.
- **Design rule for apps:** "Do not interact with tokens directly. Do not use transferFrom. Just ask for balances and use pull/push." and "An AMM should define price based on **virtual balances** without taking into account real balances or allowances ... because this would be a huge surface for attacks. Just rely on those balances." Insufficient real balance → taker's tx reverts; that is the taker's problem to detect.
- **Leveraged / borrowed liquidity:** LPs can put 1k as 3k collateral + 2k debt in a money market and run AMM strategies on aTokens; also borrow-on-demand (BlackHoleSwap-style) is possible via smart wallet/7702. Caveat: "AMMs should support ability to push first and pull second" — SwapVM has a taker flag "**isTransferFromTakerFirst**" for this. Shared + unlocked liquidity → "3x capital efficiency ... times 2x through shared liquidity".
- "Ill-liquidity": a strategy whose balance hits zero just stops serving swaps; refilling later can be instantly arbitraged ("instant impermanent loss") — recommended to close/dock positions when illiquid.
- **SwapVM architecture:** "instructions which can be combined ... LP selects which instructions and configures them: custom flat fees, dynamic fees, swap formula, concentration, decay spread (Mooniswap-style arbitrage-decay, 'sells arbitrage opportunity after trade')". Data model = four registers: **balanceIn, balanceOut, amountIn, amountOut**; taker supplies one amount, instructions compute the missing one. Examples: constant-product instruction (computes amountOut if 0, else amountIn); concentration instruction "placed before swap instruction ... just increases balances by deltas" (`XYConcentrateGrowPriceRange` vs `XYConcentrateGrowLiquidity`); decay instruction (virtual balances decay from old to new, Mooniswap analysis: arb profits ÷10, LP earnings ×2).
- **Why build on SwapVM:** "you can avoid ... deposits, withdrawals, balances accounting for LPs, swap settlement ... and auditing all this code. You could just make your own instructions which can be combined ... instruction-level composability." Fees should be optimized by LPs (not 0.05/0.3/1% only); "capital efficiency is no more a protocol metric. It's a measure of LP effort and risk appetite."
- Answers to audience: single-sided liquidity works (one balance zero); no pools ("personal AMMs running on top of your balances"); permissionless — an untrusted app "could just pull everything and run away", SwapVM is 1inch's "predictable" configurable app; LP can be a contract (PMM accounting use case); "Aqua is not compatible with existing DEXes because they have to use Aqua ... almost any existing AMM could be rewritten to use Aqua".

### 6.3 What 1inch emphasized — Tanner Moore, "Reimagining the AMM with 1inch Aqua" (Jun 2026, NY)
- Architecture in three parts: **Aqua Router** ("~80-line smart contract" responsible for LP registrations, balances, swap settlement — approvals/permits), **Aqua Apps** (swap logic: constant product, concentrated liquidity, stableswap), **Strategies** ("LP commitments to Aqua apps ... not a contract, the accounting of: this LP wants to use this strategy, e.g. constant product WETH/USDC 1 ETH/1500 USDC").
- Flow: LP approves/permits router → `aqua.ship(...)` with strategy data → state stored + **emitted as a log** for indexers ("we are obviously going to run our own indexers, but ... somebody else can run their own") → taker reads indexer, quotes the app, sends tokens → app verifies commitments on the router → router pulls/pushes from the LP wallet. Same LP balance can back multiple strategies simultaneously ("$4,000 actual, $6,000 effective"); concurrent large trades on the same LP in one block → later one reverts.
- Virtual balances are independent of physical wallet balance; a pull simply fails if funds aren't there.
- **SwapVM** = "building block functions for swaps: price curve, taker restrictions (e.g. NFT whitelisting), fees (e.g. 25 bps), decay function ... building blocks are opcodes under the hood ... you can call external contracts (oracles) ... **you can write custom opcodes — asterisk: you need to redeploy the SwapVM app** ... **we encourage people to do that at hackathons because we're trying to see what the boundaries that can be pushed are. So we encourage people to redeploy and break things and try to push the system as far as it can go.**" It "does actually have a program counter. You can do jump instructions."
- **Beyond AMMs:** "in previous hackathons ... people had created prediction markets, they created privacy pools, they created flash loans because at the end of the day you just need to follow the rules of the Aqua ecosystem ... a lot of these designs were and can be developed using SwapVM." Flash-loan flow described: app pulls USDC from LP via router, executes payload, repays + LP fee.
- Bounties (NY): "$5,000 split across the top three ... extending any existing app ... $2,000 split across two teams". For custom-opcode examples he pointed to previous hackathon repos plus the SwapVM repo. Open question he couldn't answer on stage: whether the LP must be an EOA (his guess: contracts work too — Anton confirmed contracts/PMMs work).
- Slides' closing framing: "For LPs: higher utilization / better yields. For DeFi users: better prices. For builders: fast path to production / users."

### 6.4 Implicit judging heuristics distilled from the above and the prize text
1. Use the **official** Aqua router (do not fork Aqua); build a SwapVM-based app, ideally with **new custom opcodes** and a redeployed modified SwapVM — this is exactly what 1inch says it wants and every 1st-place winner did.
2. The "position" must be **sophisticated** (their examples: leverage, AMM, lending, options; past winners: auction-managed fees, one-way ladders, funding-rate swaps, pm-AMM prediction markets, flash loans, privacy vaults, oracle-anchored leverage).
3. **Demonstrate real token movement** through the router on a fork (mainnet-fork with real WETH/USDC and real oracles was used by winners) — tests/scripts or UI; show tx traces in the video.
4. Respect Aqua's design rules: price off virtual balances, pull/push only, handle push-first for leveraged inventory, dock illiquid strategies.
5. Continuous commits from day 1; document AI usage.

---

## 7. Past 1inch "Build an Aqua App" winners (what actually won)

Source: showcase pages filtered with `?events=<slug>&partners=1inch` and each project's JSON `prizes` array (`raw/winners/`).

### ETHGlobal Buenos Aires, Nov 2025 ($17k Aqua prize, SwapVM mandatory)
| Place | Project | Tagline / what it was | Repo |
|---|---|---|---|
| 1st ($7k) | **Aqua Outcome Market** | pm-AMM (Moallemi/Robinson "Uniform AMM for Prediction Markets", Gaussian score dynamics) as a SwapVM instruction; LP across outcome markets; uses SwapVM hooks | https://github.com/yielddev/AquaOutcomeMarket |
| 2nd | **aqua-flash-loans** | gas-optimized flash loans on Aqua for long-tail tokens; built from 1inch aqua-app-template, Hardhat v3 | https://github.com/otonashi-labs/aqua-flash-simple |
| 2nd | **Cleverly Using Money** | zk (Noir) private vault whose anonymous LP funds are routed into Aqua strategies | https://github.com/mcmoodoo/simple-cum |
| 2nd | **Coco** | non-custodial "savings account" UI routing to curated Aqua strategies (also Circle 2nd) | https://github.com/eth-ba/coco |
| 4th | **1Wave** | basket-asset vaults (Factor SDK) with oracle-driven rebalancing of Aqua virtual liquidity to neutralize IL | https://github.com/wave-vault/contracts |
| 4th | **Aqua0** | cross-chain shared liquidity: custom Aqua apps (StableSwap) on Base + WorldChain (self-deployed Aqua) + LayerZero; also BA Finalist | https://github.com/jackmielke/Aqua0 |
| 4th | **ProaqctiveMM** | proactive market maker (DODO-style) on Aqua + SwapVM + Pyth oracle | https://github.com/505labs/ProAqtive |

### ETHGlobal New York, Jun 2026 ($7k Aqua prize)
| Place | Project | What it was | Repo |
|---|---|---|---|
| 1st ($2.5k) | **RiverSwap** | "am-AMM" auction-managed AMM (LVR mitigation): custom SwapVM opcode `_aquaAccountedDynamicFeeAmountInXD` implementing a fee auction + Tycho indexer reconstructing a pool from distributed orders | https://github.com/matcha-bros/river-swap |
| 2nd ($2k) | **Lotus** | one-way directional liquidity ("sell on the way up, never re-buy"): `LotusSwapVMRouter is SwapVM` with three custom opcodes (ONEWAY_FILL…), monotonic invariant, no keeper/oracle; also Uniswap API 1st | https://github.com/Lotusfi/Lotus_main |
| 3rd ($1.5k) | **TenorFi** | fixed-for-floating funding-rate swaps for perps (Hyperliquid) — custom `_fundingSettle` SwapVM opcode doing hourly just-in-time premium pulls from the user's wallet; deployed on Base mainnet | https://github.com/0xYudhishthra/TenorFi |
| 4th ($1k) | **Ballast** | leveraged + Chainlink-oracle-anchored liquidity: two custom opcodes (Leverage, Oracle anchor), demoed on a **forked Ethereum mainnet with real WETH/USDC and real Chainlink feed**, 17 Foundry tests | https://github.com/mcmoodoo/Ballast |

### ETHGlobal Lisbon, Jul 2026 ($5k + $2k Continuity — same prize as ETHOnline)
| Place | Project | What it was | Repo |
|---|---|---|---|
| 1st ($2.5k) | **ArcBook** | "functional order book" where each maker position is an executable pricing curve (start/end price, alpha) compiled into SwapVM state; custom SwapVM instruction for exact-in/out fills that recycles inventory to the opposite side; official Aqua as settlement; Graph subgraph + solver + MCP; Base Sepolia; Foundry fuzz + Python reference model. Also Lisbon Finalist + Graph 2nd | https://github.com/Ryad2/liquid_OB |
| 2nd ($1.5k) | **Votive** | "wishing well": fund a plain-language wish; AI agent executes when capable; state-machine protocol on Base Sepolia (Aqua usage details thin on page) | https://github.com/resistingdestiny/wishing-well-votive |
| 3rd ($1k) | **KSwap-VM** | formal semantics of SwapVM in K + Kontrol/KEVM proofs of instructions (found real bugs → bug reports) + a verified "sweeper" Aqua app | https://github.com/vovunku/swap-vm-verified |
| Continuity 1st ($1.5k) | **Pool Party** | USDC neobank (existing product) adding Aqua-based yield strategies; also Uniswap 1st | https://github.com/PoolPartyLabs/pool-party-v2-frontend |
| Continuity 2nd ($500) | **Agora Markets** | futarchy governance with conditional-token markets (Uniswap CCA + Aqua) | https://github.com/0xbri3t/Agora |

Strong Lisbon entries that did **not** place (competition benchmark): Aquapilot (NL→SwapVM bytecode composer + validator), Sluice (NL→Aqua strategies in 0G TEE), QilinSwap (visual desk → SwapVM bytecode), Doca Finance (InventorySkewProvider behind SwapVM's dynamic-fee opcode + keeper that docks/re-ships), bebecita (order book funded by a Uniswap v4 position, custom opcode 0x92 + maker hooks preTransferOut/postTransferIn), SeaLevel (stablecoin AMM), Baywatch (toxic-flow signal), Aqua Prime, ScubaSwap, Vortex, signalflo, Superpose. Pattern: **UI-only / tooling-only Aqua projects lost to projects with a novel on-chain mechanism implemented as custom SwapVM instructions and proven with tests on a fork.**

---

## 8. Other ETHOnline 2026 prizes that an Aqua project could stack (max 3 partner prizes; a partner with multiple tracks counts once)

Full list is in `raw/root_prizes.html`; the ones plausibly compatible with an Aqua/SwapVM DeFi position:
- **Uniswap Foundation — 🦄 Best Uniswap Stack Contribution, $3,000 (from scratch) / $2,000 (continuity):** "Build on or integrate any part of the Uniswap stack, including the Uniswap API, the Uniswap AMM (v2, v3, or v4), CCA ... new v4 hooks". Requires public repo + `FEEDBACK.md` + Uniswap Developer Feedback Form (https://developers.uniswap.org/hackathon-feedback); README must point to the relevant contracts/lines. (Lotus and Pool Party won both 1inch + Uniswap.)
- **Chainlink — 🔗 Best Confidential Workflow $2,000; 🔒 Automated Liquidation Protection Challenge $500 (join contract `0x59d5B29FbA5ca865a171076BE94EbEeC5BCA1E04` on Sepolia via `join()` from Sep 8 to deadline); 🏆 Best Chainlink-Powered Upgrade $500 (continuity):** must use CRE (Confidential Workflows / `handlerInTee`), Price Feeds, Data Streams, PoR or VRF and "contribute to a state change on a blockchain" (Ballast used Chainlink feeds in-opcode).
- **Arc (Circle) — Best DeFi/Onchain Finance Application $1,667; Launch on Arc Testnet & Push to Mainnet $3,500 (mainnet-ready by Sep 30):** stablecoin-native DeFi on Arc with USDC; needs working frontend+backend, architecture diagram, video.
- **The Graph — Best Use of Composable/Standardized Graph Products $5,000; Best AI Tooling/Use Case $5,000 (+$5,000 continuity):** must consume **live** Graph data (Subgraph Studio / Substreams); ArcBook won Graph 2nd with a subgraph + MCP over its Aqua positions.
- **Privy — Best financial flow $2,500 / Best B2B financial product $2,500:** Privy wallet + at least one functional flow (swap, transfer, vault…).
- **Ledger — AI Agents x Ledger $3,500 / Continuity $1,500:** Ledger Agent Stack / Key Ring CLI.
- **ENS — Best Use of ENSv2 $4,500 (Sepolia only):** ENSv2 must be central.
- **Bazantic — $1,000 ×3 tracks:** wrap your project's API as an x402 gateway + "recipe" on bazantic.com (one track explicitly mentions "the 1Inch Trace API").
- World, Hedera: identity / Hedera-specific — low fit.

---

## 9. Submission checklist for our team (derived)

1. Confirm every member is accepted + staked and which track (From Scratch vs Continuity) the team registered under (dashboard: https://ethglobal.com/events/ethonline2026/home). Continuity prize needs prior opt-in.
2. Repo: public GitHub; first commit after Fri Sep 4 12:00 pm EDT; many small commits throughout; no big final-day dump; README states what is reused (1inch repos, template) vs new; **AI-usage attribution section** (which files/parts; include specs/prompts if spec-driven).
3. Contracts: official Aqua router at `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a`; SwapVM app either official router `0x111111338c5091e8440b67b168bae16a668ac0de` or our **modified SwapVM redeploy with custom opcodes** (preferred for scoring).
4. Demo evidence: fork (Anvil/Foundry) script or UI that executes real ERC-20 transfers via the router (pull/push) — show balances before/after and tx traces in the video; deploy to a testnet/mainnet if cheap (winners used Base Sepolia, Base mainnet, Ethereum fork).
5. Tests: Foundry tests of the position/opcodes (winners cite 17+ tests, fuzzing, reference models).
6. Video: 2–4 min, ≥720p, real voice, screen recording, ≤20 s intro, show the position working on-chain; explain the mechanism and why SwapVM.
7. Check-ins on Sep 7 and Sep 10 (dashboard); attend a feedback session (Sep 8 20:00 CEST or Sep 10 15:00 CEST) to get partner eyes early.
8. Submission form: title, tagline, description, "How it's made", repo, live demo, video; select ≤3 partner prizes (1inch + up to two compatible ones); per-prize explanation + feedback for 1inch.
9. Submit well before **Sun Sep 13 18:00 CEST** (upload can fail on video validation; leave buffer to re-encode).

---

## 10. Open questions / uncertainties

- Will 1inch add a workshop/office hours to the ETHOnline schedule (Tanner Moore is listed as a speaker but nothing is published)? Watch `#schedule` and Discord.
- Exact 1inch Discord/Telegram support channel name for ETHOnline (not on the prize page).
- Are applications still open (`signupDeadline` Sep 6 17:00Z vs `enableHackerApplications:false`)?
- Which track our team registered under (Continuity prize eligibility).
- Whether 1inch conducts any live/synchronous partner judging at async events, or purely from video + repo.
- Whether ETHOnline finalists receive a "Finalist pack" (BA finalists got 1000 USDC each, hoodie, AWS credits) — no pack is listed on the ETHOnline prizes page.
- Aqua-app-template repo URL (cited by a winner) — not on any prize page.

---

## 11. Sources (URLs and local raw files)

- https://ethglobal.com/events/ethonline2026 (500 error via fetch but embedded JSON captured in `raw/root.html`, `raw/evx.html`)
- https://ethglobal.com/events/ethonline2026/prizes → `raw/root_prizes.html`, `raw/evx_prizes.html.txt`
- https://ethglobal.com/events/ethonline2026/prizes/1inch → `raw/root_prizes_1inch.html`, `raw/evx_prizes_1inch.html.txt`
- https://ethglobal.com/events/ethonline2026/info , /info/details , /info/start , /info/resources → `raw/root_info*.txt`
- https://ethglobal.com/rules → `raw/ethglobal_rules.txt`
- Continuity Track: https://x.com/ETHGlobal/status/2056399209767866682 and Kartik Talwar's article https://x.com/i/article/2056258666123415552 (fetched via api.fxtwitter.com); ETH Daily summary `raw/ethdaily_continuity.html`
- Prior events: https://ethglobal.com/events/newyork2026/prizes , /lisbon2026/prizes , /buenosaires/prizes → `raw/prizes_*.txt`; Tokyo 2026 1inch page via https://hackathon.1inch.community redirect → `raw/guide_1inch.html`
- Showcase: https://ethglobal.com/showcase?events=<slug>&partners=1inch and per-project pages → `raw/win_*.html`, `raw/winners/*.html`, `raw/proj_*.html`
- Workshops: https://www.youtube.com/watch?v=bdhba23BEzg , https://www.youtube.com/watch?v=VrtWeUR3Vq4 → `raw/transcript_*.txt`, `raw/yt_*.vtt`, `raw/slides.txt`
- Base dir for all raw files: `/private/tmp/claude-501/-Users-kirillrybkov-Desktop-project/9e63dac7-1e5d-4fe3-9634-61767d65c76a/scratchpad/raw/`
