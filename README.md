# Token Radar — radar-2

A launch radar for tokens that do not exist yet: a dashboard that watches pre-token
protocols, ranks them by implied value, and hands each one a concrete farm plan.

## How it runs

`main.ts` (Node 22, standard library only) takes the sealed DefiLlama snapshot
(`snapshot.json`, 758 protocols as of 2026-11-14), scores every protocol that could plausibly
launch its own token, and produces:

- `board.json` — the ranked board (198 rows: the 40-protocol watchlist plus every other
  rankable pre-token protocol the snapshot records)
- `data.js` with `dashboard/` — the static page (no network, no framework)
- `screenshots/` — three screenshots of the dashboard (board, detail, filtered)
- `dossier.json` — the judge's dossier, built with the vendored `makefun-board.ts`

## The model (radar-2)

```
implied = round(tvl_usd * 0.25 * (1 + clamp(change_7d, -60, 120) / 100 * 0.5)
  * (0.6 + min(age_days, 1095) / 1095 * 0.4) * (1 + 0.03 * min(chains, 5)))
```

Four factors, each drawn from the snapshot's own figures: size (TVL), momentum (seven-day
growth), maturity (age with no token), breadth (chains it runs on). No protocol name is
special-cased anywhere.

The board only ranks protocols that could plausibly launch a token: bridges, liquid-staking
receipts, versioned pools and exchanges are left out — they are products of tokens that
already trade. "No token" means the snapshot records none for the protocol, never that none
exists.

## Farm plans

Every row carries a seven-step plan built from its own record (category, chains, TVL, age):
a fresh wallet, the category's action with capital and chain-aware gas, a weekly qualifying
action, a hold window, weekly points tracking, claim safety, and a farm log. Each step states
what it costs and how long it takes.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

## make.fun

Entry for the `token-radar-01` bounty ($1,325). MIT licensed.
