#!/usr/bin/env python3
"""
fit_calibration.py -- refit everything score_submission.py needs, from the corpus
of 602 scored ETHGlobal 2026 IRL projects, and write calibration.json.

    python3 fit_calibration.py --corpus /path/to/corpus-irl2026.jsonl

The corpus is NOT shipped with this tool (it is 3.1 MB of scraped showcase
payloads). calibration.json is, and it is the only thing the scorer reads at
runtime. Run this script only if you want to re-derive it or extend the corpus.

Everything in calibration.json is a number MEASURED on those 602 projects.
No number in it is hand-written.

stdlib only: json / math / re / random / statistics / argparse.
"""

import json
import math
import random
import statistics as st
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from subfeatures import (feats, MODEL_FEATS, ALLOC_FEATS, TARGETS, TARGET_KEY)  # noqa: E402

SEED = 20260907
DEFAULT_CORPUS = ('/private/tmp/claude-501/-Users-kirillrybkov-Desktop-project/'
                  '9e63dac7-1e5d-4fe3-9634-61767d65c76a/scratchpad/study/corpus-irl2026.jsonl')


# ---------------------------------------------------------------------------
# small stats helpers (no numpy / no pandas)
# ---------------------------------------------------------------------------

def mean(xs):
    xs = list(xs)
    return sum(xs) / len(xs) if xs else 0.0


def pct(sorted_xs, q):
    if not sorted_xs:
        return 0.0
    i = q * (len(sorted_xs) - 1)
    lo, hi = int(math.floor(i)), int(math.ceil(i))
    if lo == hi:
        return float(sorted_xs[lo])
    return float(sorted_xs[lo] + (sorted_xs[hi] - sorted_xs[lo]) * (i - lo))


def pearson(x, y):
    n = len(x)
    if n < 3:
        return 0.0
    mx, my = mean(x), mean(y)
    sxy = sum((a - mx) * (b - my) for a, b in zip(x, y))
    sxx = sum((a - mx) ** 2 for a in x)
    syy = sum((b - my) ** 2 for b in y)
    if sxx <= 0 or syy <= 0:
        return 0.0
    return sxy / math.sqrt(sxx * syy)


def rank(xs):
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    r = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        avg = (i + j) / 2.0 + 1
        for k in range(i, j + 1):
            r[order[k]] = avg
        i = j + 1
    return r


def spearman(x, y):
    return pearson(rank(x), rank(y))


def welch(a, b):
    """returns (mean_a - mean_b, se, t, approx two-sided p)"""
    na, nb = len(a), len(b)
    if na < 2 or nb < 2:
        return 0.0, 0.0, 0.0, 1.0
    ma, mb = mean(a), mean(b)
    va, vb = st.variance(a), st.variance(b)
    se = math.sqrt(va / na + vb / nb)
    if se <= 0:
        return ma - mb, 0.0, 0.0, 1.0
    t = (ma - mb) / se
    # normal approximation to the two-sided p-value
    p = 2 * (1 - 0.5 * (1 + math.erf(abs(t) / math.sqrt(2))))
    return ma - mb, se, t, p


def cohen_d(a, b):
    if len(a) < 2 or len(b) < 2:
        return 0.0
    sp = math.sqrt(((len(a) - 1) * st.variance(a) + (len(b) - 1) * st.variance(b)) /
                   (len(a) + len(b) - 2))
    return (mean(a) - mean(b)) / sp if sp > 0 else 0.0


def solve_ridge(X, y, lam):
    """Standardised ridge via normal equations, Gauss-Jordan. X has NO intercept
    column; features are already z-scored. Returns (intercept, betas)."""
    n, p = len(X), len(X[0]) if X else 0
    if n == 0 or p == 0:
        return mean(y), []
    A = [[sum(X[i][r] * X[i][c] for i in range(n)) + (lam if r == c else 0.0)
          for c in range(p)] + [sum(X[i][r] * y[i] for i in range(n))] for r in range(p)]
    for c in range(p):
        piv = max(range(c, p), key=lambda r: abs(A[r][c]))
        A[c], A[piv] = A[piv], A[c]
        if abs(A[c][c]) < 1e-12:
            continue
        d = A[c][c]
        A[c] = [v / d for v in A[c]]
        for r in range(p):
            if r != c and A[r][c]:
                fq = A[r][c]
                A[r] = [a - fq * b for a, b in zip(A[r], A[c])]
    beta = [A[r][p] for r in range(p)]
    return mean(y), beta


