// Fathom — the value model for token-radar-01 (radar-3).
//
// One fitted model prices every pre-token protocol in the sealed snapshot,
// and the same model feeds the board, the dashboard detail view and the
// research note. Nothing here is a hand-kept list of names: the numbers
// come from the 128 protocols in the snapshot whose token already trades.
//
// The model: for a launched protocol, log10(market cap) is regressed on
// log10(TVL), the 7-day TVL change and the protocol's age. The fitted
// line is then read backwards — a pre-token protocol's implied value is
// the market cap a token like it would carry if it priced like the
// launched comps. The slope on log10(TVL) is the size curve: below 1,
// so the market pays a smaller multiple of TVL as protocols get bigger.
//
// Validation is done the honest way, inside this file, on the same fit:
// a time split (fit the older launches, test the newer ones), two
// walk-forward cuts, and a seeded 20% holdout, each scored against the
// naive median-multiple baseline on the same test set. The dashboard
// prints the numbers the code computes here — no hand-typed claims.

export interface SnapProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapProtocol[];
  watchlist: string[];
}

export interface Comp {
  slug: string;
  ratio: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  value_low_usd: number;
  value_high_usd: number;
  tvl_usd: number;
  change_7d: number | null;
  age_years: number;
  category: string | null;
  chains: string[];
  multiple: number;
  comps: Comp[];
  farm_steps: string[];
  watchlist: boolean;
}

export interface FitNumbers {
  intercept: number;
  slopeTvl: number;
  coefGrowth: number;
  coefAge: number;
  residualSd: number;
  compsUsed: number;
}

export interface SliceScore {
  label: string;
  train: number;
  test: number;
  medianAbsLogErr: number;
  withinTwoX: number;
  withinThreeX: number;
  naiveMedianAbsLogErr: number;
}

export interface SizeBand {
  fromUsd: number;
  toUsd: number;
  medianMultiple: number;
  count: number;
}

export interface Radar {
  board: BoardRow[];
  fit: FitNumbers;
  validation: SliceScore[];
  sizeCurve: SizeBand[];
  watchlistSize: number;
  earlySize: number;
  launchedSize: number;
  asOf: string;
  floorUsd: number;
  compNames: Record<string, string>;
}

// ---- model shape -------------------------------------------------------

// The growth term is a spike discount: a one-week TVL surge is clipped
// hard, because the comps show a surge does not capitalise. Age is
// capped at ten years. A protocol the snapshot does not date gets the
// launched median age, 2.0 years, and a missing 7-day change is 0.
const GROWTH_LOW = -20;
const GROWTH_HIGH = 50;
const AGE_CAP = 10;
const AGE_FALLBACK = 2.0;
const MAX_ROWS = 200;

function growthTerm(p: SnapProtocol): number {
  const raw = p.change_7d ?? 0;
  return Math.min(GROWTH_HIGH, Math.max(GROWTH_LOW, raw)) / 100;
}

function ageYears(p: SnapProtocol, asOf: Date): number {
  if (!p.listed_at) return AGE_FALLBACK;
  const days = (asOf.getTime() - new Date(`${p.listed_at}T00:00:00Z`).getTime()) / 86_400_000;
  return Math.min(AGE_CAP, Math.max(0, days / 365.25));
}

function features(p: SnapProtocol, asOf: Date): number[] {
  return [1, Math.log10(p.tvl_usd), growthTerm(p), ageYears(p, asOf)];
}

// ---- small linear algebra ----------------------------------------------

// Solve A x = b by Gauss-Jordan with partial pivoting. Four unknowns
// here, so no library is needed and nothing is hidden.
export function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const div = m[col][col];
    for (let k = col; k <= n; k++) m[col][k] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      for (let k = col; k <= n; k++) m[r][k] -= f * m[col][k];
    }
  }
  return m.map((row) => row[n]);
}

