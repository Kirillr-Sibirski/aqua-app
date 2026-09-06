export const meta = {
  name: 'aqua-design',
  description: 'Design workshop: 10 lensed ideators → 3 adversarial critics per idea → 3 judges → synthesis of the winning Aqua/SwapVM product concept',
  phases: [
    { title: 'Ideate', detail: '10 ideators, distinct lenses' },
    { title: 'Attack', detail: '3 critics per idea (judge / engineer / market)' },
    { title: 'Judge', detail: '3 judges rank + compose' },
    { title: 'Synthesize', detail: 'final concept brief' },
  ],
}

const SP = '/private/tmp/claude-501/-Users-kirillrybkov-Desktop-project/9e63dac7-1e5d-4fe3-9634-61767d65c76a/scratchpad'
const KB = `${SP}/kb`
const REFS = `${SP}/refs`
const OUT = `${SP}/design`

const BIBLE = `THE PRIZE (our bible — deviating is not acceptable): 1inch "Build an Aqua app" — "Create a custom Aqua app that implements a sophisticated DeFi position. If you use SwapVM, you may modify SwapVM opcodes and define your own instructions. The final positions must be demonstrated through tests scripts or a UI. Projects that utilize SwapVM will be scored higher during the final judging." QUALIFICATION: (1) Official Aqua/SwapVM contracts must be used (redeployments of a modified SwapVM contract is allowed); (2) Onchain execution of token transfers should be presented during the final demo (local forks are ok); (3) Proper Git commit history.
OUR GOAL: 1st place. The product must: be built AROUND Aqua (Aqua must be the core — something impossible or very hard without it), use SwapVM with at least one custom opcode/instruction that is natural (not gratuitous), implement a genuinely sophisticated DeFi position, resonate with a real current market pain point (evidence in KB), have a polished production-feeling UI with a wow factor (UX/wow > raw technical difficulty, but both must be present), and be buildable + demoable on a local anvil fork with visible token transfers within ONE NIGHT (~8 hours of build by a fleet of AI agents working in parallel; assume ~6 engineer-agents on contracts/tests, ~6 on UI, ~2 on integration).
HARD TECH FACTS (verified from source): custom router = contract X is Simulator, SwapVM, AquaOpcodes { override _runOpcode to add opcodes in free enum slots e.g. Opcode._d0.._ef }; router deployed bytecode is ~20.4KB with the full AquaOpcodes set (EIP-170 limit 24,576 — ~4KB headroom, or drop unused opcodes); SwapVM orders are 2-token pairs (tokenA<tokenB) but one maker wallet can ship MANY orders/strategies simultaneously that all draw on the SAME wallet balance (Aqua virtual balances can be over-allocated relative to real balance — the first fills win; that is the 'shared liquidity' superpower); in Aqua mode orderHash = keccak256(abi.encode(order)) = Aqua strategyHash; balances loaded via AQUA.safeBalances(maker, router, orderHash, tokenIn, tokenOut) BEFORE the program runs; the program mutates registers {balanceIn, balanceOut, amountIn, amountOut}; settlement via AQUA.pull (maker→taker) and AQUA.push (taker→maker) executed by the router; maker hooks (IMakerHooks pre/post transfer in/out, target contract chosen by the maker) and taker callbacks exist; Extruction opcode calls an external contract that may rewrite registers/PC/consume taker args (view in quote, non-view in swap); instructions can read storage in the router and write it only in swap mode (isStaticContext false); quote() must equal swap(); strategies are immutable after ship — reparameterization = dock + ship (no token transfers, cheap). Chainlink feeds & any onchain state are readable from instructions.
MORE VERIFIED FACTS (from kb/_critic.md — read it): the DEPLOYED official router 0x111111338c… is AquaSwapVMRouter tag v1.0.2 ("World A": old function-pointer opcode API, 5-arg quote/swap, SwapRegisters with amountNetPulled, Extruction selector 0xb77cc3e2); the swap-vm main branch HEAD ("World B") has a redesigned enum-banked opcode dispatch, 3-arg quote/swap, 4 registers + ProtocolFee. WE BUILD ON HEAD and REDEPLOY our own modified router against the OFFICIAL Aqua registry (explicitly allowed by the prize; our repo already compiles it and has 24 passing tests incl. 5 on a mainnet fork against the official Aqua). AquaOpcodes (16 opcodes) router = 20,376 B; EIP-170 headroom ≈ 4.2 KB — see kb/router-size-budget.md for per-opcode marginal bytes and what fits; anvil --disable-code-size-limit exists but a mainnet-deployable router is a much stronger story. No PRBMath/solady in upstream tree; kb/router-size-budget.md + contracts/src/probe measured fixed-point math costs. Oracle price on a fork can be mocked via anvil_setCode/anvil_setStorageAt (kb/oracle-mocking-fork.md). On Base there are ~436 live Shipped strategies, 159 ungated — a demo can fill REAL maker liquidity through the official router, then ship our own strategy to our router against the same registry. Judge taste from prior Aqua prizes (kb/prior-winners.md): every recent 1st-3rd shipped a custom instruction + fork/testnet fills + real tests; UI-only and natural-language-composer projects lost. In-progress competitor repos for THIS event: Keel (inventory-skew MM), overdraft (phantom-depth guard), Slope, barker, aqua0-ethglobal, Iqia — avoid colliding. Buenos Aires prize text listed examples: "Leverage, AMM, Lending, Options". Submission deadline is Sun Sep 13 2026 18:00 CEST (we are on Sep 6) — the build sprint is still sized as one night of agent-fleet work, with subsequent days for polish; ETHGlobal rules require documenting AI usage and including spec/planning artifacts in the repo.`

