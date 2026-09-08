#!/usr/bin/env python3
"""
score-submission -- predict ETHGlobal's automated AI assessment for a draft
submission, and print ranked, measured edits that move it.

    python3 score_submission.py draft.md
    python3 score_submission.py draft.json --json
    python3 score_submission.py draft.md --repo /path/to/repo
    python3 score_submission.py --rubric

This is a REVERSE-ENGINEERED APPROXIMATION OF A BLACK BOX. See README.md.
Held-out accuracy of the text model is poor in absolute terms (CV R^2 ~0.20 for
technicality): use it to rank drafts against each other, never as a forecast of
the integer you will actually receive.

stdlib only: json / math / re / os / sys / argparse / subprocess.
"""

import json
import math
import os
import re
import sys
import argparse
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from subfeatures import (feats, winsorize, flag_hits, TARGETS, TARGET_NAME)  # noqa: E402

CAL_PATH = os.path.join(HERE, 'calibration.json')
RUBRIC_PATH = os.path.join(HERE, 'rubric.md')

# Observed ceilings on the 602 scored projects. No axis ever reached 10.
AXIS_MAX = 9
W = 78


# ---------------------------------------------------------------------------
# input
# ---------------------------------------------------------------------------

_HEAD_ALIASES = {
    'tagline': 'tagline', 'oneliner': 'tagline', 'onelinepitch': 'tagline',
    'shortdescription': 'tagline',
    'description': 'description', 'projectdescription': 'description',
    'about': 'description', 'whatitdoes': 'description',
    'howitsmade': 'how_its_made', 'howitismade': 'how_its_made',
    'howwebuiltit': 'how_its_made', 'howitwasmade': 'how_its_made',
    'howitsbuilt': 'how_its_made', 'technicaldescription': 'how_its_made',
}
_BOOL_ALIASES = {
    'hasrepo': 'has_repo', 'hassourcecode': 'has_repo', 'repo': 'has_repo',
    'sourcecodeurl': 'has_repo',
    'hasdemo': 'has_demo_url', 'hasdemourl': 'has_demo_url', 'demo': 'has_demo_url',
    'demourl': 'has_demo_url', 'livedemo': 'has_demo_url',
    'hasvideo': 'has_video', 'video': 'has_video', 'demovideo': 'has_video',
    'videourl': 'has_video',
}


def _norm(s):
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())


def _truthy(v):
    if isinstance(v, bool):
        return v
    if v is None:
        return False
    s = str(v).strip().lower()
    if s in ('true', 'yes', 'y', '1', 'on'):
        return True
    if s in ('false', 'no', 'n', '0', 'off', '', 'none', 'null'):
        return False
    return bool(s)  # a URL string counts as present


def parse_draft(path):
    """Accepts JSON or Markdown. Returns a dict with tagline / description /
    how_its_made / has_repo / has_demo_url / has_video / name."""
    raw = open(path, encoding='utf-8').read()
    d = {'tagline': '', 'description': '', 'how_its_made': '', 'name': '',
         'has_repo': False, 'has_demo_url': False, 'has_video': False}

    if path.lower().endswith('.json') or raw.lstrip().startswith('{'):
        j = json.loads(raw)
        for k, v in j.items():
            n = _norm(k)
            if n in _HEAD_ALIASES:
                d[_HEAD_ALIASES[n]] = v or ''
            elif n in _BOOL_ALIASES:
                d[_BOOL_ALIASES[n]] = _truthy(v)
            elif n in ('name', 'projectname', 'project'):
                d['name'] = v or ''
        return d

    body = raw
    # optional YAML-ish front matter
    m = re.match(r'^\s*---\s*\n(.*?)\n---\s*\n', raw, re.S)
    if m:
        for line in m.group(1).splitlines():
            if ':' not in line:
                continue
            k, v = line.split(':', 1)
            n = _norm(k)
            v = v.strip().strip('"\'')
            if n in _BOOL_ALIASES:
                d[_BOOL_ALIASES[n]] = _truthy(v)
            elif n in ('name', 'projectname', 'project'):
                d['name'] = v
            elif n in _HEAD_ALIASES:
                d[_HEAD_ALIASES[n]] = v
        body = raw[m.end():]

    # headings
    parts = re.split(r'(?m)^\s{0,3}#{1,6}\s*(.+?)\s*$', body)
    if len(parts) > 1:
        pre = parts[0]
        for i in range(1, len(parts) - 1, 2):
            head, txt = _norm(parts[i]), parts[i + 1].strip()
            if head in _HEAD_ALIASES:
                key = _HEAD_ALIASES[head]
                d[key] = (d[key] + '\n\n' + txt).strip() if d[key] else txt
            elif head in ('name', 'project', 'projectname') and not d['name']:
                d['name'] = txt.strip().splitlines()[0] if txt.strip() else ''
        if not any(d[k] for k in ('tagline', 'description', 'how_its_made')):
            d['description'] = pre.strip()
    else:
        # last resort: three blocks separated by a bare '---'
        chunks = [c.strip() for c in re.split(r'(?m)^\s*---\s*$', body)]
        chunks = [c for c in chunks if c]
        for k, c in zip(('tagline', 'description', 'how_its_made'), chunks):
            d[k] = c
    return d


# ---------------------------------------------------------------------------
# prediction
# ---------------------------------------------------------------------------

def load_cal(path=CAL_PATH):
    with open(path) as fh:
        return json.load(fh)


def set_event(f, cal, model, event):
    """'auto' leaves the event dummies at their corpus means (no fixed-effect
    contribution -- the honest default for an unknown future event)."""
    spec = cal['models'][model]
    g = dict(f)
    if event == 'auto':
        for k in ('ev_newyork', 'ev_lisbon', 'ev_cannes'):
            if k in spec['mu']:
                g[k] = spec['mu'][k]
    else:
        g['ev_newyork'] = 1.0 if event == 'newyork' else 0.0
        g['ev_lisbon'] = 1.0 if event == 'lisbon' else 0.0
        g['ev_cannes'] = 1.0 if event == 'cannes' else 0.0
    return g


def predict(f, cal, model='primary', event='auto'):
    spec = cal['models'][model]
    g = set_event(f, cal, model, event)
    bounds = {k: tuple(v) for k, v in cal['winsor'].items() if k in spec['feats']}
    gw, clamped = winsorize(g, bounds)
    out = {}
    for t in TARGETS:
        z = 0.0
        for k in spec['feats']:
            z += spec['beta'][t][k] * ((gw[k] - spec['mu'][k]) / spec['sd'][k])
        out[t] = max(1.0, min(float(AXIS_MAX), spec['intercept'][t] + z))
    out['sum'] = out['T'] + out['O'] + out['P']
    return out, clamped