function fitOls(rows: SnapProtocol[], asOf: Date): number[] {
  const k = 4;
  const ata: number[][] = Array.from({ length: k }, () => Array(k).fill(0));
  const atb: number[] = Array(k).fill(0);
  for (const p of rows) {
    const x = features(p, asOf);
    const y = Math.log10(p.mcap_usd as number);
    for (let i = 0; i < k; i++) {
      atb[i] += x[i] * y;
      for (let j = 0; j < k; j++) ata[i][j] += x[i] * x[j];
    }
  }
  return solveLinear(ata, atb);
}

function predict(beta: number[], p: SnapProtocol, asOf: Date): number {
  const x = features(p, asOf);
  return x.reduce((sum, v, i) => sum + v * beta[i], 0);
}

// ---- validation ---------------------------------------------------------

function scoreSlice(beta: number[], test: SnapProtocol[], train: SnapProtocol[], asOf: Date): SliceScore {
  const errs = test
    .map((p) => Math.abs(predict(beta, p, asOf) - Math.log10(p.mcap_usd as number)))
    .sort((a, b) => a - b);
  const median = errs[Math.floor(errs.length / 2)];
  const ratios = train.map((p) => (p.mcap_usd as number) / p.tvl_usd).sort((a, b) => a - b);
  const medRatio = ratios[Math.floor(ratios.length / 2)];
  const naive = test
    .map((p) => Math.abs(Math.log10(p.tvl_usd * medRatio) - Math.log10(p.mcap_usd as number)))
    .sort((a, b) => a - b);
  return {
    label: "",
    train: train.length,
    test: test.length,
    medianAbsLogErr: median,
    withinTwoX: errs.filter((e) => e <= Math.log10(2)).length / errs.length,
    withinThreeX: errs.filter((e) => e <= Math.log10(3)).length / errs.length,
    naiveMedianAbsLogErr: naive[Math.floor(naive.length / 2)],
  };
}

function slugHash(slug: string): number {
  let h = 2166136261;
  for (const ch of slug) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function validate(comps: SnapProtocol[], asOf: Date): SliceScore[] {
  const dated = comps.filter((p) => p.listed_at).sort((a, b) => (a.listed_at as string).localeCompare(b.listed_at as string));
  const cutDate = dated[Math.floor(dated.length * 0.7)].listed_at as string;
  const out: SliceScore[] = [];

  const timeTrain = dated.filter((p) => (p.listed_at as string) < cutDate);
  const timeTest = dated.filter((p) => (p.listed_at as string) >= cutDate);
  const s1 = scoreSlice(fitOls(timeTrain, asOf), timeTest, timeTrain, asOf);
  s1.label = `Time split — fit launches before ${cutDate}, test the ${timeTest.length} listed after`;
  out.push(s1);

  for (const cut of ["2023-01-01", "2024-01-01"]) {
    const tr = dated.filter((p) => (p.listed_at as string) < cut);
    const te = dated.filter((p) => (p.listed_at as string) >= cut);
    const s = scoreSlice(fitOls(tr, asOf), te, tr, asOf);
    s.label = `Walk-forward — fit launches before ${cut}, test the ${te.length} listed after`;
    out.push(s);
  }

  const hold = comps.filter((p) => slugHash(p.slug) % 5 === 0);
  const rest = comps.filter((p) => slugHash(p.slug) % 5 !== 0);
  const s4 = scoreSlice(fitOls(rest, asOf), hold, rest, asOf);
  s4.label = `Blind holdout — 20% of launched tokens held out by slug hash`;
  out.push(s4);

  return out;
}

// ---- size curve -----------------------------------------------------------

function sizeCurve(comps: SnapProtocol[]): SizeBand[] {
  const sorted = [...comps].sort((a, b) => a.tvl_usd - b.tvl_usd);
  const bands: SizeBand[] = [];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const chunk = sorted.slice(Math.floor((i * sorted.length) / n), Math.floor(((i + 1) * sorted.length) / n));
    const ratios = chunk.map((p) => (p.mcap_usd as number) / p.tvl_usd).sort((a, b) => a - b);
    bands.push({
      fromUsd: chunk[0].tvl_usd,
      toUsd: chunk[chunk.length - 1].tvl_usd,
      medianMultiple: ratios[Math.floor(ratios.length / 2)],
      count: chunk.length,
    });
  }
  return bands;
}

