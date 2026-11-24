// The token radar's model, radar-2: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds every
// rankable pre-token protocol below the watchlist floor: the early rows the radar exists to find. A
// protocol is pre-token when its record carries no token (no market cap, no CoinGecko id, no symbol);
// the snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed
// into the ranked board. They do a second job: they calibrate the model.
//
// Implied value follows only from the snapshot's own figures. The market already prices live tokens,
// and it prices them very differently by category, so a flat multiple for every protocol throws that
// information away. radar-2 calibrates a multiple per category from the live tokens in the snapshot:
//
//   category multiple = (n x category median mcap/TVL + K x global median) / (n + K)
//                       clamped to [multiple_min, multiple_max]
//
// where n is the category's live-token count and K is the shrinkage strength: a category with one or
// two live tokens cannot set a wild multiple, because its median is pulled toward the global median.
// A category with no live token takes the global median outright. Every ratio is winsorized at
// ratio_cap before any median is taken, so one token whose market cap dwarfs its own pool's TVL
// cannot set a thin category's multiple on its own.
//
//   relative growth = change_7d - the category's median 7d change (the global median when the
//                     category has too few reporters); null change_7d counts as the median.
//   growthMult      = 1 + clamp(relative growth, floor, cap) / 100 x growth_weight
//   maturityMult    = maturity_floor + (1 - maturity_floor) x min(age_days, maturity_days)
//                     / maturity_days; unknown age takes unknown_age_multiplier.
//   chainMult       = 1 + chain_weight x min(ln(chain count), ln(chain_cap))
//   implied         = max(1, round(tvl_usd x category multiple x growthMult x maturityMult x chainMult))
//
// The constants are the model's, stated in the dashboard and changeable in the model sandbox. No
// protocol name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  /** Prior strength of the shrinkage: how many phantom live tokens at the global median each category carries. */
  shrinkage_k: number;
  /** The band a category multiple is clamped to. */
  multiple_min: number;
  multiple_max: number;
  /** Ratios above this are winsorized before any median is taken: a token's market cap can dwarf its
      own pool's TVL (a lending token priced on the whole protocol, not one pool), so an uncapped
      ratio would let one mismatch set a thin category's multiple. */
  ratio_cap: number;
  /** How much relative 7d growth moves the value (0.5: +100pp of relative growth adds 50%). */
  growth_weight: number;
  /** Relative growth is clamped to this band, in percentage points. */
  rel_growth_floor: number;
  rel_growth_cap: number;
  /** Maturity at age zero; it rises linearly to 1.0 at maturity_days. */
  maturity_floor: number;
  /** The age, in days, at which maturity saturates. */
  maturity_days: number;
  /** The maturity multiplier when the protocol's listing date is unknown. */
  unknown_age_multiplier: number;
  /** How much chain breadth moves the value: 0.04 per log unit, capped at chain_cap chains. */
  chain_weight: number;
  chain_cap: number;
  /** A category needs this many reporters for its own median 7d change; fewer take the global median. */
  growth_reporters_min: number;
}