def zstats(F, names):
    mu = {k: mean([f[k] for f in F]) for k in names}
    sd = {k: (st.pstdev([f[k] for f in F]) or 1.0) for k in names}
    return mu, sd


def zdesign(F, names, mu, sd):
    return [[(f[k] - mu[k]) / sd[k] for k in names] for f in F]


def cv_fit(F, y, names, lam, k=5, seed=SEED):
    """5-fold CV. Returns (mae, r2, baseline_mae, baseline_r2=0)."""
    idx = list(range(len(F)))
    random.Random(seed).shuffle(idx)
    errs, base_errs, sse, sst = [], [], 0.0, 0.0
    gmu = mean(y)
    for fold in range(k):
        te = [idx[i] for i in range(len(idx)) if i % k == fold]
        tr = [idx[i] for i in range(len(idx)) if i % k != fold]
        mu, sd = zstats([F[i] for i in tr], names)
        Xtr = zdesign([F[i] for i in tr], names, mu, sd)
        b0, beta = solve_ridge(Xtr, [y[i] for i in tr], lam)
        trmu = mean([y[i] for i in tr])
        for i in te:
            x = [(F[i][kk] - mu[kk]) / sd[kk] for kk in names]
            p = b0 + sum(a * b for a, b in zip(beta, x))
            errs.append(abs(p - y[i]))
            base_errs.append(abs(trmu - y[i]))
            sse += (p - y[i]) ** 2
            sst += (y[i] - gmu) ** 2
    return mean(errs), (1 - sse / sst if sst else 0.0), mean(base_errs)


def fit_model(F, Y, names, lams=(0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0)):
    """Pick lambda by 5-fold CV MAE per target, refit on all data, return spec."""
    spec = {'feats': list(names), 'lambda': {}, 'intercept': {}, 'beta': {},
            'cv_mae': {}, 'cv_r2': {}, 'baseline_mae': {}}
    mu, sd = zstats(F, names)
    spec['mu'] = mu
    spec['sd'] = sd
    X = zdesign(F, names, mu, sd)
    for t in TARGETS:
        y = Y[t]
        best = None
        for lam in lams:
            mae, r2, base = cv_fit(F, y, names, lam)
            if best is None or mae < best[1]:
                best = (lam, mae, r2, base)
        lam, mae, r2, base = best
        b0, beta = solve_ridge(X, y, lam)
        spec['lambda'][t] = lam
        spec['intercept'][t] = b0
        spec['beta'][t] = dict(zip(names, beta))
        spec['cv_mae'][t] = mae
        spec['cv_r2'][t] = r2
        spec['baseline_mae'][t] = base
    return spec


def bands(F, Y, key, edges, labels=None):
    out = []
    for i in range(len(edges) - 1):
        lo, hi = edges[i], edges[i + 1]
        idx = [j for j in range(len(F)) if lo <= F[j][key] < hi]
        if not idx:
            continue
        row = {'lo': lo, 'hi': None if hi == float('inf') else hi, 'n': len(idx),
               'label': labels[i] if labels else None}
        for t in TARGETS:
            row['mean_' + t] = round(mean([Y[t][j] for j in idx]), 3)
            row['min_' + t] = min(Y[t][j] for j in idx)
        row['mean_sum'] = round(mean([Y['T'][j] + Y['O'][j] + Y['P'][j] for j in idx]), 3)
        row['p_T9'] = round(mean([1.0 if Y['T'][j] >= 9 else 0.0 for j in idx]), 4)
        row['p_T_ge8'] = round(mean([1.0 if Y['T'][j] >= 8 else 0.0 for j in idx]), 4)
        row['win'] = round(mean([1.0 if F[j]['_won'] else 0.0 for j in idx]), 4)
        out.append(row)
    return out


