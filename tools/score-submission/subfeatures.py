#!/usr/bin/env python3
"""
subfeatures.py -- text feature extraction for the ETHGlobal auto-assessment predictor.

Shared by fit_calibration.py (which fits the model on 602 scored 2026 projects)
and score_submission.py (which scores one draft).

The vocabularies and the feats() function are ported, near-verbatim, from the
measurement script that produced the underlying study:
    scratchpad/aiscore/features.py   (~90 features, measured on n=602)
Two things are added here that features.py did not have:
    n_named_artifacts / n_named_artifacts_hm  -- a re-implementation of the
        "named-artifact count" that the replica-scorer investigation found to be
        the strongest single measurable driver of technicality.
    winsorize()                               -- clamping to the corpus range, so
        the linear model cannot be extrapolated off the end of the data.

stdlib only: json / re / math.
"""

import re
import math

# ---------------------------------------------------------------------------
# vocabularies (ported verbatim from features.py -- do not silently edit; the
# fitted coefficients in calibration.json depend on these exact lists)
# ---------------------------------------------------------------------------

TECH = [
    # chains / L2s
    'ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'zksync', 'scroll', 'linea', 'starknet',
    'avalanche', 'solana', 'bitcoin', 'celo', 'gnosis', 'mantle', 'blast', 'zora', 'unichain', 'ink',
    'sepolia', 'holesky', 'anvil', 'flow', 'flare', 'hedera', 'near', 'cosmos', 'polkadot', 'sui', 'aptos',
    'monad', 'berachain', 'katana', 'rootstock', 'citrea', 'botanix', 'xlayer', 'worldchain', 'arc',
    # infra / rpc / data
    'alchemy', 'infura', 'quicknode', 'thegraph', 'the graph', 'subgraph', 'envio', 'goldsky', 'ponder',
    'dune', 'covalent', 'moralis', 'tenderly', 'blockscout', 'etherscan', 'chainlink', 'pyth', 'redstone',
    'api3', 'uma', 'supra', 'ipfs', 'filecoin', 'arweave', 'pinata', 'irys', 'storacha', 'lighthouse',
    'walrus', 'eigenda', 'celestia', 'avail', 'akave', '0g',
    # account abstraction / wallets
    'privy', 'dynamic', 'thirdweb', 'walletconnect', 'reown', 'metamask', 'rainbowkit', 'safe', 'gnosis safe',
    'biconomy', 'pimlico', 'zerodev', 'alchemy aa', 'erc-4337', 'erc4337', 'eip-7702', 'eip7702', 'erc-7579',
    'passkey', 'webauthn', 'coinbase wallet', 'porto', 'turnkey', 'para', 'crossmint', 'dfns', 'fireblocks',
    'account abstraction', 'smart account', 'paymaster', 'bundler', 'userop', 'user operation',
    # defi protocols
    'uniswap', '1inch', 'aave', 'compound', 'curve', 'balancer', 'sushiswap', 'pancakeswap', 'morpho',
    'euler', 'fluid', 'pendle', 'ethena', 'lido', 'rocket pool', 'eigenlayer', 'symbiotic', 'maker', 'sky',
    'spark', 'gmx', 'hyperliquid', 'dydx', 'synthetix', 'yearn', 'convex', 'across', 'li.fi', 'lifi',
    'socket', 'stargate', 'layerzero', 'wormhole', 'axelar', 'hyperlane', 'ccip', 'cctp', 'circle',
    'chainflip', 'thorchain', 'cow protocol', 'cowswap', '0x protocol', 'paraswap', 'odos', 'enso',
    'aqua', 'swapvm', 'limit order protocol', 'fusion', 'uniswap v4', 'uniswap v3', 'hooks', 'permit2',
    # zk / crypto
    'circom', 'noir', 'halo2', 'plonk', 'groth16', 'risc zero', 'risc0', 'sp1', 'succinct', 'gnark',
    'snarkjs', 'zokrates', 'arkworks', 'poseidon', 'semaphore', 'world id', 'worldcoin', 'anon aadhaar',
    'zk-email', 'zkemail', 'tlsnotary', 'vlayer', 'reclaim', 'self protocol', 'zkpassport', 'zupass',
    'fhe', 'fhenix', 'zama', 'inco', 'mpc', 'tee', 'sgx', 'nitro enclave', 'oasis', 'sapphire', 'marlin',
    'plonky2', 'stwo', 'cairo', 'bonsai', 'brevis', 'axiom', 'herodotus', 'lagrange', 'boundless',
    # ai / agents
    'openai', 'anthropic', 'claude', 'gpt-4', 'gpt-5', 'gpt4', 'llama', 'mistral', 'gemini', 'langchain',
    'langgraph', 'llamaindex', 'crewai', 'autogen', 'eliza', 'elizaos', 'mcp', 'model context protocol',
    'ollama', 'huggingface', 'hugging face', 'pinecone', 'chroma', 'weaviate', 'qdrant', 'pgvector',
    'vercel ai', 'ai sdk', 'a2a', 'x402', 'coinbase agentkit', 'agentkit', 'openrouter', 'groq', 'fetch.ai',
    'olas', 'autonolas', 'virtuals', 'venice', 'nosana', 'akash', 'bittensor',
    # dev tooling / frameworks
    'solidity', 'vyper', 'huff', 'yul', 'foundry', 'hardhat', 'truffle', 'remix', 'openzeppelin', 'forge',
    'ethers', 'ethers.js', 'viem', 'wagmi', 'web3.js', 'web3.py', 'rust', 'typescript', 'javascript',
    'python', 'golang', 'next.js', 'nextjs', 'react', 'react native', 'vue', 'svelte', 'expo', 'flutter',
    'tailwind', 'node.js', 'express', 'fastapi', 'django', 'flask', 'postgres', 'postgresql', 'supabase',
    'firebase', 'mongodb', 'redis', 'sqlite', 'prisma', 'drizzle', 'docker', 'kubernetes', 'vercel',
    'netlify', 'railway', 'fly.io', 'cloudflare', 'aws', 'gcp', 'lambda', 'wasm', 'webassembly',
    'farcaster', 'lens', 'xmtp', 'push protocol', 'warpcast', 'telegram', 'discord', 'twilio', 'stripe',
    'zapier', 'n8n', 'graphql', 'trpc', 'websocket', 'grpc', 'protobuf', 'turborepo', 'pnpm', 'vite',
    'ens', 'erc-20', 'erc20', 'erc-721', 'erc721', 'erc-1155', 'erc1155', 'erc-6551', 'erc-7730', 'nft',
    'the tie', 'pyusd', 'usdc', 'usdt', 'dai', 'weth', 'wbtc', 'steth', 'reth',
]
TECH = sorted(set(TECH), key=len, reverse=True)
TECH_RE = re.compile(r'(?<![A-Za-z0-9])(' + '|'.join(re.escape(t) for t in TECH) + r')(?![A-Za-z0-9])', re.I)

