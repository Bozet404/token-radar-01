# Token Radar — radar-2

The best token launch radar: a dashboard that tracks pre-token protocols and ranks them by
implied value, with a concrete farm plan for each one.

## What it is

`main.ts` (Node 22, standard library only) reads the sealed DefiLlama snapshot
(`snapshot.json`, 758 protocols as of 2026-11-14), scores every protocol that could plausibly
issue its own token, and writes:

- `board.json` — the ranked board (198 rows: the 40-protocol watchlist plus every other
  rankable pre-token protocol)
- `data.js` + `dashboard/` — the static page (no network, no framework)
- `screenshots/` — three screenshots of the dashboard (board, detail, filtered)
- `dossier.json` — the judge's dossier, built with the vendored `makefun-board.ts`

## The model (radar-2)

```
implied = round( tvl_usd x 0.25
  x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
  x (0.6 + min(age_days, 1095) / 1095 x 0.4)
  x (1 + 0.03 x min(chains, 5)) )
```

Four factors, all from the snapshot's own figures: size (TVL), momentum (7-day growth),
maturity (age with no token), breadth (chains it runs on). No protocol name is special-cased.

The board ranks only protocols that could plausibly launch a token: it leaves out bridges,
liquid-staking receipts, versioned pools and exchanges — products of tokens that already trade.
"No token" means the snapshot records none, never that none exists.

## Farm plans

Every row carries a seven-step plan derived from its own record (category, chains, TVL, age):
fresh wallet, the category's action with capital and chain-aware gas, a weekly qualifying
action, a hold window, weekly points tracking, claim safety, and a farm log. Each step states
what it costs and how long it takes.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

## make.fun

Entry for the `token-radar-01` bounty ($1,325). MIT licensed.