const IDEA_SCHEMA = {
  type: 'object',
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          one_liner: { type: 'string' },
          target_user: { type: 'string' },
          pain_point: { type: 'string', description: 'with evidence cited from KB (file + fact)' },
          why_only_aqua: { type: 'string', description: 'why this is impossible/very hard without Aqua specifically (not just any AMM/hook)' },
          swapvm_usage: { type: 'string', description: 'existing instructions used + the custom opcode(s): name, args, exact register semantics, why it must be an opcode' },
          position_mechanics: { type: 'string', description: 'the math/mechanics of the DeFi position, concrete enough to implement' },
          demo_storyline: { type: 'string', description: '3-minute demo on a local fork with visible token transfers, step by step' },
          ui_screens: { type: 'string', description: 'screens/components; what makes it feel production-grade and wow' },
          build_plan_10h: { type: 'string', description: 'workstreams and hours' },
          biggest_risks: { type: 'string' },
          self_score: { type: 'object', properties: { aqua_necessity: { type: 'number' }, swapvm_depth: { type: 'number' }, sophistication: { type: 'number' }, market_pain: { type: 'number' }, wow: { type: 'number' }, feasibility: { type: 'number' } }, required: ['aqua_necessity', 'swapvm_depth', 'sophistication', 'market_pain', 'wow', 'feasibility'] },
        },
        required: ['name', 'one_liner', 'target_user', 'pain_point', 'why_only_aqua', 'swapvm_usage', 'position_mechanics', 'demo_storyline', 'ui_screens', 'build_plan_10h', 'biggest_risks', 'self_score'],
      },
    },
  },
  required: ['ideas'],
}