export const MODEL: ModelConstants = {
  shrinkage_k: 6,
  multiple_min: 0.02,
  multiple_max: 1.2,
  ratio_cap: 3,
  growth_weight: 0.5,
  rel_growth_floor: -50,
  rel_growth_cap: 100,
  maturity_floor: 0.7,
  maturity_days: 730,
  unknown_age_multiplier: 0.85,
  chain_weight: 0.04,
  chain_cap: 32,
  growth_reporters_min: 5,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's calibration: what its live tokens trade at, and the multiple the model applies. */
export interface CategoryCalibration {
  category: string;
  /** Live-token protocols of this category with both a market cap and a TVL. */
  live_n: number;
  /** The median mcap/TVL of those live tokens, or null when the category has none. */
  median_multiple: number | null;
  /** The shrunk multiple the model applies to pre-token protocols of this category. */
  multiple: number;
  /** The median 7d TVL change of this category's protocols, or null when too few report one. */
  median_change_7d: number | null;
  reporters_n: number;
}

/** Everything the calibration learned from the snapshot's live-token protocols. */
export interface Calibration {
  /** Live-token protocols with both a market cap and a TVL. */
  live_n: number;
  /** The global median mcap/TVL across them. */
  global_median: number;
  /** The global median 7d TVL change across every protocol that reports one. */
  global_change_7d: number;
  /** One row per category that holds a live token or a reporter, by category name. */
  categories: CategoryCalibration[];
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** The model's own breakdown of one row's implied value, so a reader can check every number. */
export interface ModelBreakdown {
  category_multiple: number;
  category_live_n: number;
  category_median: number | null;
  growth_pct: number | null;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  age_days: number | null;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
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
  model: ModelBreakdown;
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with the farm plan generated in the page. */
export interface RadarRow {
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
  on_watchlist: boolean;
  category_multiple: number;
  category_live_n: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the calibration and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  calibration: Calibration;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The median of a non-empty list of numbers; the middle value, or the mean of the two middles. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/**
 * Calibrate the model from the snapshot's live-token protocols: the global median mcap/TVL, each
 * category's median and its shrunk multiple, and each category's median 7d change. Deterministic: the
 * categories come out sorted by name, and every median is taken over a sorted list.
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const ratios = live.map((p) => Math.min(p.mcap_usd! / p.tvl_usd, model.ratio_cap));
  const globalMedian = ratios.length > 0 ? median(ratios) : 0.25;
  const changes = snapshot.protocols
    .filter((p) => p.change_7d !== null)
    .map((p) => p.change_7d as number);
  const globalChange = changes.length > 0 ? median(changes) : 0;

  const byCategory = new Map<string, { ratios: number[]; changes: number[] }>();
  for (const p of snapshot.protocols) {
    if (p.category === null) continue;
    let bucket = byCategory.get(p.category);
    if (bucket === undefined) {
      bucket = { ratios: [], changes: [] };
      byCategory.set(p.category, bucket);
    }
    if (p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0) bucket.ratios.push(Math.min(p.mcap_usd / p.tvl_usd, model.ratio_cap));
    if (p.change_7d !== null) bucket.changes.push(p.change_7d);
  }

  const categories: CategoryCalibration[] = [...byCategory.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([category, bucket]) => {
      const n = bucket.ratios.length;
      const catMedian = n > 0 ? median(bucket.ratios) : null;
      const shrunk =
        catMedian === null
          ? globalMedian
          : (n * catMedian + model.shrinkage_k * globalMedian) / (n + model.shrinkage_k);
      const multiple = Math.min(model.multiple_max, Math.max(model.multiple_min, shrunk));
      const reporters = bucket.changes.length;
      return {
        category,
        live_n: n,
        median_multiple: catMedian === null ? null : round4(catMedian),
        multiple: round4(multiple),
        median_change_7d: reporters >= model.growth_reporters_min ? round4(median(bucket.changes)) : null,
        reporters_n: reporters,
      };
    });

  return {
    live_n: live.length,
    global_median: round4(globalMedian),
    global_change_7d: round4(globalChange),
    categories,
  };
}

/** The calibration row for one category, or null when the category has no live token or reporter. */
function calibrationFor(calibration: Calibration, category: string | null): CategoryCalibration | null {
  if (category === null) return null;
  for (const row of calibration.categories) if (row.category === category) return row;
  return null;
}

/** The multiple a pre-token protocol of `category` is scored at. */
export function multipleFor(calibration: Calibration, category: string | null): number {
  const row = calibrationFor(calibration, category);
  return row === null ? calibration.global_median : row.multiple;
}

/** The 7d change a protocol's growth is measured against: its category's median, else the global one. */
export function baselineChangeFor(calibration: Calibration, category: string | null): number {
  const row = calibrationFor(calibration, category);
  if (row !== null && row.median_change_7d !== null) return row.median_change_7d;
  return calibration.global_change_7d;
}

/** The implied value one protocol gets, with every factor that produced it. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  calibration: Calibration,
  model: ModelConstants = MODEL,
): { implied: number; breakdown: ModelBreakdown } {
  const age = ageDays(asOf, protocol.listed_at);
  const cat = calibrationFor(calibration, protocol.category);
  const multiple = cat === null ? calibration.global_median : cat.multiple;

  // Growth is relative: a protocol that held flat while its category fell 8% grew, in relative terms.
  // A missing 7d change counts as the baseline, so it neither helps nor hurts.
  const baseline = baselineChangeFor(calibration, protocol.category);
  const rawGrowth = protocol.change_7d === null ? baseline : protocol.change_7d;
  const relGrowth = Math.min(model.rel_growth_cap, Math.max(model.rel_growth_floor, rawGrowth - baseline));
  const growthMult = 1 + (relGrowth / 100) * model.growth_weight;

  // Maturity saturates at two years: a protocol that has run that long with no token has proved it can
  // hold TVL without one. An unknown listing date takes the neutral multiplier, not the floor.
  const maturityMult =
    age === null
      ? model.unknown_age_multiplier
      : model.maturity_floor + (1 - model.maturity_floor) * (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days);

  // Chain breadth, log-scaled and capped: the second chain matters, the thirty-third barely does.
  const chainCount = Math.max(1, protocol.chains.length);
  const chainMult = 1 + model.chain_weight * Math.min(Math.log(chainCount), Math.log(model.chain_cap));

  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * chainMult));
  return {
    implied,
    breakdown: {
      category_multiple: multiple,
      category_live_n: cat === null ? 0 : cat.live_n,
      category_median: cat === null ? null : cat.median_multiple,
      growth_pct: protocol.change_7d === null ? null : round4(relGrowth),
      growth_multiplier: round4(growthMult),
      maturity_multiplier: round4(maturityMult),
      chain_multiplier: round4(chainMult),
      age_days: age,
    },
  };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const calibration = calibrate(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol below the watchlist floor, not just the largest
  // few. Never a replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, breakdown } = impliedValue(p, snapshot.as_of, calibration, model);
    return { p, implied, breakdown };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.breakdown.age_days,
    implied_value_usd: s.implied,
    model: s.breakdown,
    farm_steps: farmSteps(s.p, s.breakdown.age_days).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and borrow a small amount against it.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('dex')) return `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC through ${name} to ${chain} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return `Deposit $${capital} of USDC into ${name}'s main vault on ${chain} and leave it compounding.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in your wallet.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and place one position on a market you follow.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('launchpad')) return `Complete ${name}'s allowlist tasks on ${chain} and stake the $${capital} it asks for.`;
  if (c.includes('ai ') || c.includes('ai agent') || c.startsWith('ai')) return `Run ${name}'s agent product on ${chain} with $${capital} and complete its daily tasks.`;
  if (c.includes('payment')) return `Route $${capital} of payments through ${name} on ${chain} and keep the receipts.`;
  if (c.includes('nft')) return `List or trade through ${name} on ${chain} with about $${capital} of volume.`;
  if (c.includes('index')) return `Mint $${capital} of ${name}'s index token on ${chain} and hold it.`;
  if (c.includes('governance')) return `Join ${name}'s governance forum, complete its contributor tasks and hold $${capital} of its assets.`;
  if (c.includes('privacy')) return `Use ${name}'s privacy pool on ${chain} with $${capital} and keep the withdrawal note safe.`;
  if (c.includes('chain')) return `Bridge $${capital} to ${name}'s chain and use its flagship app once a week.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's weekly action: the second thing that keeps the wallet looking active. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'a deposit, a borrow, a repay or a vote';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return 'a small trade, a margin top-up or a funding payment';
  if (c.includes('dex')) return 'a swap, a liquidity add or a fee claim';
  if (c.includes('bridge')) return 'a bridge, a swap on the destination chain or a vote';
  if (c.includes('staking') || c.includes('restak')) return 'a restake, a reward claim or a delegation change';
  if (c.includes('yield') || c.includes('farm')) return 'a deposit, a harvest or a vault switch';
  if (c.includes('prediction')) return 'a market position, a resolution check or a vote';
  if (c.includes('governance')) return 'a forum post, a vote or a contributor task';
  if (c.includes('nft')) return 'a listing, a trade or an offer';
  return 'a deposit, a swap, a claim or a vote';
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as ${weeklyFor(p)}, so the wallet stays active between snapshots.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page from its official docs and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Keep this farm to the $${capital} above: if the protocol were hacked tomorrow you would lose only that. Check its audit status and 7-day TVL trend before adding more.`,
      cost: 'nothing to check',
      time: '15 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, LIVE_ROWS)
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

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow, onWatchlist: boolean): RadarRow {
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
    on_watchlist: onWatchlist,
    category_multiple: row.model.category_multiple,
    category_live_n: row.model.category_live_n,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const calibration = calibrate(snapshot, model);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watch.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    calibration,
    rows: board.map((r) => radarRow(r, watch.has(r.slug))),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
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
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
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
    for (const s of steps) {
      const trimmed = s.trim();
      if (trimmed.length < 20 || trimmed.length > 600) return `${r.slug} has a farm step of ${trimmed.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