TECHNOUN = [
    'contract', 'contracts', 'opcode', 'opcodes', 'bytecode', 'calldata', 'abi', 'circuit', 'circuits',
    'subgraph', 'sdk', 'api', 'endpoint', 'endpoints', 'proof', 'proofs', 'prover', 'verifier', 'witness',
    'merkle', 'hash', 'signature', 'signatures', 'nonce', 'gas', 'invariant', 'solver', 'router', 'vault',
    'oracle', 'keeper', 'relayer', 'sequencer', 'rollup', 'bridge', 'indexer', 'node', 'rpc', 'testnet',
    'mainnet', 'fork', 'deploy', 'deployed', 'deployment', 'compiler', 'runtime', 'vm', 'evm', 'stack',
    'schema', 'migration', 'middleware', 'webhook', 'daemon', 'cron', 'queue', 'cache', 'mutex', 'thread',
    'async', 'callback', 'handler', 'interface', 'struct', 'enum', 'mapping', 'modifier', 'assembly',
    'storage slot', 'slot', 'encoding', 'decode', 'encode', 'serialize', 'parser', 'ast', 'grammar',
    'curve', 'amm', 'liquidity', 'slippage', 'settlement', 'orderbook', 'order book', 'fill', 'maker',
    'taker', 'collateral', 'liquidation', 'staking', 'slashing', 'epoch', 'block', 'timestamp', 'tx',
    'transaction', 'wallet', 'key', 'keypair', 'entropy', 'nullifier', 'commitment', 'ciphertext',
    'plaintext', 'encryption', 'decryption', 'threshold', 'quorum', 'consensus', 'validator',
    'inference', 'embedding', 'vector', 'prompt', 'token', 'tokenizer', 'fine-tune', 'model weights',
    'latency', 'throughput', 'benchmark', 'profiler', 'unit test', 'integration test', 'fuzz', 'fuzzing',
    'coverage', 'ci', 'pipeline', 'repo', 'repository', 'branch', 'commit',
]
TECHNOUN = sorted(set(TECHNOUN), key=len, reverse=True)
TECHNOUN_RE = re.compile(r'(?<![A-Za-z0-9])(' + '|'.join(re.escape(t) for t in TECHNOUN) + r')(?![A-Za-z0-9])', re.I)