def rnd(x):
    return int(math.floor(x + 0.5))


def int_total(pred):
    """The integer total ETHGlobal would publish: the sum of the three rounded
    axes, not the rounding of the continuous sum."""
    return rnd(pred['T']) + rnd(pred['O']) + rnd(pred['P'])


def band_of(total, cal):
    t = int(round(total))
    for lbl in ('<=17', '18-20', '21-23', '24-26'):
        if lbl not in cal['sum']['bands']:
            continue
        lo, hi = {'<=17': (0, 17), '18-20': (18, 20), '21-23': (21, 23),
                  '24-26': (24, 26)}[lbl]
        if lo <= t <= hi:
            return lbl, cal['sum']['bands'][lbl]
    return '24-26', cal['sum']['bands']['24-26']


def band_row(dose, key, value):
    for r in dose[key]:
        hi = r['hi'] if r['hi'] is not None else float('inf')
        if r['lo'] <= value < hi:
            return r
    return dose[key][-1]


# ---------------------------------------------------------------------------
# counterfactual edits
# ---------------------------------------------------------------------------

def _relen_hm(f, target):
    g = dict(f)
    delta = target - f['hm_chars']
    g['hm_chars'] = float(target)
    g['total_chars'] = f['total_chars'] + delta
    g['log_hm_chars'] = math.log10(target + 1)
    g['log_total_chars'] = math.log10(max(1.0, g['total_chars']) + 1)
    g['hm_share'] = target / max(1.0, f['desc_chars'] + target)
    return g


def _relen_desc(f, target):
    g = dict(f)
    delta = target - f['desc_chars']
    g['desc_chars'] = float(target)
    g['total_chars'] = f['total_chars'] + delta
    g['log_desc_chars'] = math.log10(target + 1)
    g['log_total_chars'] = math.log10(max(1.0, g['total_chars']) + 1)
    g['hm_share'] = f['hm_chars'] / max(1.0, target + f['hm_chars'])
    return g


def _setf(f, **kw):
    g = dict(f)
    g.update({k: float(v) for k, v in kw.items()})
    return g


def _next_milestone(cur, milestones):
    for m in milestones:
        if cur < m * 0.98:
            return m
    return None