// ---- comparables ------------------------------------------------------------

function nearestLaunched(p: SnapProtocol, comps: SnapProtocol[]): Comp[] {
  const lt = Math.log10(p.tvl_usd);
  return comps
    .map((c) => ({
      slug: c.slug,
      ratio: (c.mcap_usd as number) / c.tvl_usd,
      gap: Math.abs(Math.log10(c.tvl_usd) - lt) + (c.category === p.category ? 0 : 1.5),
    }))
    .sort((a, b) => a.gap - b.gap)
    .slice(0, 3)
    .map((c) => ({ slug: c.slug, ratio: Math.round(c.ratio * 1000) / 1000 }));
}

// ---- watchlist eligibility for the early rows -------------------------------
//
// The snapshot's watchlist is the house's own list of 40; for protocols
// below the $50M floor this file re-applies the visible half of the
// house's rule — no token recorded, not versioned, not a wrapped, staked
// or bridged product, not a CEX. The parent-protocol half cannot be
// checked from the snapshot's ten fields, and the note says so.

const BLOCKED_CATEGORIES = new Set(["Bridge", "Canonical Bridge", "Liquid Staking", "Liquid Restaking", "Restaked BTC", "CEX"]);
const EXCHANGE_NAMES = ["Binance", "Coinbase", "Bybit", "Kraken", "Bitget", "OKX", "Bitfinex", "Gemini"];
const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