const LENSES = [
  { key: 'lp-pain', lens: 'LP-PAIN-FIRST: start from the single most painful, best-evidenced problem LPs face today (LVR/IL, fragmentation, custody risk, idle capital) and design the product that fixes it using Aqua as the core.' },
  { key: 'institutional-mm', lens: 'INSTITUTIONAL/MARKET-MAKER-FIRST: design for professional market makers, token issuers or foundations who need to quote onchain liquidity without giving up custody (B2B feel; think Wintermute/GSR desk tooling, token-issuer liquidity without MM loans).' },
  { key: 'dao-treasury', lens: 'DAO/TREASURY-FIRST: design for DAOs, protocols and foundations with large idle treasuries (POL, diversification, buybacks, peg defense) — programmatic, self-custodial, transparent positions.' },
  { key: 'structured-products', lens: 'STRUCTURED-PRODUCTS/QUANT-FIRST: design a mathematically sophisticated position (payoff replication via curves, options-like exposure, volatility-aware pricing, carry) — the SwapVM custom opcode should be a genuinely novel curve or pricing rule with clean math.' },
  { key: 'swapvm-showcase', lens: 'SWAPVM-SHOWCASE-FIRST: start from what SwapVM uniquely enables (composable bytecode, custom opcodes, extruction, hooks, jumps, epochs) and design the product where the VM is the star — but it must still solve a real user problem.' },
  { key: 'shared-liquidity', lens: 'SHARED-LIQUIDITY-FIRST: exploit Aqua\'s defining property — one wallet balance backing many strategies at once, over-allocation, dock/ship without transfers. Design the product that is literally impossible on any pool-based DEX.' },
  { key: 'retail-wow', lens: 'RETAIL-WOW-FIRST: design for a consumer feel — something a normal DeFi user would love, with an instantly understandable value prop and a visually stunning interactive UI (curves, simulations, live fills).' },
  { key: 'agentic', lens: 'AGENTIC/AUTOMATION-FIRST: 2026 narrative — autonomous agents/bots operating liquidity. Because Aqua reparameterization is free (no token moves), an agent can re-ship strategies continuously. Design the product where an off-chain policy (deterministic rules, not an LLM) or onchain rules manage positions; must stay demoable on a fork.' },
  { key: 'judge-mind', lens: 'JUDGE-MIND-FIRST: think like the 1inch engineers judging this (read kb/aqua-positioning.md and kb/prior-winners.md closely): what would make THEM say "this is what Aqua was built for"? Design to maximize judge delight and prize-text alignment.' },
  { key: 'contrarian', lens: 'CONTRARIAN: assume the obvious ideas (CLMM around oracle, DCA/TWAP, grid bot, covered call) will be submitted by 20 other teams. Find the non-obvious angle that is still buildable and clearly superior — or take an obvious idea and find the twist that makes it category-defining.' },
]

const CRITIC_LENSES = [
  { key: 'judge', prompt: 'You are a senior 1inch protocol engineer judging the Aqua prize. Score prize-fit ruthlessly: Is Aqua truly the core (would the product be equally possible on Uniswap v4 hooks / a signature-mode SwapVM order without Aqua)? Is the SwapVM custom opcode necessary and elegant, or gratuitous? Is the "position" genuinely sophisticated or a re-skin of a limit order? Does the demo show onchain transfers? Would you rank it 1st among ~30 submissions? Try hard to REFUTE its claims of Aqua-necessity and sophistication.' },
  { key: 'engineer', prompt: 'You are a staff Solidity + frontend engineer who must ship this in ONE NIGHT with a fleet of AI agents. Read kb/swapvm-core.md, kb/swapvm-custom-opcodes.md, kb/swapvm-instructions.md, kb/swapvm-aqua-tests.md, kb/fork-stack.md and, when needed, the actual source under the refs dir. Find FATAL technical flaws: things quote() cannot do, invariants violated (symmetry, quote==swap, rounding), state that cannot be updated in a strategy (immutability), 2-token-per-order constraints, bytecode size, oracle availability on a fork, gas, anything that requires infrastructure that does not exist (indexers, keepers) and cannot be faked credibly in a demo. Estimate honest hours per workstream; flag anything > 10h total or with a single-point-of-failure.' },
  { key: 'market', prompt: 'You are a skeptical DeFi founder/investor and product designer. Read kb/market-lp-pain.md, kb/market-competitors.md, kb/ux-benchmarks.md. Attack: is the pain real and quantified? who exactly pays/uses this and why now? is it differentiated from existing products (name them)? is the demo storyline compelling in 3 minutes to a non-expert? does the UI concept have a real wow moment, or is it another dashboard? What would make it 2x more compelling?' },
]