def build_edits(f, cal):
    """Returns a list of candidate edits. Each is a dict with:
       key, title, action (what to literally do), how (concrete instruction),
       g (perturbed feature dict) or None for empirical-only edits,
       evidence (measured basis, with n)."""
    p = cal['percentiles']
    dose = cal['dose']
    bina = cal['binary']
    sat = cal['saturation_hm_per_1000ch']
    E = []

    def sat_slope(hm):
        for r in sat:
            if r['lo'] <= hm < r['hi']:
                return r
        return sat[-1]

    # --- 1. how_its_made length -------------------------------------------
    hm = f['hm_chars']
    tgt = _next_milestone(hm, [int(p['hm_chars']['p50']), int(p['hm_chars']['p75']),
                               int(p['hm_chars']['p90'])])
    cur_b = band_row(dose, 'hm_chars', hm)
    if tgt and hm < 3000:
        nxt_b = band_row(dose, 'hm_chars', tgt)
        s = sat_slope(hm)
        E.append(dict(
            key='hm_length',
            title='Lengthen how_its_made to %d chars (+%d)' % (tgt, tgt - hm),
            action='write %d more characters of how_its_made' % (tgt - hm),
            how=('Add mechanism detail, not adjectives: the exact instruction/contract you wrote, '
                 'the numbers you measured, the bug you hit and how you fixed it.'),
            g=_relen_hm(f, tgt),
            evidence=('measured slope inside the %d-%d char band: %+.2f technicality per +1000 chars '
                      '(n=%d). Band means: %d-%s chars -> T %.2f (n=%d); %d-%s chars -> T %.2f (n=%d).'
                      % (s['lo'], s['hi'], s['slope_T'], s['n'],
                         cur_b['lo'], cur_b['hi'], cur_b['mean_T'], cur_b['n'],
                         nxt_b['lo'], nxt_b['hi'], nxt_b['mean_T'], nxt_b['n']))))
    elif hm >= 2000:
        E.append(dict(
            key='hm_length_stop', title='STOP writing how_its_made', action=None, how=None, g=None,
            evidence=('you are at %d chars. Measured marginal value of the next +1000 chars in the '
                      '2000-3000 band is %+.3f technicality (n=%d), and %+.3f in the 5000+ band (n=%d). '
                      'Length has saturated; spend the effort on the repo instead.'
                      % (hm, sat[2]['slope_T'], sat[2]['n'], sat[-1]['slope_T'], sat[-1]['n']))))

    # --- 2. named technologies ---------------------------------------------
    nt = f['n_tech_distinct']
    tgt = _next_milestone(nt, [int(p['n_tech_distinct']['p50']), int(p['n_tech_distinct']['p75']),
                               int(p['n_tech_distinct']['p90']), 21])
    if tgt:
        cb = band_row(dose, 'n_tech_distinct', nt)
        nb = band_row(dose, 'n_tech_distinct', tgt)
        E.append(dict(
            key='tech_names',
            title='Name %d more distinct technologies (%d -> %d)' % (tgt - nt, nt, tgt),
            action='name %d more protocols / chains / libraries / standards by their proper name'
                   % (tgt - nt),
            how=('Spell out every dependency you actually used: chain, RPC, test framework, '
                 'client library, token standard, the sponsor protocol and its version. '
                 'Field median is %d distinct, p75 is %d, p90 is %d.'
                 % (int(p['n_tech_distinct']['p50']), int(p['n_tech_distinct']['p75']),
                    int(p['n_tech_distinct']['p90']))),
            g=_setf(f, n_tech_distinct=tgt,
                    tech_per_100w=f['tech_per_100w'] + 100.0 * (tgt - nt) / max(1.0, f['total_words'])),
            evidence=('dose-response: %d-%s techs -> T %.2f, P(T=9) %.1f%% (n=%d); '
                      '%d-%s techs -> T %.2f, P(T=9) %.1f%% (n=%d). Strongest length-independent '
                      'text feature in the study.'
                      % (cb['lo'], cb['hi'], cb['mean_T'], 100 * cb['p_T9'], cb['n'],
                         nb['lo'], nb['hi'], nb['mean_T'], 100 * nb['p_T9'], nb['n']))))

    # --- 3. demo video ------------------------------------------------------
    if f['has_video'] < 0.5:
        b = bina['has_video']
        E.append(dict(
            key='video', title='Upload a demo video', action='record and upload the demo video',
            how='ETHGlobal sets demoVideoReady when a video is attached. It is a presence flag: '
                'in 602 observations it was true 509 times and false zero times.',
            g=_setf(f, has_video=1.0, n_artifacts=f['n_artifacts'] + 1),
            evidence=('with video T %.2f (n=%d) vs without T %.2f (n=%d), diff %+.2f (SE %.2f, d %.2f). '
                      'Length-controlled diff %+.2f. Confounded with team completeness, so treat as '
                      'an upper bound -- but it is also the biggest WINNING lever in the study.'
                      % (b['T']['mean_with'], b['n_with'], b['T']['mean_without'], b['n_without'],
                         b['T']['diff'], b['T']['se'], b['T']['d'],
                         b['length_controlled']['T'] or 0.0))))

    # --- 4/5/6. presence flags that are in the model ------------------------
    for key, flagname, title, how in [
        ('tests', 'mentions_tests', 'Say the test suite out loud',
         'Write the literal phrase: "N Foundry tests", "fuzz", "invariant", "test suite", '
         '"coverage", "mainnet fork". The scorer keys on the words, not on your CI badge.'),
        ('deployed', 'mentions_deployed', 'Say where it is deployed / running',
         'Write "deployed on <chain>", "verified on <explorer>", "mainnet fork", '
         '"live at <address>". Name the network and the address.'),
        ('numbers', 'has_numbers', 'Put at least one concrete number in the text',
         'Gas measured, bytes of bytecode, error bound, test count, latency, notional. '
         'Any digit at all -- the feature is presence, not quantity.'),
        ('mechanism_open', 'opens_mechanism', 'Open the description with a mechanism sentence',
         'First sentence shaped "<Name> is a <router / contract / VM instruction / circuit> that "'
         '-- not a problem statement and not a benefit claim.'),
    ]:
        if f[flagname] < 0.5:
            b = bina[flagname]
            E.append(dict(
                key=key, title=title, action=title.lower(), how=how,
                g=_setf(f, **{flagname: 1.0}),
                evidence=('with %.2f (n=%d) vs without %.2f (n=%d) on technicality, diff %+.2f '
                          '(SE %.2f, p %.1e). Length-controlled diff %+.2f across %d quartiles.'
                          % (b['T']['mean_with'], b['n_with'], b['T']['mean_without'],
                             b['n_without'], b['T']['diff'], b['T']['se'], b['T']['p'],
                             b['length_controlled']['T'] if b['length_controlled']['T'] is not None else 0.0,
                             b['length_controlled']['T_quartiles']))))

    # --- 7. code identifiers ------------------------------------------------
    ci = f['n_codeids']
    tgt = _next_milestone(ci, [int(p['n_codeids']['p50']), int(p['n_codeids']['p75']),
                               int(p['n_codeids']['p90'])])
    if tgt and band_row(dose, 'n_codeids', tgt) is not band_row(dose, 'n_codeids', ci):
        cb = band_row(dose, 'n_codeids', ci)
        nb = band_row(dose, 'n_codeids', tgt)
        E.append(dict(
            key='codeids',
            title='Add %d more code identifiers (%d -> %d)' % (tgt - ci, ci, tgt),
            action='name %d more files, contracts, functions, opcodes or addresses' % (tgt - ci),
            how=('Backticked file paths (`src/RmmSwap.sol`), CamelCase contract names, '
                 'function names with parens, 0x addresses, EIP/ERC numbers, version strings.'),
            g=_setf(f, n_codeids=tgt),
            evidence=('band %d-%s -> T %.2f (n=%d); band %d-%s -> T %.2f (n=%d). NOTE: in the '
                      'study this feature collapses to partial r=+0.05 once length is controlled -- '
                      'it is largely a length proxy, so the model gain here is soft.'
                      % (cb['lo'], cb['hi'], cb['mean_T'], cb['n'],
                         nb['lo'], nb['hi'], nb['mean_T'], nb['n']))))

    # --- 8. buzzwords -------------------------------------------------------
    if f['n_buzz'] > 0:
        b = bina['has_buzz']
        grad = '; '.join('%.1f-%s/100w O %.2f (n=%d)'
                         % (r['lo'], r['hi'] if r['hi'] is not None else '+', r['mean_O'], r['n'])
                         for r in dose['buzz_per_100w'])
        E.append(dict(
            key='buzz', title='Delete all %d buzzword%s' % (int(f['n_buzz']),
                                                             '' if f['n_buzz'] == 1 else 's'),
            action='delete every buzzword',
            how=('Words the study counts: seamless, revolutionary, empower, unlock, leverage, '
                 'cutting-edge, frictionless, robust, innovative, ecosystem, powerful, harness, '
                 'redefine, reimagine, magic, beautiful, all-in-one, state-of-the-art.'),
            g=_setf(f, n_buzz=0.0, buzz_per_100w=0.0, has_buzz=0.0),
            evidence=('originality by buzzword density: %s. Any-buzzword vs none: O %.2f (n=%d) vs '
                      '%.2f (n=%d), diff %+.2f, length-controlled %+.2f. Buzzwords are the only '
                      'decisive negative in the study and they bite hardest on originality.'
                      % (grad, b['O']['mean_with'], b['n_with'], b['O']['mean_without'],
                         b['n_without'], b['O']['diff'],
                         b['length_controlled']['O'] if b['length_controlled']['O'] is not None else 0.0))))

    # --- 9. hedges ----------------------------------------------------------
    if f['n_hedge'] > 0:
        b = bina['has_hedge']
        E.append(dict(
            key='hedge', title='Delete all %d hedge%s' % (int(f['n_hedge']),
                                                          '' if f['n_hedge'] == 1 else 's'),
            action='delete "aims to" / "would allow" / "plans to" / "in the future"',
            how=('Hedging about what the thing IS costs points. Admitting what is INCOMPLETE does '
                 'not -- "not yet audited", "mocked for the demo" measured +0.20 technicality. '
                 'Say the second, never the first.'),
            g=_setf(f, n_hedge=0.0, has_hedge=0.0),
            evidence=('with hedges T %.2f (n=%d) vs without %.2f (n=%d), diff %+.2f; '
                      'length-controlled %+.2f.'
                      % (b['T']['mean_with'], b['n_with'], b['T']['mean_without'], b['n_without'],
                         b['T']['diff'],
                         b['length_controlled']['T'] if b['length_controlled']['T'] is not None else 0.0))))

    # --- 9b. state the limitation ------------------------------------------
    if f['n_incomplete'] < 1:
        b = bina['has_incomplete']
        E.append(dict(
            key='incomplete',
            title='State plainly what is NOT built, and what the design refuses to do',
            action='name the limitation in the text',
            how=('"not yet audited", "mocked for the demo", "single-maker for now", "the guard '
                 'reverts rather than clamping". Say what the thing IS without hedging, then say '
                 'what it does not do.'),
            g=_setf(f, n_incomplete=1.0, has_incomplete=1.0),
            evidence=('counterintuitive but measured: projects that admit incompleteness score '
                      'T %.2f (n=%d) vs %.2f (n=%d), diff %+.2f, length-controlled %+.2f. '
                      'Admitting incompleteness does not cost you; hedging about what the thing '
                      'IS does (that is a different feature, and it is negative).'
                      % (b['T']['mean_with'], b['n_with'], b['T']['mean_without'], b['n_without'],
                         b['T']['diff'],
                         b['length_controlled']['T'] if b['length_controlled']['T'] is not None else 0.0))))

    # --- 10. description length --------------------------------------------
    dc = f['desc_chars']
    tgt = _next_milestone(dc, [int(p['desc_chars']['p50']), int(p['desc_chars']['p75'])])
    if tgt and dc < 1700:
        E.append(dict(
            key='desc_length',
            title='Lengthen description to %d chars (+%d)' % (tgt, tgt - dc),
            action='write %d more characters of description' % (tgt - dc),
            how='State the mechanism, the user, and the specific claim. Field median is %d chars, '
                'p75 is %d.' % (int(p['desc_chars']['p50']), int(p['desc_chars']['p75'])),
            g=_relen_desc(f, tgt),
            evidence='description length Spearman vs technicality %+.3f, vs sum %+.3f (n=%d).'
                     % (cal['spearman']['desc_chars']['T'],
                        (cal['spearman']['desc_chars']['T'] + cal['spearman']['desc_chars']['O']
                         + cal['spearman']['desc_chars']['P']) / 3.0, cal['meta']['n_scored'])))

    # --- 11. technical-noun density ----------------------------------------
    tn = f['technoun_per_100w']
    if tn < p['technoun_per_100w']['p75']:
        E.append(dict(
            key='technoun',
            title='Raise technical-noun density to %.1f per 100 words (now %.1f)'
                  % (p['technoun_per_100w']['p75'], tn),
            action='use more system vocabulary per sentence',
            how=('Words like: opcode, calldata, invariant, fuzz, router, settlement, curve, '
                 'reserve, bytecode, fork, mainnet, revert, allowance. Replace abstract nouns '
                 '("solution", "experience") with the thing itself.'),
            g=_setf(f, technoun_per_100w=p['technoun_per_100w']['p75']),
            evidence='Spearman vs technicality %+.3f (n=%d); length-controlled partial r in the '
                     'study was +0.24.' % (cal['spearman']['technoun_per_100w']['T'],
                                           cal['meta']['n_scored'])))

    # --- empirical-only (not in the model, measured univariately) ----------
    for key, flagname, title, how in [
        ('measurement', 'has_measurement', 'Quote at least one MEASURED quantity with a unit',
         '"657k gas", "5e-12 error", "23,966 bytes", "89 tests". A number with a unit, not a claim.'),
        ('filepath', 'has_filepath', 'Name at least one real source file or path',
         'e.g. `contracts/src/instructions/RmmSwap.sol`, `/src/`, `/contracts/`.'),
        ('address', 'has_address', 'Include a real 0x address',
         'The deployed router, the official registry, the token you filled against.'),
        ('benchmark', 'mentions_benchmark', 'State a benchmark / gas cost / latency',
         'The words the study matches: benchmark, latency, throughput, gas cost, gas saving.'),
    ]:
        if f[flagname] < 0.5:
            b = bina[flagname]
            if b['T'] is None:
                continue
            E.append(dict(
                key=key, title=title + '  [not in the model]', action=title.lower(), how=how,
                g=None, lc_T=(b['length_controlled']['T'] or 0.0),
                evidence=('univariate: with %.2f (n=%d) vs without %.2f (n=%d), diff %+.2f '
                          '(SE %.2f). Length-controlled %+.2f. Not a model feature, so no point '
                          'estimate is claimed -- treat as a tiebreak.'
                          % (b['T']['mean_with'], b['n_with'], b['T']['mean_without'],
                             b['n_without'], b['T']['diff'], b['T']['se'],
                             b['length_controlled']['T'] if b['length_controlled']['T'] is not None else 0.0))))

    # named-artifact count (the replica study's N) --------------------------
    na = f['n_named_artifacts_hm']
    nb_cur = band_row(dose, 'n_named_artifacts_hm', na)
    tgt = _next_milestone(na, [3, 8, 15])
    if tgt:
        nb = band_row(dose, 'n_named_artifacts_hm', tgt)
        E.append(dict(
            key='named_artifacts', lc_T=nb['mean_T'] - nb_cur['mean_T'],
            title='Raise named-artifact count in how_its_made to %d (now %d)  [not in the model]'
                  % (tgt, int(na)),
            action='name %d more look-up-able artifacts inside how_its_made' % (tgt - int(na)),
            how=('Things a judge could go find: `RmmSwap.sol`, `Opcode._55`, `Aqua.safeBalances`, '
                 'EIP-170, 0x1111113ccf..., "Solidity 0.8.24". Bare stack names do not count.'),
            g=None,
            evidence=('band %d-%s -> T %.2f, min T observed %d (n=%d); band %d-%s -> T %.2f, '
                      'min T observed %d (n=%d). This is a FLOOR, not a driver: it raises the '
                      'worst case, it does not buy a 9.'
                      % (nb_cur['lo'], nb_cur['hi'], nb_cur['mean_T'], nb_cur['min_T'], nb_cur['n'],
                         nb['lo'], nb['hi'], nb['mean_T'], nb['min_T'], nb['n']))))
    return E