BUZZ = ['seamless', 'seamlessly', 'revolutionary', 'revolutioniz', 'empower', 'unlock', 'leverage',
        'leveraging', 'cutting-edge', 'cutting edge', 'next-generation', 'next generation', 'game-chang',
        'game chang', 'disrupt', 'democratiz', 'frictionless', 'effortless', 'effortlessly', 'robust',
        'innovative', 'innovation', 'transformative', 'paradigm', 'synerg', 'holistic', 'world-class',
        'state-of-the-art', 'state of the art', 'unparalleled', 'unprecedented', 'ecosystem',
        'supercharge', 'turbocharge', 'magic', 'magical', 'beautiful', 'stunning', 'powerful', 'seamless',
        'one-stop', 'all-in-one', 'best-in-class', 'harness', 'elevate', 'redefin', 'reimagin']
BUZZ_RE = re.compile('(' + '|'.join(re.escape(b) for b in BUZZ) + ')', re.I)

HEDGE = ['aims to', 'aim to', 'aiming to', 'would allow', 'would enable', 'could be', 'could allow',
         'plans to', 'plan to', 'we hope', 'hopes to', 'intends to', 'intend to', 'in the future',
         'eventually', 'someday', 'envision', 'vision is', 'goal is to', 'seeks to', 'strives to',
         'may be able', 'might be', 'should be able', 'is intended to', 'will be able', 'roadmap',
         'potentially', 'ideally', 'theoretically', 'in theory']
HEDGE_RE = re.compile('(' + '|'.join(re.escape(h) for h in HEDGE) + ')', re.I)

INCOMPLETE = ['due to time', 'time constraints', 'limited time', 'ran out of time', 'not yet',
              "didn't have time", 'did not have time', 'future work', 'next steps', 'todo', 'to-do',
              'work in progress', 'wip', 'proof of concept', 'proof-of-concept', 'poc', 'mvp',
              'prototype', 'unfortunately', 'was not able', "wasn't able", 'could not finish',
              "couldn't finish", 'incomplete', 'not implemented', 'not fully', 'partially', 'stub',
              'mock', 'mocked', 'hardcoded', 'hard-coded', 'simulated', 'placeholder', 'demo purposes',
              'for now', 'currently only', 'only supports', 'limitation', 'limitations', 'hackathon scope']
INCOMPLETE_RE = re.compile('(' + '|'.join(re.escape(x) for x in INCOMPLETE) + ')', re.I)

PROBLEM_RE = re.compile(
    r'^\W*(today|currently|right now|in\s+(web3|defi|crypto|the\s+\w+\s+(world|space|industry))|'
    r'the problem|problem[:\s]|imagine|every\s+\w+|most\s+\w+|many\s+\w+|there\s+is\s+no|there\s+are\s+no|'
    r'\w+\s+is\s+broken|\w+\s+are\s+broken|it\s+is\s+hard|it\'s\s+hard|it\s+is\s+difficult|'
    r'\w+\s+struggle|\w+\s+suffer|why\s|have\s+you\s+ever|ever\s+wondered|millions of|billions of|'
    r'\d+%\s|when\s+you)', re.I)
BENEFIT_RE = re.compile(
    r'(lets you|let you|allows you|allows users|enables you|enables users|makes it easy|makes it simple|'
    r'helps you|helps users|so you can|without having to|in one click|in seconds|easily|effortlessly|'
    r'anyone can|no code|no-code)', re.I)