const CRITIQUE_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'number', description: '1-10 overall from your lens' },
    fatal_flaws: { type: 'array', items: { type: 'string' } },
    weaknesses: { type: 'array', items: { type: 'string' } },
    strengths: { type: 'array', items: { type: 'string' } },
    fixes: { type: 'array', items: { type: 'string' }, description: 'concrete changes that would raise the score' },
    verdict: { type: 'string', enum: ['kill', 'weak', 'viable', 'strong', 'exceptional'] },
  },
  required: ['score', 'fatal_flaws', 'weaknesses', 'strengths', 'fixes', 'verdict'],
}

phase('Ideate')
log('Ideation: 10 lensed ideators')
const ideaSets = await parallel(LENSES.map(l => () =>
  agent(`${BIBLE}
You are a product+protocol designer. FIRST read ALL knowledge-base files in ${KB}/ (ls, then read each fully — they contain verified facts about Aqua, SwapVM, the hackathon rules, 1inch positioning, prior winners, market pain, competitors, a catalog of candidate positions, UX benchmarks and the fork stack). Cite them.
YOUR LENS: ${l.lens}
Propose exactly 2 ideas (your best, and a distinct alternate). Each must be a COMPLETE concept per the schema — concrete mechanics, concrete custom opcode semantics, a concrete 3-minute demo on a local fork with token transfers, concrete UI. Be honest in self-scores (1-10). Avoid generic filler. Names should be brandable product names, not descriptions.`, { label: `ideate:${l.key}`, phase: 'Ideate', schema: IDEA_SCHEMA, effort: 'xhigh' })
    .then(r => (r ? r.ideas.map(i => ({ ...i, lens: l.key })) : []))
))
const ideas = ideaSets.filter(Boolean).flat()
log(`${ideas.length} ideas proposed`)

phase('Attack')
const attacked = await pipeline(
  ideas,
  (idea, _, i) => parallel(CRITIC_LENSES.map(c => () =>
    agent(`${BIBLE}
${c.prompt}
Knowledge base: ${KB}/ (read the files relevant to your lens; source refs at ${REFS}).
IDEA #${i + 1} (${idea.lens} lens): ${JSON.stringify(idea, null, 2)}
Be adversarial and specific. Default to skepticism. Return the structured critique.`, { label: `attack:${c.key}:${idea.name.slice(0, 24)}`, phase: 'Attack', schema: CRITIQUE_SCHEMA, effort: 'high' })
  )).then(cs => ({ idea, critiques: CRITIC_LENSES.map((c, k) => ({ lens: c.key, ...(cs[k] || { score: 0, fatal_flaws: ['critic failed'], weaknesses: [], strengths: [], fixes: [], verdict: 'weak' }) })) }))
)
const scored = attacked.filter(Boolean).map(a => ({ ...a, mean: a.critiques.reduce((s, c) => s + c.score, 0) / a.critiques.length, kills: a.critiques.filter(c => c.verdict === 'kill').length }))
scored.sort((a, b) => b.mean - a.mean)
log(`Attack done. Top 5: ${scored.slice(0, 5).map(s => `${s.idea.name}(${s.mean.toFixed(1)})`).join(', ')}`)

