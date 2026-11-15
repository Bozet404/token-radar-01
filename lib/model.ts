// Radar-2, the token radar's scoring model: one sealed snapshot in, one ranked board out.
//
// The board starts from the snapshot's watchlist — that list is a floor, never a ceiling —
// and then sweeps up every other protocol that could plausibly launch a token of its own.
// A protocol only ranks when the snapshot records no token for it at all (no market cap, no
// CoinGecko id, no symbol), and when it is not a receipt for a token that already trades: no
// bridges, no liquid-staking or restaking receipts, no exchange product, no versioned pool of
// another protocol. Protocols whose token already trades are set aside and shown with the
// market's own numbers, never mixed into the ranking.
//
// A row's implied value is one function of the snapshot's own numbers, the same for every row:
//
//   base        = tvl_usd * 0.25
//   growth      = clamp(change_7d, -60, 120), in percent
//   growthMult  = 1 + (growth / 100) * 0.5
//   maturity    = 0.6 + min(age_days, 1095) / 1095 * 0.4   (age_days unknown: 365)
//   breadth     = 1 + 0.03 * min(chains, 5)
//   implied     = max(1, round(base * growthMult * maturity * breadth))
//
// TVL is the protocol's size, the seven-day change is its momentum, age with no token is how
// long a launch has been waited for, and the chain count is how many surfaces a token could
// reach. The four constants live in one table the dashboard prints and the sandbox can vary.
// No protocol name is ever special-cased anywhere in this file.

/** One protocol entry of the sealed snapshot, exactly the ten fields it carries. */
export interface ProtoRecord {
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

/** The sealed snapshot document as a whole. */
export interface SnapDoc {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: ProtoRecord[];
  watchlist: string[];
}

/** The model's tuning table, printed by the dashboard and variable in the sandbox. */
export interface Tuning {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const TUNING: Tuning = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_per_chain: 0.03,
  breadth_max_chains: 5,
};

/** The model's label, named by the dashboard and quoted by the rules. */
export const MODEL_TAG = 'radar-2';

/** How many traded protocols the live-token view holds, largest market cap first. */
export const LIVE_LIMIT = 24;

/** One step of a farm plan: the action, what it costs, how long it takes. */
export interface PlanStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json, the ranked board's own row. */
export interface RankedRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** One row in its compact form for data.js; the page builds the farm plan from it. */
export interface CompactRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
}

/** A protocol whose token already trades: the board shows the market's value, not a model's. */
export interface TradedRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders: the board, the traded set, and the model behind them. */
export interface PageData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: Tuning;
  model_version: string;
  watchlist_size: number;
  watchlist_slugs: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  rows: CompactRow[];
  live: TradedRow[];
}

/** Why a snapshot is not one this model can score. */
export class SnapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapError';
  }
}

const MS_DAY = 86_400_000;