def binary_effect(F, Y, key):
    on = [j for j in range(len(F)) if F[j][key] >= 0.5]
    off = [j for j in range(len(F)) if F[j][key] < 0.5]
    row = {'n_with': len(on), 'n_without': len(off)}
    for t in TARGETS:
        a = [Y[t][j] for j in on]
        b = [Y[t][j] for j in off]
        if len(a) < 2 or len(b) < 2:
            row[t] = None
            continue
        d, se, tt, p = welch(a, b)
        row[t] = {'mean_with': round(mean(a), 3), 'mean_without': round(mean(b), 3),
                  'diff': round(d, 3), 'se': round(se, 3), 'p': p, 'd': round(cohen_d(a, b), 3)}
    # length-controlled: same diff computed inside each quartile of total_chars,
    # then averaged with equal weight per quartile
    tc = sorted(f['total_chars'] for f in F)
    q = [pct(tc, x) for x in (0.25, 0.5, 0.75)]

    def qi(v):
        return 0 if v <= q[0] else (1 if v <= q[1] else (2 if v <= q[2] else 3))
    ctrl = {}
    for t in TARGETS:
        diffs, ns = [], []
        for k in range(4):
            a = [Y[t][j] for j in on if qi(F[j]['total_chars']) == k]
            b = [Y[t][j] for j in off if qi(F[j]['total_chars']) == k]
            if len(a) >= 5 and len(b) >= 5:
                diffs.append(mean(a) - mean(b))
                ns.append(min(len(a), len(b)))
        ctrl[t] = round(mean(diffs), 3) if diffs else None
        ctrl[t + '_quartiles'] = len(diffs)
    row['length_controlled'] = ctrl
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--corpus', default=DEFAULT_CORPUS)
    ap.add_argument('--out', default=os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                                  'calibration.json'))
    a = ap.parse_args()

    rows = [json.loads(l) for l in open(a.corpus)]
    scored = [r for r in rows if r.get('auto_technicality') is not None]
    F = []
    for r in scored:
        f = feats(r)
        f['_won'] = 1.0 if r.get('won_any') else 0.0
        F.append(f)
    Y = {t: [float(r[TARGET_KEY[t]]) for r in scored] for t in TARGETS}
    N = len(scored)
    print('corpus %s  rows=%d  scored=%d' % (a.corpus, len(rows), N))

    cal = {'meta': {
        'n_scored': N, 'n_total': len(rows), 'corpus': a.corpus, 'seed': SEED,
        'events': sorted(set(r.get('event_slug') for r in scored)),
        'note': 'Every number in this file is measured on the n_scored projects above.',
    }}

    # ---- 1. score distributions -------------------------------------------
    dist = {}
    for t in TARGETS:
        c = {}
        for v in Y[t]:
            c[str(int(v))] = c.get(str(int(v)), 0) + 1
        dist[t] = {'counts': c, 'mean': round(mean(Y[t]), 4),
                   'sd': round(st.pstdev(Y[t]), 4),
                   'mode': int(max(c, key=lambda k: c[k])),
                   'min': int(min(Y[t])), 'max': int(max(Y[t]))}
    cal['dist'] = dist

    # ---- 2. sum -> win rate ------------------------------------------------
    sums = [Y['T'][i] + Y['O'][i] + Y['P'][i] for i in range(N)]
    won = [F[i]['_won'] for i in range(N)]
    exact = {}
    for s in sorted(set(sums)):
        idx = [i for i in range(N) if sums[i] == s]
        exact[str(int(s))] = {'n': len(idx), 'win': round(mean([won[i] for i in idx]), 4)}
    # band edges match the brief's published bands exactly; the '<=17' band holds
    # the 14 projects whose sum falls below the published range.
    band_def = [('<=17', 0, 17.5), ('18-20', 17.5, 20.5), ('21-23', 20.5, 23.5),
                ('24-26', 23.5, 99)]
    bnd = {}
    for lbl, lo, hi in band_def:
        idx = [i for i in range(N) if lo <= sums[i] < hi]
        bnd[lbl] = {'n': len(idx), 'win': round(mean([won[i] for i in idx]), 4)}
    cal['sum'] = {'exact': exact, 'bands': bnd,
                  'mean': round(mean(sums), 3), 'sd': round(st.pstdev(sums), 3),
                  'overall_win': round(mean(won), 4)}

    # ---- 3. percentiles of the actionable features -------------------------
    PCT_FEATS = ['tagline_chars', 'desc_chars', 'hm_chars', 'total_chars', 'hm_share',
                 'n_tech_distinct', 'n_technoun_distinct', 'technoun_per_100w', 'tech_per_100w',
                 'n_named_artifacts', 'n_named_artifacts_hm', 'n_codeids', 'n_numbers',
                 'n_measurements', 'n_buzz', 'buzz_per_100w', 'n_hedge', 'ttr', 'flesch']
    prc = {}
    for k in PCT_FEATS:
        xs = sorted(f[k] for f in F)
        prc[k] = {('p%d' % int(q * 100)): round(pct(xs, q), 4)
                  for q in (0.10, 0.25, 0.50, 0.75, 0.90)}
        prc[k]['mean'] = round(mean(xs), 4)
    cal['percentiles'] = prc

    # ---- 4. dose-response bands -------------------------------------------
    inf = float('inf')
    cal['dose'] = {
        'hm_chars': bands(F, Y, 'hm_chars', [0, 500, 1000, 1500, 2000, 2500, 3000, 4000, 6000, inf]),
        'total_chars': bands(F, Y, 'total_chars', [0, 1000, 2000, 3000, 4000, 6000, 9000, inf]),
        'n_tech_distinct': bands(F, Y, 'n_tech_distinct', [0, 5, 8, 10, 14, 16, 21, inf]),
        'n_named_artifacts_hm': bands(F, Y, 'n_named_artifacts_hm', [0, 3, 8, 15, 30, inf]),
        'n_codeids': bands(F, Y, 'n_codeids', [0, 5, 15, 30, 60, inf]),
        'n_numbers': bands(F, Y, 'n_numbers', [0, 1, 5, 15, 30, inf]),
        'buzz_per_100w': bands(F, Y, 'buzz_per_100w', [0, 0.001, 0.5, 1.0, 2.0, inf]),
    }

    # ---- 5. saturation: points per +1000 chars of how_its_made, within band --
    sat = []
    for lo, hi in [(0, 1000), (1000, 2000), (2000, 3000), (3000, 5000), (5000, 20000)]:
        idx = [j for j in range(N) if lo <= F[j]['hm_chars'] < hi]
        if len(idx) < 15:
            continue
        x = [F[j]['hm_chars'] / 1000.0 for j in idx]
        row = {'lo': lo, 'hi': hi, 'n': len(idx)}
        for t in TARGETS:
            y = [Y[t][j] for j in idx]
            mx, my = mean(x), mean(y)
            sxx = sum((v - mx) ** 2 for v in x)
            row['slope_' + t] = round(sum((v - mx) * (w - my) for v, w in zip(x, y)) / sxx, 4) if sxx else 0.0
        sat.append(row)
    cal['saturation_hm_per_1000ch'] = sat

    # ---- 6. binary flag effects -------------------------------------------
    BFLAGS = ['mentions_tests', 'mentions_deployed', 'mentions_benchmark', 'has_measurement',
              'has_numbers', 'has_video', 'has_demo_url', 'has_repo', 'opens_mechanism',
              'opens_problem', 'opens_benefit', 'has_incomplete', 'has_hedge', 'has_buzz',
              'has_filepath', 'has_backticks', 'has_address', 'has_bullets', 'has_headings',
              'tagline_names_tech', 'is_first_person', 'has_url_in_text', 'has_codeid']
    cal['binary'] = {k: binary_effect(F, Y, k) for k in BFLAGS}

    # ---- 7. univariate rank correlations ----------------------------------
    CORR = PCT_FEATS + ['total_words', 'log_hm_chars', 'log_total_chars', 'words_per_sentence',
                        'first_person_per_100w', 'n_incomplete', 'n_paragraphs', 'n_bullets',
                        'n_urls_in_text', 'excl_marks', 'question_marks', 'long_word_share']
    cal['spearman'] = {k: {t: round(spearman([f[k] for f in F], Y[t]), 4) for t in TARGETS}
                       for k in sorted(set(CORR))}

    # ---- 8. models ---------------------------------------------------------
    cal['models'] = {
        'primary': fit_model(F, Y, MODEL_FEATS),
        'alloc': fit_model(F, Y, ALLOC_FEATS),
    }
    cal['models']['primary']['name'] = 'features.py MODEL_FEATS (26 text/artifact features), z-scored ridge'
    cal['models']['alloc']['name'] = 'features.py ALLOC budget-allocation model (9 features), z-scored ridge'

    # Extrapolation guard: the observed [min, max] of every model feature over the
    # corpus. score_submission.py clamps a draft to this box before predicting, so
    # the linear model is never evaluated outside the region it was fitted on. Using
    # min/max rather than a percentile means no in-sample information is discarded.
    used = sorted(set(MODEL_FEATS) | set(ALLOC_FEATS))
    wb = {}
    for k in used:
        xs = [f[k] for f in F]
        wb[k] = [round(min(xs), 6), round(max(xs), 6)]
    cal['winsor'] = wb
    cal['winsor_total_chars_min'] = min(f['total_chars'] for f in F)

    # ---- 9. Aqua / SwapVM peer set (the domain anchor) --------------------
    import re as _re
    aq = _re.compile(r'\b(aqua|swapvm)\b', _re.I)
    opc = _re.compile(r'\b(opcode|instruction|custom instruction|custom opcode|bytecode)\b', _re.I)
    peers, opcode_peers = [], []
    for i, r in enumerate(scored):
        blob = ' '.join([r.get('tagline') or '', r.get('description') or '',
                         r.get('how_its_made') or '', r.get('auto_summary') or ''])
        if not aq.search(blob):
            continue
        rec = {'name': r.get('name'), 'slug': r.get('url_slug'),
               'T': int(Y['T'][i]), 'O': int(Y['O'][i]), 'P': int(Y['P'][i]),
               'sum': int(sums[i]), 'won': bool(r.get('won_any')),
               'hm_chars': F[i]['hm_chars'], 'custom_opcode': bool(opc.search(blob))}
        peers.append(rec)
        if rec['custom_opcode']:
            opcode_peers.append(rec)

    def agg(rs):
        if not rs:
            return {}
        return {'n': len(rs),
                'mean_T': round(mean([x['T'] for x in rs]), 3),
                'mean_O': round(mean([x['O'] for x in rs]), 3),
                'mean_P': round(mean([x['P'] for x in rs]), 3),
                'mean_sum': round(mean([x['sum'] for x in rs]), 3),
                'win': round(mean([1.0 if x['won'] else 0.0 for x in rs]), 4),
                'T_hist': {str(v): sum(1 for x in rs if x['T'] == v) for v in sorted(set(x['T'] for x in rs))},
                'O_hist': {str(v): sum(1 for x in rs if x['O'] == v) for v in sorted(set(x['O'] for x in rs))},
                'P_hist': {str(v): sum(1 for x in rs if x['P'] == v) for v in sorted(set(x['P'] for x in rs))}}
    cal['peers'] = {'all_aqua': agg(peers), 'custom_opcode': agg(opcode_peers),
                    'rows': sorted(peers, key=lambda x: -x['sum'])}

    json.dump(cal, open(a.out, 'w'), indent=1, sort_keys=False)
    print('wrote %s (%.1f KB)' % (a.out, os.path.getsize(a.out) / 1024.0))
    for m in ('primary', 'alloc'):
        s = cal['models'][m]
        print('  %-8s CV MAE  T %.3f (base %.3f)  O %.3f (base %.3f)  P %.3f (base %.3f)'
              % (m, s['cv_mae']['T'], s['baseline_mae']['T'], s['cv_mae']['O'],
                 s['baseline_mae']['O'], s['cv_mae']['P'], s['baseline_mae']['P']))
        print('  %-8s CV R^2  T %.3f  O %.3f  P %.3f'
              % ('', s['cv_r2']['T'], s['cv_r2']['O'], s['cv_r2']['P']))


if __name__ == '__main__':
    main()