MECHANISM_RE = re.compile(
    r'^\W*(\w[\w\s\.\-]{0,60}?\s+(is|are)\s+(a|an|the)\s+[^.]{0,80}?'
    r'(protocol|contract|smart contract|router|engine|vm|compiler|sdk|library|framework|circuit|'
    r'proof|extension|plugin|hook|module|daemon|indexer|node|client|server|api|primitive|'
    r'implementation|system|layer|network|standard|dsl)\b)', re.I)

CODEID_RE = re.compile(r'(`[^`]+`|\b[a-z]+[A-Z][A-Za-z0-9]*\(|\b[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*\b|'
                       r'\b\w+\.(sol|ts|tsx|js|py|rs|go|json|toml|yaml|circom|nr|cairo|move)\b|'
                       r'\b[a-z_]+_[a-z_]+\b|/[a-z_]+/[a-z_]+|\b0x[0-9a-fA-F]{6,}\b|\w+\(\))')
NUM_RE = re.compile(r'(?<![A-Za-z0-9_])\d[\d,\.]*')
MEASURE_RE = re.compile(r'\d[\d,\.]*\s*(%|ms|s\b|sec|seconds|minutes|hours|x\b|k\b|m\b|bps|gwei|gas|'
                        r'eth\b|usdc|usd|\$|bytes|kb|mb|gb|tps|qps|lines|tests|users|chains|blocks)', re.I)
URL_RE = re.compile(r'https?://\S+')
FIRST_PERSON_RE = re.compile(r'\b(we|our|us|i|my|me|ours|mine)\b', re.I)

# --- named-artifact count (re-implementation of the replica study's "N") ------
# Things specific enough to look up. Bare product names in a stack list do NOT
# count, so common stack tokens that would otherwise match are stoplisted.
ARTIFACT_RES = [
    re.compile(r'\b[A-Za-z_][A-Za-z0-9_]*\.(?:sol|ts|tsx|js|jsx|py|rs|go|toml|circom|nr|cairo|move|yaml|yml)\b'),
    re.compile(r'\b(?:EIP|ERC|ENSIP|BIP|SIP|RIP|CAIP)-?\d{1,5}\b', re.I),
    re.compile(r'\b[a-zA-Z_][A-Za-z0-9_]*\(\)'),
    re.compile(r'\b[A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]*)+\b'),
    re.compile(r'`[^`\n]{2,60}`'),
    re.compile(r'\b0x[0-9a-fA-F]{4,}\b'),
    re.compile(r'\bv?\d+\.\d+(?:\.\d+)?\b'),
]
ARTIFACT_STOP = set("""
next.js node.js ethers.js web3.js react.js vue.js three.js chart.js d3.js
typescript javascript postgresql openzeppelin walletconnect rainbowkit layerzero metamask
coinbase github gitlab docker kubernetes cloudflare firebase supabase mongodb sqlite
tailwindcss chainlink worldcoin hyperliquid eigenlayer thegraph blockscout quicknode
solidity foundry hardhat langchain langgraph llamaindex huggingface openai anthropic
crewai elizaos agentkit paraswap sushiswap pancakeswap thorchain chainflip cowswap
""".split())


def _norm_artifact(s):
    return s.strip('` ').lower()


def named_artifacts(text):
    """Set of distinct look-up-able artifacts named in `text`."""
    out = set()
    for rx in ARTIFACT_RES:
        for m in rx.finditer(text or ''):
            tok = _norm_artifact(m.group(0))
            if len(tok) < 3:
                continue
            if tok in ARTIFACT_STOP:
                continue
            out.add(tok)
    return out


VOWELS = 'aeiouy'


def syllables(w):
    w = w.lower()
    if not w:
        return 0
    n, prev = 0, False
    for ch in w:
        v = ch in VOWELS
        if v and not prev:
            n += 1
        prev = v
    if w.endswith('e') and n > 1:
        n -= 1
    return max(1, n)


def words(t):
    return re.findall(r"[A-Za-z][A-Za-z'\-]*", t or '')


def sentences(t):
    t = (t or '').strip()
    if not t:
        return []
    parts = re.split(r'(?<=[.!?])\s+|\n+', t)
    return [p for p in parts if len(p.strip()) > 2]


# ---------------------------------------------------------------------------
# feature extraction
# ---------------------------------------------------------------------------