phase('Judge')
const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    ranking: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, rank: { type: 'number' }, rationale: { type: 'string' } }, required: ['name', 'rank', 'rationale'] } },
    composite: { type: 'string', description: 'your recommended final concept: possibly a merge of the winner with the best elements of runners-up; full description incl. custom opcodes, position mechanics, demo, UI' },
    must_fix: { type: 'array', items: { type: 'string' } },
  },
  required: ['ranking', 'composite', 'must_fix'],
}
const JUDGE_LENSES = ['as the 1inch head judge optimizing for prize-text alignment and technical taste', 'as a top hackathon mentor optimizing for demo impact, UI wow and finishability in one night', 'as a DeFi protocol founder optimizing for real-market potential and defensibility']
const judged = await parallel(JUDGE_LENSES.map((jl, k) => () =>
  agent(`${BIBLE}
You are judge #${k + 1}, judging ${jl}. Knowledge base at ${KB}/ (read kb/aqua-positioning.md, kb/hackathon-rules.md, kb/prior-winners.md at minimum).
Here are all ${scored.length} ideas with three adversarial critiques each (sorted by mean critic score):
${JSON.stringify(scored.map(s => ({ name: s.idea.name, lens: s.idea.lens, one_liner: s.idea.one_liner, mean: s.mean, kills: s.kills, idea: s.idea, critiques: s.critiques })), null, 1)}
Rank the top 8. Then write your COMPOSITE recommendation: the concept we should build (you may merge), with every element the build needs: name, positioning sentence, user, position mechanics + math, custom opcode(s) spec, use of existing instructions, Aqua usage pattern (how many orders per wallet, shared balance story), demo storyline on a fork, UI screens & the wow moment, workstreams for one night, and the must-fix list from critiques.`, { label: `judge:${k + 1}`, phase: 'Judge', schema: JUDGE_SCHEMA, effort: 'xhigh' })
))

phase('Synthesize')
const synthesis = await agent(`${BIBLE}
You are the final synthesizer. Three judges produced rankings and composite recommendations:
${JSON.stringify(judged.filter(Boolean), null, 1)}
The full idea+critique corpus is available in this text (top 6 by critic mean):
${JSON.stringify(scored.slice(0, 6).map(s => ({ idea: s.idea, critiques: s.critiques, mean: s.mean })), null, 1)}
Knowledge base: ${KB}/.
Produce ${OUT}/CONCEPT.md (mkdir -p ${OUT}): the single final product concept to build tonight, plus a runner-up. Structure: 1) Name + one-sentence positioning + who it is for; 2) The pain point with evidence; 3) Why it is only possible with Aqua (explicit, defensible); 4) The DeFi position(s) — mechanics and math, precise enough to implement; 5) SwapVM design: program layout, existing instructions used, custom opcode(s) full spec (name, opcode slot, args encoding, register semantics, storage, quote/swap consistency, invariants), any Extruction/hook usage; 6) Aqua usage pattern (orders per wallet, shared-balance story, dock/ship lifecycle); 7) The 3-minute demo script on a local fork with visible token transfers; 8) UI: screens, components, the wow moment, visual direction (must not look vibe-coded); 9) Architecture & workstreams for one night with file ownership boundaries (contracts/, web/, sdk, scripts, docs) and hour estimates; 10) Risks and mitigations; 11) What we explicitly will NOT build. Also return a short structured summary. Be decisive: pick ONE.`, { label: 'synthesize', phase: 'Synthesize', effort: 'xhigh', schema: { type: 'object', properties: { winner: { type: 'string' }, positioning: { type: 'string' }, runner_up: { type: 'string' }, custom_opcodes: { type: 'array', items: { type: 'string' } }, key_risks: { type: 'array', items: { type: 'string' } } }, required: ['winner', 'positioning', 'runner_up', 'custom_opcodes', 'key_risks'] } })

return { synthesis, leaderboard: scored.map(s => ({ name: s.idea.name, lens: s.idea.lens, mean: s.mean, kills: s.kills, verdicts: s.critiques.map(c => `${c.lens}:${c.verdict}(${c.score})`) })), judges: judged.filter(Boolean).map(j => ({ top3: j.ranking.slice(0, 3), must_fix: j.must_fix })) }