/** `value` when it is a finite number, `fallback` otherwise. */
function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listed` to `asOf`, never below zero; null when a date is missing or bad. */
export function daysSince(asOf: string, listed: string | null): number | null {
  if (listed === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listed}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / MS_DAY));
}

/** The four multipliers and the implied value one protocol scores under `tuning`. */
export function scoreProto(proto: ProtoRecord, asOf: string, tuning: Tuning): { value: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = daysSince(asOf, proto.listed_at);
  const rawGrowth = numOr(proto.change_7d, 0);
  const growthPct = Math.min(tuning.growth_cap, Math.max(tuning.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * tuning.growth_weight;
  const ageUsed = age ?? tuning.unknown_age_days;
  const maturityMult = tuning.maturity_floor + (Math.min(Math.max(ageUsed, 0), tuning.maturity_days) / tuning.maturity_days) * tuning.maturity_range;
  const breadthMult = 1 + tuning.breadth_per_chain * Math.min(proto.chains.length, tuning.breadth_max_chains);
  const base = proto.tvl_usd * tuning.base_multiple;
  const value = Math.max(1, Math.round(base * growthMult * maturityMult * breadthMult));
  return { value, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** A name that ends in a release marker is a versioned pool of another protocol. */
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a receipt for a token that already trades, never a launch of their own. */
const RECEIPT_CATS = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** A name with a whole word wrapped, staked or staking is a receipt for a token that trades. */
const RECEIPT_WORD = /\b(wrapped|staked|staking)\b/i;

/** An exchange's own product is not a protocol waiting on a launch of its own. */
const EXCHANGE_NAME = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol's record carries no token at all. */
export function lacksToken(p: ProtoRecord): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol may be ranked: it records no token, and it is not a wrapped, staked or
 * bridged product of a token that already trades, not an exchange's product, and not a versioned
 * pool. This is the watchlist's own rule, applied to the whole board, so the early radar ranks
 * launches, not receipts.
 */
export function canRank(p: ProtoRecord): boolean {
  if (!lacksToken(p)) return false;
  if (p.category !== null && RECEIPT_CATS.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (RECEIPT_WORD.test(p.name)) return false;
  if (EXCHANGE_NAME.test(p.name)) return false;
  return true;
}

/** The snapshot's protocols keyed by slug. */
function indexSlugs(protocols: ProtoRecord[]): Map<string, ProtoRecord> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** Four-decimal rounding for the multipliers board.json carries. */
const round4dp = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The protocols the board ranks, strongest first, carrying ranks 1..n. */
export function buildRanking(snap: SnapDoc, tuning: Tuning = TUNING): RankedRow[] {
  const index = indexSlugs(snap.protocols);
  const picked = new Map<string, ProtoRecord>();
  // The watchlist is the floor: every slug on it ranks, even one the snapshot no longer carries
  // (it cannot, but the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snap.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) picked.set(slug, p);
  }
  // The early radar: every other protocol that could plausibly issue its own token, whatever its
  // TVL. No cap, no hand-picked cutoff: the board is the whole launch universe the snapshot records.
  for (const p of snap.protocols) {
    if (!picked.has(p.slug) && canRank(p)) picked.set(p.slug, p);
  }

  const scored = [...picked.values()].map((proto) => {
    const { value, growthPct, growthMult, maturityMult, breadthMult, age } = scoreProto(proto, snap.as_of, tuning);
    return { proto, value, growthPct, growthMult, maturityMult, breadthMult, age };
  });
  scored.sort((a, b) => b.value - a.value || (a.proto.slug < b.proto.slug ? -1 : a.proto.slug > b.proto.slug ? 1 : 0));
  return scored.map((hit, i) => ({
    rank: i + 1,
    slug: hit.proto.slug,
    name: hit.proto.name,
    category: hit.proto.category,
    chains: hit.proto.chains,
    tvl_usd: hit.proto.tvl_usd,
    change_7d: hit.proto.change_7d,
    mcap_usd: hit.proto.mcap_usd,
    listed_at: hit.proto.listed_at,
    gecko_id: hit.proto.gecko_id,
    symbol: hit.proto.symbol,
    token_status: 'pre-token',
    age_days: hit.age,
    implied_value_usd: hit.value,
    model: {
      base_multiple: tuning.base_multiple,
      growth_pct: hit.growthPct,
      growth_multiplier: round4dp(hit.growthMult),
      maturity_multiplier: round4dp(hit.maturityMult),
      breadth_multiplier: round4dp(hit.breadthMult),
      age_days: hit.age,
    },
    farm_steps: planSteps(hit.proto, hit.age).map(stepLine),
  }));
}

/** One step as a single string: the action, then its cost and time, within 20..600 characters. */
export function stepLine(step: PlanStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase when it names none. */
function firstChain(p: ProtoRecord): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on a chain, in dollars, from that chain's own fee market. */
function feeOn(chain: string): number {
  if (chain === 'Ethereum') return 8;
  if (chain === 'Solana') return 1;
  if (chain === 'Bitcoin') return 5;
  return 2;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function stakeSize(p: ProtoRecord): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in words a farmer can follow. */
function actionText(p: ProtoRecord, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan comes
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list
 * of names. The tracking step is the one farmers skip: points are counted weekly, and a
 * position no one checks is a position that quietly stops counting.
 */
export function planSteps(p: ProtoRecord, age: number | null): PlanStep[] {
  const chain = firstChain(p);
  const capital = stakeSize(p);
  const gas = feeOn(chain);
  const hold = holdFor(age);
  const action = actionText(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `under $${gas} of gas for the first transaction`,
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${gas} of gas on ${chain}`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: `about $${gas} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Check the protocol's own points or rewards page once a week and write your points, rank and any new tasks in your farm log.`,
      cost: 'nothing but a few minutes',
      time: '10 minutes a week',
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The traded protocols, by market cap, for the dashboard's live-token view. */
export function tradedRows(snap: SnapDoc): TradedRow[] {
  return snap.protocols
    .filter((p) => !lacksToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_LIMIT)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A ranked row's compact form for data.js, with the farm plan built in the page. */
export function compactRow(row: RankedRow): CompactRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildPageData(snap: SnapDoc, tuning: Tuning = TUNING): { board: RankedRow[]; radar: PageData } {
  const board = buildRanking(snap, tuning);
  const live = tradedRows(snap);
  const early = board.filter((r) => !snap.watchlist.includes(r.slug)).length;
  const radar: PageData = {
    as_of: snap.as_of,
    source: snap.source,
    floor_usd: snap.floor_usd,
    model: tuning,
    model_version: MODEL_TAG,
    watchlist_size: snap.watchlist.length,
    watchlist_slugs: [...snap.watchlist].sort(),
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(compactRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function readSnapshot(text: string): SnapDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapError('the snapshot file is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapError('the snapshot file is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapError('the snapshot file has no as_of date');
  if (typeof o.source !== 'string') throw new SnapError('the snapshot file has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapError('the snapshot file has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapError('the snapshot file has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapError('the snapshot file has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapError(`the snapshot file's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapError(`the snapshot file's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function rankingIssue(board: RankedRow[], snap: SnapDoc): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snap.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function pageScript(radar: PageData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