def feats(r):
    """r: dict with tagline / description / how_its_made / has_repo / has_demo_url /
    has_video / event_slug / name. Returns a flat dict of float features."""
    name = r.get('name') or ''
    tag = (r.get('tagline') or '').strip()
    desc = (r.get('description') or '').strip()
    hm = (r.get('how_its_made') or '').strip()
    all_t = ' \n '.join([tag, desc, hm])

    dw, hw, aw = words(desc), words(hm), words(all_t)
    ds, hs = sentences(desc), sentences(hm)
    f = {}

    # ---- size ----
    f['tagline_chars'] = len(tag)
    f['desc_chars'] = len(desc)
    f['hm_chars'] = len(hm)
    f['total_chars'] = len(all_t)
    f['desc_words'] = len(dw)
    f['hm_words'] = len(hw)
    f['total_words'] = len(aw)
    f['hm_over_desc'] = (len(hm) + 1.0) / (len(desc) + 1.0)
    f['hm_share'] = len(hm) / max(1.0, len(desc) + len(hm))
    f['log_desc_chars'] = math.log10(len(desc) + 1)
    f['log_hm_chars'] = math.log10(len(hm) + 1)
    f['log_total_chars'] = math.log10(len(all_t) + 1)
    f['desc_sentences'] = len(ds)
    f['hm_sentences'] = len(hs)
    f['n_paragraphs'] = len([p for p in re.split(r'\n\s*\n|\n', all_t) if p.strip()])
    f['n_bullets'] = len(re.findall(r'(?m)^\s*([-*•]|\d+[.)])\s+', all_t))
    f['has_bullets'] = 1.0 if f['n_bullets'] >= 2 else 0.0
    f['has_headings'] = 1.0 if len(re.findall(
        r'(?m)^\s*(#{1,4}\s|\*\*[^*]+\*\*\s*$|[A-Z][A-Za-z /()+.]{3,40}:\s*$)', all_t)) >= 2 else 0.0

    # ---- readability ----
    aws = aw or ['x']
    sent_all = ds + hs or ['x']
    wps = len(aws) / max(1, len(sent_all))
    syl = sum(syllables(w) for w in aws) / len(aws)
    f['words_per_sentence'] = wps
    f['syllables_per_word'] = syl
    f['flesch'] = 206.835 - 1.015 * wps - 84.6 * syl
    f['fk_grade'] = 0.39 * wps + 11.8 * syl - 15.59
    f['mean_word_len'] = sum(len(w) for w in aws) / len(aws)
    f['ttr'] = len(set(w.lower() for w in aws)) / len(aws)
    f['long_word_share'] = sum(1 for w in aws if len(w) >= 9) / len(aws)

    # ---- concrete technology naming ----
    def techset(t):
        return set(m.group(1).lower() for m in TECH_RE.finditer(t or ''))
    tall, td, th, tt = techset(all_t), techset(desc), techset(hm), techset(tag)
    f['n_tech_distinct'] = len(tall)
    f['n_tech_mentions'] = len(TECH_RE.findall(all_t))
    f['n_tech_desc'] = len(td)
    f['n_tech_hm'] = len(th)
    f['tagline_names_tech'] = 1.0 if tt else 0.0
    f['tech_per_100w'] = 100.0 * f['n_tech_mentions'] / max(1, len(aws))

    f['n_technoun_mentions'] = len(TECHNOUN_RE.findall(all_t))
    f['n_technoun_distinct'] = len(set(m.group(1).lower() for m in TECHNOUN_RE.finditer(all_t)))
    f['technoun_per_100w'] = 100.0 * f['n_technoun_mentions'] / max(1, len(aws))
    f['n_technoun_hm'] = len(TECHNOUN_RE.findall(hm))

    # ---- specificity markers ----
    f['n_numbers'] = len(NUM_RE.findall(all_t))
    f['has_numbers'] = 1.0 if f['n_numbers'] > 0 else 0.0
    f['n_measurements'] = len(MEASURE_RE.findall(all_t))
    f['has_measurement'] = 1.0 if f['n_measurements'] > 0 else 0.0
    f['n_codeids'] = len(CODEID_RE.findall(all_t))
    f['has_codeid'] = 1.0 if f['n_codeids'] > 0 else 0.0
    f['has_backticks'] = 1.0 if '`' in all_t else 0.0
    f['has_filepath'] = 1.0 if re.search(
        r'\b\w+\.(sol|ts|tsx|rs|py|circom|nr|move|cairo)\b|/src/|/contracts/', all_t) else 0.0
    f['has_address'] = 1.0 if re.search(r'0x[0-9a-fA-F]{20,}', all_t) else 0.0
    f['n_urls_in_text'] = len(URL_RE.findall(all_t))
    f['has_url_in_text'] = 1.0 if f['n_urls_in_text'] else 0.0
    f['mentions_tests'] = 1.0 if re.search(
        r'\b(unit test|integration test|test suite|foundry test|\d+\s+tests|tests? pass|fuzz|'
        r'invariant test|coverage)\b', all_t, re.I) else 0.0
    f['mentions_deployed'] = 1.0 if re.search(
        r'\b(deployed (to|on|at)|live (on|at)|verified on|mainnet fork|testnet deployment|is deployed)\b',
        all_t, re.I) else 0.0
    f['mentions_benchmark'] = 1.0 if re.search(
        r'\b(benchmark|latency|throughput|gas cost|gas saving|faster than|reduced .{0,20}by \d)',
        all_t, re.I) else 0.0

    # ---- named artifacts (replica study's N) ----
    na_all = named_artifacts(all_t)
    na_hm = named_artifacts(hm)
    f['n_named_artifacts'] = len(na_all)
    f['n_named_artifacts_hm'] = len(na_hm)

    # ---- rhetoric ----
    f['n_buzz'] = len(BUZZ_RE.findall(all_t))
    f['buzz_per_100w'] = 100.0 * f['n_buzz'] / max(1, len(aws))
    f['has_buzz'] = 1.0 if f['n_buzz'] else 0.0
    f['n_hedge'] = len(HEDGE_RE.findall(all_t))
    f['has_hedge'] = 1.0 if f['n_hedge'] else 0.0
    f['n_incomplete'] = len(INCOMPLETE_RE.findall(all_t))
    f['has_incomplete'] = 1.0 if f['n_incomplete'] else 0.0
    fp = len(FIRST_PERSON_RE.findall(all_t))
    f['n_first_person'] = fp
    f['first_person_per_100w'] = 100.0 * fp / max(1, len(aws))
    f['is_first_person'] = 1.0 if fp >= 3 else 0.0
    f['excl_marks'] = all_t.count('!')
    f['question_marks'] = all_t.count('?')
    f['all_caps_words'] = sum(1 for w in aws if len(w) > 2 and w.isupper())

    first_sent = (ds[0] if ds else desc)[:400]
    f['opens_problem'] = 1.0 if PROBLEM_RE.search(first_sent) else 0.0
    f['opens_mechanism'] = 1.0 if MECHANISM_RE.search(first_sent) else 0.0
    f['opens_benefit'] = 1.0 if (BENEFIT_RE.search(first_sent) and not MECHANISM_RE.search(first_sent)) else 0.0
    f['opens_other'] = 1.0 if not (f['opens_problem'] or f['opens_mechanism'] or f['opens_benefit']) else 0.0
    f['desc_names_project'] = 1.0 if name and name.lower().split()[0] in first_sent.lower() else 0.0

    # ---- topic ----
    low = all_t.lower()
    f['topic_ai'] = 1.0 if re.search(r'\b(ai|llm|agent|agents|model|inference|gpt|prompt)\b', low) else 0.0
    f['topic_zk'] = 1.0 if re.search(r'\b(zk|zero-knowledge|zero knowledge|snark|stark|proof)\b', low) else 0.0
    f['topic_defi'] = 1.0 if re.search(r'\b(defi|swap|lending|liquidity|amm|yield|vault|perp)\b', low) else 0.0
    f['topic_privacy'] = 1.0 if re.search(r'\b(privacy|private|encrypt|confidential|anonym)\b', low) else 0.0
    f['topic_social'] = 1.0 if re.search(r'\b(social|community|creator|game|nft|art|music|sport)\b', low) else 0.0
    f['topic_infra'] = 1.0 if re.search(
        r'\b(infra|infrastructure|sdk|toolkit|developer|library|framework|standard)\b', low) else 0.0

    # ---- artifacts ----
    f['has_repo'] = 1.0 if r.get('has_repo') else 0.0
    f['has_demo_url'] = 1.0 if r.get('has_demo_url') else 0.0
    f['has_video'] = 1.0 if r.get('has_video') else 0.0
    f['n_artifacts'] = f['has_repo'] + f['has_demo_url'] + f['has_video']

    # ---- event fixed effects (non-actionable controls) ----
    f['ev_cannes'] = 1.0 if r.get('event_slug') == 'cannes2026' else 0.0
    f['ev_newyork'] = 1.0 if r.get('event_slug') == 'newyork2026' else 0.0
    f['ev_lisbon'] = 1.0 if r.get('event_slug') == 'lisbon2026' else 0.0
    return f