def score_edits(f, cal, edits, event='auto'):
    base, _ = predict(f, cal, 'primary', event)
    out = []
    for e in edits:
        row = dict(e)
        if e.get('g') is not None:
            p, _ = predict(e['g'], cal, 'primary', event)
            row['delta'] = {t: p[t] - base[t] for t in TARGETS}
            row['delta']['sum'] = p['sum'] - base['sum']
            row['after'] = p
        else:
            row['delta'] = None
        out.append(row)
    return base, out


# ---------------------------------------------------------------------------
# repo shape (NOT part of the model -- reported because the study found it
# out-predicts every text feature)
# ---------------------------------------------------------------------------

# measured on a stratified sample of 122 repos of scored projects
# (scratchpad/aiscore/rubric.md; stratification inflates |rho|, read the ordering)
REPO_BUCKETS = [
    ('T<=7', 39, 41, 12.6, 4.4, 0.31, 0.03),
    ('T==8', 39, 205, 16.0, 6.3, 0.41, 0.03),
    ('T==9', 44, 207, 20.6, 9.1, 0.59, 0.16),
]


def repo_shape(path):
    r = {'path': path}
    try:
        r['commits'] = int(subprocess.check_output(
            ['git', '-C', path, 'rev-list', '--count', 'HEAD'],
            stderr=subprocess.DEVNULL).decode().strip())
    except Exception:
        r['commits'] = None
    try:
        entries = [e for e in os.listdir(path) if not e.startswith('.')]
    except Exception:
        return r
    r['root_entries'] = len(entries)
    r['root_dirs'] = sum(1 for e in entries if os.path.isdir(os.path.join(path, e)))
    low = [e.lower() for e in entries]
    r['has_readme'] = any(e.startswith('readme') for e in low)
    r['has_contracts_dir'] = any(e in ('contracts', 'contract', 'src') and
                                 os.path.isdir(os.path.join(path, e)) for e in low)
    r['has_foundry_root'] = 'foundry.toml' in low
    r['has_hardhat_root'] = any(e.startswith('hardhat.config') for e in low)
    try:
        authors = subprocess.check_output(
            ['git', '-C', path, 'log', '--format=%ae'], stderr=subprocess.DEVNULL).decode().split()
        r['authors'] = len(set(authors))
    except Exception:
        r['authors'] = None
    return r