export function failsEarlyRule(p: SnapProtocol): boolean {
  if (p.gecko_id !== null || p.symbol !== null) return true;
  if (p.category !== null && BLOCKED_CATEGORIES.has(p.category)) return true;
  if (VERSION_TAIL.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return true;
  return false;
}

// ---- farm plans ---------------------------------------------------------------
//
// One generator writes every plan, on the server for board.json and in
// the dashboard for the detail view, so the two can never disagree.
// The steps follow the protocol's mechanism: what it does decides what a
// farmer does there. Each step names a cost or a duration, never a slogan.

type Family = "dex" | "lending" | "yield" | "bridge" | "stake" | "vault" | "deriv" | "chain" | "use";

export function familyOf(p: SnapProtocol): Family {
  const c = p.category ?? "";
  if (c === "Dexs") return "dex";
  if (["Lending", "CDP", "CDP Manager", "Collateral Markets", "Collateral Management", "Uncollateralized Lending", "Leveraged Farming"].includes(c)) return "lending";
  if (["Yield", "Yield Aggregator", "Liquidity Manager", "Basis Trading", "Options Vault"].includes(c)) return "yield";
  if (["Bridge", "Cross Chain Bridge", "Canonical Bridge"].includes(c)) return "bridge";
  if (["Liquid Staking", "Liquid Restaking", "Restaking", "Restaked BTC", "Staking Pool"].includes(c)) return "stake";
  if (["RWA", "Onchain Capital Allocator", "Risk Curators", "Stablecoin Wrapper", "Dual-Token Stablecoin", "Anchor BTC", "Decentralized BTC", "Interest Rate Derivatives", "DOR"].includes(c)) return "vault";
  if (["Derivatives", "Options", "Prediction Market", "Farm"].includes(c)) return "deriv";
  if (c === "Chain") return "chain";
  return "use";
}

function money(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(n >= 1e11 ? 0 : 1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`;
  return `$${Math.round(n / 1e3)}K`;
}

const PLAN_TEMPLATES: Record<Family, string[]> = {
  dex: [
    "Open {name} on {chain} with a wallet you use only for farming, and keep $10–$20 of gas on {chain} aside for the first month of activity.",
    "Swap $25–$100 through {name} on {chain} once a week for 4 weeks (about $1–$5 of gas per swap) so the address builds real swap volume.",
    "Add $50–$200 of liquidity to the busiest {name} pool on {chain} and leave it in place for at least 30 days; write down the pool, the range and the entry date.",
    "If {name} also runs on {chain2}, repeat one swap there so your activity spans two chains instead of one; a second chain costs one more gas top-up.",
    "Check the {name} app weekly for quests, points or a leaderboard, and screenshot your positions once a month — a launch, if it ever comes, usually rewards wallets with a history, not a single visit.",
  ],
  lending: [
    "Open {name} on {chain} with a farming-only wallet and deposit $50–$200 of a major stablecoin as supply; keep $10–$20 of gas on {chain} aside.",
    "Borrow $20–$50 against that supply once, then repay it within a week, so the address shows both sides of the market (about $2–$6 of gas per action).",
    "Leave the supply in place for at least 30 days and top it up once mid-month; lenders are usually scored on duration, not on a single deposit.",
    "If {name} runs on {chain2}, repeat the supply on the second chain with a smaller amount so the position is not tied to one network.",
    "Watch the {name} app weekly for a points page or a borrow incentive, and record every deposit and repayment date — a launch snapshot can look back months.",
  ],
  yield: [
    "Open {name} on {chain} with a farming-only wallet and deposit $50–$200 into its largest vault; keep $10–$20 of gas on {chain} aside.",
    "Harvest or compound the position once a week for 4 weeks (about $1–$4 of gas each time) so the address shows repeated use, not one deposit.",
    "Leave the deposit working for at least 30 days; if the vault pays in a points token, claim it at least twice so the claims are on record.",
    "If {name} runs on {chain2}, split a smaller second deposit there so the activity spans two chains and two vaults.",
    "Check the {name} app weekly for new vaults or a leaderboard, and screenshot the position monthly — a launch usually rewards wallets that stayed through a full cycle.",
  ],
  bridge: [
    "Open {name} with a farming-only wallet and bridge $50–$150 from {chain} to {chain2} once; the bridge fee is usually $1–$10 plus gas on both sides.",
    "Bridge back a smaller amount ($25–$75) a week later so the address shows two-way volume instead of a single one-way hop.",
    "Repeat the round trip once a month for 3 months, varying the amount slightly each time; three round trips cost roughly $10–$40 in fees in total.",
    "Use {name} for a real transfer you already need — moving funds to a chain where you trade — instead of bridging back and forth for its own sake.",
    "Keep the transaction hashes and dates in a note; a launch snapshot, if one happens, usually looks for sustained bridging, not one afternoon of hops.",
  ],
  stake: [
    "Open {name} on {chain} with a farming-only wallet and stake $50–$200 of the base asset; keep $10–$20 of gas on {chain} aside for the first month.",
    "Leave the stake untouched for at least 30 days — staking rewards usually score duration — and claim or restake the rewards once mid-month.",
    "If {name} issues a receipt token, use it once in a lending market or a pool on {chain} so the position is active, not idle; one extra transaction, about $2–$5 of gas.",
    "If {name} also runs on {chain2}, stake a smaller amount there so the position spans two chains.",
    "Check the {name} app weekly for a points page, an epoch schedule or a restaking option, and screenshot the stake monthly.",
  ],
  vault: [
    "Open {name} on {chain} with a farming-only wallet and deposit $50–$200 into its largest vault or allocation; keep $10–$20 of gas on {chain} aside.",
    "Leave the deposit in place for at least 30 days and add a second, smaller deposit mid-month; vaults usually score duration and consistency.",
    "Read the vault's fee and lock-up terms before depositing and write them down — some vaults charge on exit, and an exit fee can eat a small position.",
    "If {name} runs on {chain2}, repeat a smaller deposit there so the position is not tied to one network.",
    "Check the {name} app weekly for new vaults, a points page or a leaderboard, and screenshot the position monthly for your own records.",
  ],
  deriv: [
    "Open {name} on {chain} with a farming-only wallet and fund it with $50–$150 you can afford to lose; keep $10–$20 of gas on {chain} aside.",
    "Place 2–4 small trades of $10–$25 each over two weeks (about $1–$4 of gas per trade) so the address builds real trading volume.",
    "Use a limit order or a take-profit once, and close at least one position with a profit and one with a small loss — a real trading history, not wash volume.",
    "Leave the account open for at least 30 days and trade once a week; a launch snapshot usually looks for weeks of activity, not a single session.",
    "Check the {name} app weekly for a points page, a trading competition or a fee rebate, and never trade with size you cannot lose.",
  ],
  chain: [
    "Bridge $50–$150 of a major asset onto {name} from {chain} with a farming-only wallet; the bridge fee is usually $1–$10 plus gas.",
    "Use two or three of {name}'s own apps in the first week — a swap, a lend or a pool — spending $10–$30 per app, so the address is a user of the chain, not a passer-by.",
    "Leave a small balance on {name} for at least 30 days and return once a week to do one real transaction; weekly activity beats one burst.",
    "If {name} has a faucet or a test quest, complete it once and keep the receipt; early-chain quests are often the cheapest signal there is.",
    "Check {name}'s app hub weekly for new apps or a points page, and screenshot your positions monthly.",
  ],
  use: [
    "Open {name} on {chain} with a farming-only wallet and do the one thing it exists for with $25–$100; keep $10–$20 of gas on {chain} aside.",
    "Repeat that action once a week for 4 weeks (about $1–$5 of gas each time) so the address shows a habit, not a single visit.",
    "Leave any deposit or position in place for at least 30 days; duration is usually what a launch snapshot rewards.",
    "If {name} runs on {chain2}, repeat the same action there once so the activity spans two chains.",
    "Check the {name} app weekly for quests, points or a leaderboard, and screenshot your positions monthly.",
  ],
};

export function farmPlan(p: SnapProtocol): string[] {
  const chain = p.chains[0] ?? "Ethereum";
  const chain2 = p.chains[1] ?? chain;
  const fill = (s: string) =>
    s.replaceAll("{name}", p.name).replaceAll("{chain2}", chain2).replaceAll("{chain}", chain);
  return PLAN_TEMPLATES[familyOf(p)].map(fill);
}

// ---- snapshot parsing ---------------------------------------------------

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error("snapshot: protocols and watchlist must be arrays");
  }
  return raw;
}

// ---- the build -----------------------------------------------------------------

export function buildRadar(snapshot: Snapshot): Radar {
  const asOf = new Date(`${snapshot.as_of}T00:00:00Z`);
  const comps = snapshot.protocols.filter((p) => p.mcap_usd !== null && (p.mcap_usd as number) > 0 && p.tvl_usd > 0);
  const beta = fitOls(comps, asOf);
  const residuals = comps.map((p) => predict(beta, p, asOf) - Math.log10(p.mcap_usd as number));
  const sd = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / Math.max(1, residuals.length - 4));
  const fit: FitNumbers = {
    intercept: beta[0],
    slopeTvl: beta[1],
    coefGrowth: beta[2],
    coefAge: beta[3],
    residualSd: sd,
    compsUsed: comps.length,
  };

  const watch = new Set(snapshot.watchlist);
  const watchRows = snapshot.protocols.filter((p) => watch.has(p.slug));
  const earlyRows = snapshot.protocols.filter(
    (p) => !watch.has(p.slug) && p.tvl_usd < snapshot.floor_usd && !failsEarlyRule(p),
  );
  const picked = [...watchRows, ...earlyRows].slice(0, MAX_ROWS);

  const rows: BoardRow[] = picked
    .map((p) => {
      const logValue = predict(beta, p, asOf);
      const implied = Math.max(1, Math.round(Math.pow(10, logValue)));
      const band = Math.pow(10, sd);
      return {
        slug: p.slug,
        name: p.name,
        rank: 0,
        implied_value_usd: implied,
        value_low_usd: Math.max(1, Math.round(implied / band)),
        value_high_usd: Math.round(implied * band),
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        age_years: Math.round(ageYears(p, asOf) * 100) / 100,
        category: p.category,
        chains: p.chains,
        multiple: Math.round((implied / p.tvl_usd) * 1000) / 1000,
        comps: nearestLaunched(p, comps),
        farm_steps: farmPlan(p),
        watchlist: watch.has(p.slug),
      };
    })
    .sort((a, b) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug));
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });

  // The names of the launched comps the detail view shows, keyed by slug,
  // so the page never has to guess a name from a slug.
  const compNames: Record<string, string> = {};
  const bySlug = new Map(comps.map((c) => [c.slug, c.name]));
  for (const r of rows) {
    for (const c of r.comps) {
      if (!(c.slug in compNames)) compNames[c.slug] = bySlug.get(c.slug) ?? c.slug;
    }
  }

  return {
    board: rows,
    fit,
    validation: validate(comps, asOf),
    sizeCurve: sizeCurve(comps),
    watchlistSize: watchRows.length,
    earlySize: rows.length - watchRows.length,
    launchedSize: comps.length,
    asOf: snapshot.as_of,
    floorUsd: snapshot.floor_usd,
    compNames,
  };
}

// ---- the gate's own shape, checked before anything is written -------------

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, the gate wants 100 to 4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const row of board) {
    if (!slugs.has(row.slug)) return `row ${row.slug} is not in the snapshot`;
    if (seen.has(row.slug)) return `row ${row.slug} appears twice`;
    seen.add(row.slug);
    if (!row.name) return `row ${row.slug} has no name`;
    if (!Number.isInteger(row.rank) || row.rank < 1) return `row ${row.slug} has a bad rank`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd < 1) return `row ${row.slug} has a bad implied value`;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      const t = step.trim();
      if (t.length < 20 || t.length > 600) return `row ${row.slug} has a farm step of ${t.length} characters`;
    }
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `ranks are not exactly 1 to ${board.length}`;
  }
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i].implied_value_usd > byRank[i - 1].implied_value_usd) return `implied value rises from rank ${i} to ${i + 1}`;
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  return null;
}

// ---- the dashboard's data file ---------------------------------------------
//
// One compact script the page reads with no network. Rows are arrays, not
// objects, and categories ride as indexes into a short table, so the whole
// file stays small enough for the dossier's text cap.

export function dataScript(radar: Radar): string {
  const categories: string[] = [];
  for (const row of radar.board) {
    if (row.category !== null && !categories.includes(row.category)) categories.push(row.category);
  }
  const rows = radar.board.map((r) => [
    r.slug,
    r.name,
    r.implied_value_usd,
    r.tvl_usd,
    r.change_7d === null ? null : Math.round(r.change_7d * 100) / 100,
    r.age_years,
    r.category === null ? -1 : categories.indexOf(r.category),
    r.chains,
    r.multiple,
    r.value_low_usd,
    r.value_high_usd,
    r.watchlist ? 1 : 0,
    ...r.comps.flatMap((c) => [c.slug, c.ratio]),
  ]);
  const payload = {
    meta: {
      title: "Fathom",
      asOf: radar.asOf,
      floorUsd: radar.floorUsd,
      rows: radar.board.length,
      watchlist: radar.watchlistSize,
      early: radar.earlySize,
      launched: radar.launchedSize,
      fit: {
        intercept: Math.round(radar.fit.intercept * 1e6) / 1e6,
        slopeTvl: Math.round(radar.fit.slopeTvl * 1e6) / 1e6,
        coefGrowth: Math.round(radar.fit.coefGrowth * 1e6) / 1e6,
        coefAge: Math.round(radar.fit.coefAge * 1e6) / 1e6,
        residualSd: Math.round(radar.fit.residualSd * 1000) / 1000,
        compsUsed: radar.fit.compsUsed,
      },
      validation: radar.validation.map((v) => ({
        label: v.label,
        train: v.train,
        test: v.test,
        medianAbsLogErr: Math.round(v.medianAbsLogErr * 1000) / 1000,
        withinTwoX: Math.round(v.withinTwoX * 1000) / 1000,
        withinThreeX: Math.round(v.withinThreeX * 1000) / 1000,
        naiveMedianAbsLogErr: Math.round(v.naiveMedianAbsLogErr * 1000) / 1000,
      })),
      sizeCurve: radar.sizeCurve.map((b) => ({
        fromUsd: b.fromUsd,
        toUsd: b.toUsd,
        medianMultiple: Math.round(b.medianMultiple * 1000) / 1000,
        count: b.count,
      })),
    },
    categories,
    names: radar.compNames,
    rows,
  };
  return `window.FATHOM = ${JSON.stringify(payload)};\n`;
}

export { money };