# The 26-feature model from features.py (`MODEL_FEATS`). Held-out CV R^2 on n=602:
# technicality 0.188 / originality 0.173 / practicality 0.082.
MODEL_FEATS = [
    'log_hm_chars', 'log_desc_chars', 'n_tech_distinct', 'technoun_per_100w',
    'n_codeids', 'has_numbers', 'buzz_per_100w', 'n_incomplete', 'n_hedge',
    'first_person_per_100w', 'flesch', 'has_repo', 'has_demo_url', 'has_video',
    'opens_problem', 'opens_mechanism', 'mentions_tests', 'mentions_deployed',
    'has_bullets', 'ttr', 'topic_ai', 'topic_zk', 'topic_defi', 'topic_infra',
    'ev_newyork', 'ev_lisbon',
]

# The 9-feature reparameterised "budget allocation" model from features.py
# (`ALLOC`). Higher held-out R^2 for technicality (0.225) than MODEL_FEATS.
ALLOC_FEATS = [
    'log_total_chars', 'hm_share', 'tech_per_100w', 'technoun_per_100w',
    'buzz_per_100w', 'ttr', 'has_video', 'ev_newyork', 'ev_lisbon',
]

TARGETS = ['T', 'O', 'P']
TARGET_KEY = {'T': 'auto_technicality', 'O': 'auto_originality', 'P': 'auto_practicality'}
TARGET_NAME = {'T': 'autoTechnicality', 'O': 'autoOriginality', 'P': 'autoPracticality'}