# ---------------------------------------------------------------------------
# rendering
# ---------------------------------------------------------------------------

def hr(ch='-'):
    return ch * W


def head(t):
    return '\n' + hr('=') + '\n' + t + '\n' + hr('=')


def wrap(s, indent=6, width=W):
    words = s.split()
    lines, cur = [], ''
    for w in words:
        if len(cur) + len(w) + 1 > width - indent:
            lines.append(cur)
            cur = w
        else:
            cur = (cur + ' ' + w).strip()
    if cur:
        lines.append(cur)
    return '\n'.join(' ' * indent + l for l in lines)


def render(draft, f, cal, base, edits, event, clamped, repo=None):
    L = []
    n = cal['meta']['n_scored']
    A = L.append

    A(head('ETHGLOBAL AUTO-ASSESSMENT PREDICTION'))
    A('draft: %s' % (draft.get('_path') or '(stdin)'))
    A('model: %s' % cal['models']['primary']['name'])
    A('fitted on n=%d scored projects from %s' % (n, ', '.join(cal['meta']['events'])))
    A('event fixed effect: %s' % ('corpus mean (unknown future event)' if event == 'auto' else event))
    if f['total_chars'] < 400 or not f.get('how_its_made_present', 1.0):
        A('')
        A('  !! THIS DRAFT IS BELOW THE CORPUS FLOOR (%d total chars; the thinnest scored project'
          % int(f['total_chars']))
        A('     in the corpus has %d). Features are clamped to the corpus range before predicting,'
          % int(cal['winsor_total_chars_min']))
        A('     so the numbers below are NOT meaningful for a draft this thin -- they are the')
        A('     prediction for the thinnest real submission, not for yours. Write the draft first.')

    # ---- prediction --------------------------------------------------------
    A(head('1. PREDICTED SCORES'))
    alt, _ = predict(f, cal, 'alloc', event)
    dist = cal['dist']
    for t in TARGETS:
        c = dist[t]['counts']
        tot = sum(c.values())
        modal = dist[t]['mode']
        pct_at = 100.0 * c.get(str(rnd(base[t])), 0) / tot
        A('  %-18s %.2f   -> %d      (field mean %.2f, mode %d, %.0f%% of the field '
          'scores %d)' % (TARGET_NAME[t], base[t], rnd(base[t]), dist[t]['mean'], modal,
                          pct_at, rnd(base[t])))
    A('  %-18s %.2f   -> %d' % ('TOTAL', base['sum'], rnd(base['T']) + rnd(base['O']) + rnd(base['P'])))
    pinned = [TARGET_NAME[t] for t in TARGETS if base[t] >= 8.999 or base[t] <= 1.001]
    if pinned:
        A('  (%s is pinned at the observed ceiling of 9 -- the raw linear prediction ran past'
          % ', '.join(pinned))
        A('   the top of the scale, so the model has nothing left to say on that axis.)')
    A('')
    A('  second model (%s):' % cal['models']['alloc']['name'])
    A('      T %.2f   O %.2f   P %.2f   sum %.2f' % (alt['T'], alt['O'], alt['P'], alt['sum']))
    spread = max(abs(alt[t] - base[t]) for t in TARGETS)
    if spread > 0.40:
        A('  !! the two models disagree by %.2f on some axis -- the point estimate is soft.' % spread)

    it = int_total(base)
    lbl, bd = band_of(it, cal)
    A('')
    A('  WIN-RATE BAND: total %d falls in band %s -- n=%d, %.1f%% of that band won a prize.'
      % (it, lbl, bd['n'], 100 * bd['win']))
    A('  All measured bands (%d scored projects, %.1f%% won overall):' % (n, 100 * cal['sum']['overall_win']))
    for k in ('<=17', '18-20', '21-23', '24-26'):
        if k in cal['sum']['bands']:
            b = cal['sum']['bands'][k]
            A('      %-7s n=%-4d win %.1f%%%s' % (k, b['n'], 100 * b['win'],
                                                  '   <-- you' if k == lbl else ''))
    A('  It is a FLOOR, not a ladder: the jump is 18-20 -> 21-23, then it flattens.')
    ex = cal['sum']['exact']
    near = [str(s) for s in range(it - 1, it + 2) if str(s) in ex]
    A('  Neighbouring exact totals: ' + '; '.join(
        '%s -> %.0f%% (n=%d)' % (s, 100 * ex[s]['win'], ex[s]['n']) for s in near))
    mae = cal['models']['primary']['cv_mae']
    lo = sum(rnd(max(1.0, base[t] - mae[t])) for t in TARGETS)
    hi = sum(rnd(min(9.0, base[t] + mae[t])) for t in TARGETS)
    llo, blo = band_of(lo, cal)
    lhi, bhi = band_of(hi, cal)
    A('  UNCERTAINTY: at +/- one held-out CV MAE per axis (%.2f / %.2f / %.2f) this draft is'
      % (mae['T'], mae['O'], mae['P']))
    A('  consistent with totals %d (band %s, win %.0f%%) through %d (band %s, win %.0f%%).'
      % (lo, llo, 100 * blo['win'], hi, lhi, 100 * bhi['win']))
    if abs(base['sum'] - it) >= 0.6:
        A('  NOTE: the continuous sum is %.2f but the three axes round UP to %d. Rounding is'
          % (base['sum'], it))
        A('  compounding in your favour here -- read the continuous numbers, not the integer.')

    if clamped:
        A('')
        A('  NOTE: %d feature(s) were clamped to the observed corpus [min, max] range '
          'before predicting (the linear model must not be extrapolated):' % len(clamped))
        for k, raw, cl in clamped:
            A('      %-22s %.2f -> %.2f' % (k, raw, cl))

    # ---- where the draft sits ---------------------------------------------
    A(head('2. WHERE THIS DRAFT SITS IN THE FIELD (n=%d)' % n))
    p = cal['percentiles']
    rows = [('tagline chars', 'tagline_chars'), ('description chars', 'desc_chars'),
            ('how_its_made chars', 'hm_chars'), ('total chars', 'total_chars'),
            ('distinct technologies', 'n_tech_distinct'),
            ('named artifacts (hm)', 'n_named_artifacts_hm'),
            ('technical nouns /100w', 'technoun_per_100w'),
            ('code identifiers', 'n_codeids'), ('numbers', 'n_numbers'),
            ('buzzwords', 'n_buzz'), ('hedges', 'n_hedge')]
    A('  %-24s %8s | %6s %6s %6s %6s %6s' % ('feature', 'yours', 'p10', 'p25', 'p50', 'p75', 'p90'))
    for label, k in rows:
        if k not in p:
            A('  %-24s %8.1f | %s' % (label, f[k], '(no percentile table)'))
            continue
        q = p[k]
        A('  %-24s %8.1f | %6.0f %6.0f %6.0f %6.0f %6.0f'
          % (label, f[k], q['p10'], q['p25'], q['p50'], q['p75'], q['p90']))
    A('')
    A('  Empirical peer bands your draft falls into (these are raw group means, not the model):')
    for key, label in [('hm_chars', 'how_its_made length'),
                       ('n_tech_distinct', 'distinct technologies'),
                       ('n_named_artifacts_hm', 'named artifacts in how_its_made')]:
        b = band_row(cal['dose'], key, f[key])
        A('      %-32s %s-%s: T %.2f  O %.2f  P %.2f  sum %.2f  (n=%d, %.0f%% won)'
          % (label, b['lo'], b['hi'] if b['hi'] is not None else '+', b['mean_T'], b['mean_O'],
             b['mean_P'], b['mean_sum'], b['n'], 100 * b['win']))
    bandmean = sum(band_row(cal['dose'], k, f[k])['mean_sum']
                   for k in ('hm_chars', 'n_tech_distinct', 'n_named_artifacts_hm')) / 3.0
    A('      %-32s %.2f   (vs model %.2f)' % ('band-consensus total', bandmean, base['sum']))
    A('  Flags: %s' % ', '.join(
        '%s=%s' % (k, 'Y' if f[k] >= 0.5 else 'n') for k in
        ('has_repo', 'has_demo_url', 'has_video', 'mentions_tests', 'mentions_deployed',
         'has_numbers', 'has_measurement', 'has_filepath', 'has_address', 'opens_mechanism',
         'has_incomplete', 'has_hedge', 'has_buzz')))
    prov = [(k, flag_hits(draft, k)) for k in
            ('mentions_tests', 'mentions_deployed', 'mentions_benchmark', 'has_measurement',
             'has_buzz', 'has_hedge', 'has_incomplete')]
    prov = [(k, v) for k, v in prov if v]
    if prov:
        A('  What made each keyword flag fire (check these for false positives -- the matchers')
        A('  are keyword-based, so a proper noun containing a keyword will trip one):')
        for k, v in prov:
            A('      %-20s %s' % (k, ', '.join(repr(x) for x in v)))

    # ---- ranked edits ------------------------------------------------------
    A(head('3. RANKED EDITS (predicted point gain, measured basis)'))
    modelled = [e for e in edits if e['delta'] is not None and e['delta']['sum'] > 0.005]
    modelled.sort(key=lambda e: -e['delta']['sum'])
    emp_all = [e for e in edits if e['delta'] is None and e.get('action')]
    emp_all.sort(key=lambda e: -e.get('lc_T', 0.0))
    empirical = [e for e in emp_all if e.get('lc_T', 0.0) > 0.02]
    emp_dead = [e for e in emp_all if e.get('lc_T', 0.0) <= 0.02]
    negative = [e for e in edits if e['delta'] is not None and e['delta']['sum'] <= 0.005]

    if not modelled:
        A('  (no modelled edit improves the prediction -- see section 4)')
    for i, e in enumerate(modelled, 1):
        d = e['delta']
        A('')
        A('  %d. %s' % (i, e['title']))
        A('     predicted  T %+.3f   O %+.3f   P %+.3f   SUM %+.3f'
          % (d['T'], d['O'], d['P'], d['sum']))
        if e.get('how'):
            A(wrap('DO: ' + e['how'], 5))
        A(wrap('WHY: ' + e['evidence'], 5))

    if empirical:
        A('')
        A(hr())
        A('  MEASURED BUT NOT IN THE MODEL (no point estimate; measured group differences):')
        for e in empirical:
            A('')
            A('   * %s' % e['title'])
            if e.get('how'):
                A(wrap('DO: ' + e['how'], 5))
            A(wrap('WHY: ' + e['evidence'], 5))

    stops = [e for e in edits if e['key'].endswith('_stop')]
    A('')
    A(hr())
    A('  MEASURED NOT TO HELP (do not spend time here):')
    if stops or negative or emp_dead:
        for e in stops:
            A('')
            A('   x %s' % e['title'])
            A(wrap(e['evidence'], 5))
        for e in negative:
            A('')
            A('   x %s  -- model delta SUM %+.3f' % (e['title'], e['delta']['sum']))
            A(wrap(e['evidence'], 5))
        for e in emp_dead:
            A('')
            A('   x %s  -- does not survive length control (%+.2f T)'
              % (e['title'].replace('  [not in the model]', ''), e.get('lc_T', 0.0)))
            A(wrap(e['evidence'], 5))

    # standing "do not bother" list, measured
    A('')
    du = cal['binary']['has_demo_url']
    A(wrap('x Add a live demo URL for the SCORER. With one T %.2f (n=%d) vs without %.2f (n=%d), '
           'diff %+.2f (SE %.2f); the fitted weight is NEGATIVE. The assessor does not visit it.'
           % (du['T']['mean_with'], du['n_with'], du['T']['mean_without'], du['n_without'],
              du['T']['diff'], du['T']['se']), 3))
    A(wrap('x Improve readability. Flesch vs technicality Spearman %+.3f; words-per-sentence %+.3f. '
           'Indistinguishable from zero.'
           % (cal['spearman']['flesch']['T'], cal['spearman']['words_per_sentence']['T']), 3))
    A(wrap('x Chase a 10, an originality 9 or a practicality 9. Max observed on any axis in %d '
           'observations is 9; originality 9 n=%d, practicality 9 n=%d. Practicality is '
           'unoptimisable: %.0f%% of the field scores 7 or 8.'
           % (n, cal['dist']['O']['counts'].get('9', 0), cal['dist']['P']['counts'].get('9', 0),
              100.0 * (cal['dist']['P']['counts'].get('7', 0) + cal['dist']['P']['counts'].get('8', 0)) / n), 3))
    ic = cal['binary']['has_incomplete']
    A(wrap('x Hide that something is unfinished. "not yet" / "mocked" / "time constraints" measured '
           '%+.2f technicality (n=%d with, %d without) -- admitting incompleteness does not cost '
           'you. Hedging about what the thing IS does.'
           % (ic['T']['diff'], ic['n_with'], ic['n_without']), 3))

    # ---- the unmodelled lever ---------------------------------------------
    A(head('4. THE LEVER THIS MODEL CANNOT SEE: YOUR REPOSITORY'))
    A('  The companion study found the scorer reads the linked repositories: 12-16% of')
    A('  autoSummary strings name a technology that appears NOWHERE in the submitted text,')
    A('  and low scorers get summaries describing repo contents ("a minimal Turborepo/')
    A('  TypeScript scaffold with no application source code", technicality 2).')
    A('')
    A('  Measured on a stratified sample of 122 repos (stratified 45/45/45 by technicality,')
    A('  which INFLATES the correlations -- read the ordering, not the magnitudes):')
    A('     %-8s %5s %9s %14s %11s %10s %9s' % ('bucket', 'n', 'commits', 'root entries',
                                                'root dirs', 'contracts/', 'foundry'))
    for lbl, nn, cm, re_, rd, cd, fd in REPO_BUCKETS:
        A('     %-8s %5d %9d %14.1f %11.1f %9.0f%% %8.0f%%' % (lbl, nn, cm, re_, rd, 100 * cd, 100 * fd))
    A('     Spearman vs technicality: commits +0.533, root_dirs +0.527, root_entries +0.408,')
    A('     has_contracts_dir +0.246, has_foundry +0.218, has_hardhat -0.140.')
    if repo:
        A('')
        A('  YOUR REPO (%s):' % repo['path'])
        A('     commits          %s' % repo.get('commits'))
        A('     root entries     %s   (non-hidden)' % repo.get('root_entries'))
        A('     root directories %s' % repo.get('root_dirs'))
        A('     root README      %s' % ('yes' if repo.get('has_readme') else 'NO'))
        A('     contracts/ or src/  %s' % ('yes' if repo.get('has_contracts_dir') else 'no'))
        A('     foundry.toml root %s' % ('yes' if repo.get('has_foundry_root') else 'no'))
        A('     distinct authors %s' % repo.get('authors'))
        warn = []
        if repo.get('commits') is not None and repo['commits'] < 20:
            warn.append('%d commits is far below every measured bucket (T<=7 mean 41, T=9 mean 207) '
                        'AND is the exact shape that fires ETHGlobal\'s own screener flag '
                        '"Too few commits (N)" from checkProjectRepositoriesForGithubRules.'
                        % repo['commits'])
        if not repo.get('has_readme'):
            warn.append('no root README. 95 percent of the 121 scraped repos have one.')
        if repo.get('root_dirs') is not None and repo['root_dirs'] < 6:
            warn.append('%d root directories vs 6.3 for T=8 and 9.1 for T=9 repos.'
                        % repo['root_dirs'])
        for wq in warn:
            A(wrap('!! ' + wq, 5))
    A('')
    A('  Not measurable from text, and not in any model here:')
    A('   - ETHGlobal runs checkProjectRepositoriesForGithubRules on every linked repo and shows a')
    A('     human screener flags for tooFewCommits / tooManyLinesChangedPerCommit /')
    A('     firstCommitTooOld / lastCommitTooRecent / tooManyCommitAuthors / isFork.')
    A('   - Promotion out of round-1 screening is gated on sum(videoQuality, submissionQuality,')
    A('     projectQuality) >= 10, three human 1-10 stars. That gate is upstream of everything here.')
    A('   - The auto score is computed ONCE at the submission cutoff and never recomputed, and')
    A('     your own dashboard cannot read it. There is no iteration loop after the deadline.')

    A(head('5. HEALTH WARNING'))
    m = cal['models']['primary']
    A('  Held-out 5-fold CV on the same n=%d it was fitted on:' % n)
    for t in TARGETS:
        A('     %-18s MAE %.3f  (predict-the-mean MAE %.3f)   R^2 %.3f'
          % (TARGET_NAME[t], m['cv_mae'][t], m['baseline_mae'][t], m['cv_r2'][t]))
    A('  That is a %.0f%% improvement on guessing the field mean, and it leaves %.0f%% of'
      % (100 * (1 - m['cv_mae']['T'] / m['baseline_mae']['T']), 100 * (1 - m['cv_r2']['T'])))
    A('  technicality variance unexplained by anything in your text -- because the biggest')
    A('  input to the real scorer is your repository, which section 4 covers and no model here')
    A('  can price.')
    A('  Use this to RANK two drafts of the same project. Do not report the integer as a forecast.')
    A('  Run  --rubric  for the qualitative pass a human or an agent should also do.')
    return '\n'.join(L)


