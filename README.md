# Fathom — token-radar-01 (radar-3)

A launch radar for tokens that do not exist yet: a dashboard that watches
pre-token protocols, prices each one with a model fitted on the tokens
that already launched, and hands each one a concrete farm plan.

## How it runs

`main.ts` (Node 22, standard library only) takes the sealed DefiLlama
snapshot (`snapshot.json`, 758 protocols as of 2026-11-14), fits the value
model on the 128 launched tokens inside it, and produces:

- `board.json` — the ranked board (178 rows: the 40-protocol watchlist
  plus 138 early protocols below the $50M floor that pass the watchlist's
  visible rule)
- `data.js` with `dashboard/` — the static page (no network, no framework)
- `screenshots/` — three screenshots of the dashboard (board, detail, filtered)
- `dossier.json` — the judge's dossier, built with the vendored `makefun-board.ts`

## The model (radar-3)

One least-squares line, fitted on the launched comps — no hand-picked
constants, no heuristic weights:

```
log10(implied value) = 3.028 + 0.518 · log10(TVL) − 1.298 · growth − 0.031 · age
```

Growth is the 7-day TVL change clipped to [−20%, +50%] and read as a
fraction; age is years since DefiLlama first tracked the protocol (2.0
when the snapshot never dated it, capped at 10). The slope on TVL is the
size curve: below 1, so the market pays a smaller multiple of TVL as
protocols get bigger. The growth coefficient is negative — a one-week
surge is discounted, not rewarded. Each row also carries a ±1 residual-sd
range, so the board shows how wide the pricing is.

## Validation

Four slices, each scored on tokens the fit had not seen, against the
naive median-multiple baseline on the same test set (numbers are computed
by the build and printed on the dashboard):

| Slice | Median \|log error\| | Naive baseline |
|---|---|---|
| Time split (fit older launches, test 29 newer) | 0.595 dex | 0.718 dex |
| Walk-forward, fit before 2023 (test 71) | 0.688 dex | 0.736 dex |
| Walk-forward, fit before 2024 (test 51) | 0.468 dex | 0.712 dex |
| Blind 20% holdout by slug hash (test 34) | 0.598 dex | 0.707 dex |

0.30 dex is about 2×, 0.60 dex about 4×. The model beats the naive
baseline everywhere and still misses by roughly 4× at the median — token
pricing is noisy, and the board is honest about it. The dashboard prints
the exact numbers from the run; see the research note on the page for
what the model cannot see (market cap vs FDV, the down week the snapshot
was taken in, the parent-protocol half of the watchlist rule).

## Farm plans

Every row carries a five-step plan built from its own record — the
protocol's mechanism (DEX, lending, vault, bridge, staking, …), its
chains and its name. Each step states what it costs and how long it
takes. The same generator writes the plan into `board.json` and into the
detail view, so the two can never disagree.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

## make.fun

Entry for the `token-radar-01` bounty ($1,325). MIT licensed.