def winsorize(f, bounds):
    """Clamp each feature to the corpus [p2, p98] range so the linear model is
    never evaluated outside the region where it was fitted. Returns
    (clamped_dict, list_of_(name, raw, clamped))."""
    out = dict(f)
    clamped = []
    for k, (lo, hi) in bounds.items():
        if k not in out:
            continue
        v = float(out[k])
        nv = min(hi, max(lo, v))
        if abs(nv - v) > 1e-9:
            clamped.append((k, v, nv))
            out[k] = nv
    return out, clamped


# ---------------------------------------------------------------------------
# flag provenance -- which literal substring made a boolean flag fire.
# The regexes are keyword matchers, so they can fire on a proper noun that
# happens to contain a keyword (an instruction named `Coverage` fires
# mentions_tests). Showing the matched token lets a reader catch that.
# ---------------------------------------------------------------------------

_FLAG_RES = {
    'mentions_tests': re.compile(
        r'\b(unit test|integration test|test suite|foundry test|\d+\s+tests|tests? pass|fuzz|'
        r'invariant test|coverage)\b', re.I),
    'mentions_deployed': re.compile(
        r'\b(deployed (to|on|at)|live (on|at)|verified on|mainnet fork|testnet deployment|'
        r'is deployed)\b', re.I),
    'mentions_benchmark': re.compile(
        r'\b(benchmark|latency|throughput|gas cost|gas saving|faster than|reduced .{0,20}by \d)', re.I),
    'has_measurement': MEASURE_RE,
    'has_buzz': BUZZ_RE,
    'has_hedge': HEDGE_RE,
    'has_incomplete': INCOMPLETE_RE,
}


def flag_hits(r, flag, limit=6):
    """Distinct literal substrings that made `flag` fire, for eyeballing."""
    if flag not in _FLAG_RES:
        return []
    all_t = ' \n '.join([(r.get('tagline') or ''), (r.get('description') or ''),
                          (r.get('how_its_made') or '')])
    out, seen = [], set()
    for m in _FLAG_RES[flag].finditer(all_t):
        tok = m.group(0).strip()
        k = tok.lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(tok)
        if len(out) >= limit:
            break
    return out