# ---------------------------------------------------------------------------
# self-test: does the shipped calibration.json still reproduce the study's
# published headline numbers?
# ---------------------------------------------------------------------------

def self_test(cal):
    ok = True

    def chk(label, got, want, tol):
        nonlocal ok
        good = abs(got - want) <= tol
        ok = ok and good
        print('  [%s] %-52s got %-10s want %s' % ('OK ' if good else 'FAIL', label,
                                                  round(got, 4), want))

    print('calibration.json self-test (n=%d)' % cal['meta']['n_scored'])
    chk('corpus size', cal['meta']['n_scored'], 602, 0)
    for t, want in (('T', 7.759), ('O', 7.203), ('P', 7.532)):
        chk('mean %s' % t, cal['dist'][t]['mean'], want, 0.002)
    for t, want in (('T', 8), ('O', 7), ('P', 8)):
        chk('mode %s' % t, cal['dist'][t]['mode'], want, 0)
        chk('max %s (no 10 anywhere)' % t, cal['dist'][t]['max'], 9, 0)
    for lbl, n, win in (('18-20', 50, 0.080), ('21-23', 401, 0.352), ('24-26', 137, 0.460)):
        chk('band %s n' % lbl, cal['sum']['bands'][lbl]['n'], n, 0)
        chk('band %s win rate' % lbl, cal['sum']['bands'][lbl]['win'], win, 0.001)
    sat = {(r['lo'], r['hi']): r for r in cal['saturation_hm_per_1000ch']}
    chk('how_its_made slope 0-1000 (T/1000ch)', sat[(0, 1000)]['slope_T'], 1.314, 0.01)
    chk('how_its_made slope 1000-2000', sat[(1000, 2000)]['slope_T'], 0.224, 0.01)
    chk('how_its_made slope 2000-3000', sat[(2000, 3000)]['slope_T'], 0.000, 0.01)
    chk('how_its_made slope 5000+', sat[(5000, 20000)]['slope_T'], -0.131, 0.01)
    m = cal['models']['primary']
    for t in TARGETS:
        chk('%s beats predict-the-mean' % TARGET_NAME[t],
            1.0 if m['cv_mae'][t] < m['baseline_mae'][t] else 0.0, 1.0, 0)

    # parser + predictor round-trip
    import tempfile
    md = ("---\nhas_repo: true\nhas_video: true\nhas_demo: false\n---\n"
          "## Tagline\nT\n## Description\nD\n## How it's made\nH\n")
    js = json.dumps({'tagline': 'T', 'description': 'D', 'howItsMade': 'H',
                     'hasRepo': True, 'hasVideo': True, 'hasDemo': False})
    with tempfile.TemporaryDirectory() as td:
        pm, pj = os.path.join(td, 'a.md'), os.path.join(td, 'a.json')
        open(pm, 'w').write(md)
        open(pj, 'w').write(js)
        dm, dj = parse_draft(pm), parse_draft(pj)
        same = all(dm[k] == dj[k] for k in ('tagline', 'description', 'how_its_made',
                                            'has_repo', 'has_video', 'has_demo_url'))
        chk('markdown and json parsers agree', 1.0 if same else 0.0, 1.0, 0)
        pr, _ = predict(feats(dm), cal, 'primary', 'auto')
        inrange = all(1.0 <= pr[t] <= 9.0 for t in TARGETS)
        chk('predictions inside the observed 1-9 range', 1.0 if inrange else 0.0, 1.0, 0)
    print('\n%s' % ('ALL CHECKS PASSED' if ok else 'SOME CHECKS FAILED'))
    return 0 if ok else 1

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(
        description='Predict ETHGlobal auto-assessment scores for a draft submission.')
    ap.add_argument('draft', nargs='?', help='draft .md or .json')
    ap.add_argument('--json', action='store_true', help='machine-readable output')
    ap.add_argument('--brief', action='store_true', help='three numbers and the band, nothing else')
    ap.add_argument('--rubric', action='store_true', help='print the inferred rubric + replica prompt')
    ap.add_argument('--self-test', action='store_true', dest='self_test',
                    help='verify calibration.json still reproduces the study headline numbers')
    ap.add_argument('--repo', help='path to the git repo to measure alongside the text')
    ap.add_argument('--event', default='auto', choices=['auto', 'cannes', 'newyork', 'lisbon'],
                    help='event fixed effect (default auto = corpus mean)')
    ap.add_argument('--calibration', default=CAL_PATH)
    a = ap.parse_args()

    if a.rubric:
        sys.stdout.write(open(RUBRIC_PATH, encoding='utf-8').read())
        return 0
    if a.self_test:
        return self_test(load_cal(a.calibration))
    if not a.draft:
        ap.error('a draft file is required (or use --rubric / --self-test)')

    cal = load_cal(a.calibration)
    d = parse_draft(a.draft)
    d['_path'] = a.draft
    f = feats(d)
    f['how_its_made_present'] = 1.0 if (d.get('how_its_made') or '').strip() else 0.0
    edits = build_edits(f, cal)
    base, scored = score_edits(f, cal, edits, a.event)
    _, clamped = predict(f, cal, 'primary', a.event)
    repo = repo_shape(a.repo) if a.repo else None

    if a.brief:
        lbl, bd = band_of(int_total(base), cal)
        print('T %d (%.2f)   O %d (%.2f)   P %d (%.2f)   SUM %d (%.2f)   band %s  win %.1f%% (n=%d)'
              % (rnd(base['T']), base['T'], rnd(base['O']), base['O'], rnd(base['P']), base['P'],
                 int_total(base), base['sum'], lbl,
                 100 * bd['win'], bd['n']))
        return 0

    if a.json:
        lbl, bd = band_of(int_total(base), cal)
        alt, _ = predict(f, cal, 'alloc', a.event)
        out = {
            'draft': a.draft,
            'prediction': {TARGET_NAME[t]: {'continuous': round(base[t], 3), 'rounded': rnd(base[t])}
                           for t in TARGETS},
            'total': {'continuous': round(base['sum'], 3), 'rounded': int_total(base)},
            'second_model': {t: round(alt[t], 3) for t in TARGETS},
            'band': {'label': lbl, 'n': bd['n'], 'win_rate': bd['win']},
            'all_bands': cal['sum']['bands'],
            'features': {k: round(float(v), 4) for k, v in sorted(f.items()) if not k.startswith('_')},
            'clamped': [{'feature': k, 'raw': raw, 'clamped': cl} for k, raw, cl in clamped],
            'edits': [{'key': e['key'], 'title': e['title'], 'how': e.get('how'),
                       'evidence': e['evidence'],
                       'delta': ({k: round(v, 4) for k, v in e['delta'].items()}
                                 if e['delta'] else None)}
                      for e in sorted(scored, key=lambda e: -(e['delta']['sum'] if e['delta'] else -9))],
            'repo': repo,
            'model_accuracy': {'cv_mae': cal['models']['primary']['cv_mae'],
                               'baseline_mae': cal['models']['primary']['baseline_mae'],
                               'cv_r2': cal['models']['primary']['cv_r2']},
            'corpus': cal['meta'],
        }
        print(json.dumps(out, indent=1))
        return 0

    print(render(d, f, cal, base, scored, a.event, clamped, repo))
    return 0


if __name__ == '__main__':
    sys.exit(main())
