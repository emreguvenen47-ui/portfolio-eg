import "server-only";
import type { EventKind } from "@/lib/events/playbook";
import type { Release, ReleaseSource } from "@/lib/events/analogues";

/**
 * Economic releases from FRED.
 *
 * FRED redistributes the primary series — BLS for CPI and payrolls, BEA for
 * PCE and GDP, the Board for the funds target, the ECB for the deposit rate —
 * and serves them as CSV with no API key. That makes it the one authoritative
 * source reachable from this deployment, and it replaces the previous
 * behaviour where previous/actual simply read N/A.
 *
 * Two honesty constraints are built in:
 *
 * 1. Consensus is NOT available here and is never synthesised. FRED carries
 *    what was published, not what economists expected, and deriving a
 *    "consensus" from the previous print would be inventing the one number the
 *    surprise is measured against. It stays null.
 *
 * 2. Values are as-currently-revised. ALFRED serves original vintages but
 *    requires a key, so `revisedPrevious` is only populated when a provider
 *    that carries vintages is registered. The UI states this.
 */

const BASE = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const CACHE_TTL_MS = 6 * 60 * 60_000;

const CACHE_KEY = Symbol.for("pcc.fred.cache");
const cache: Map<string, { at: number; obs: Observation[] }> = ((
  globalThis as unknown as Record<symbol, Map<string, { at: number; obs: Observation[] }>>
)[CACHE_KEY] ??= new Map());

export interface Observation {
  date: string;
  value: number;
}

async function series(id: string): Promise<Observation[]> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.obs;

  // A slow secondary source must not hold up the page that embeds it.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  const res = await fetch(`${BASE}?id=${encodeURIComponent(id)}`, {
    cache: "no-store",
    signal: ctl.signal,
    headers: { "User-Agent": "PortfolioEG/1.0" },
  }).finally(() => clearTimeout(timer));
  if (!res.ok) throw new Error(`FRED HTTP ${res.status} for ${id}`);
  const text = await res.text();

  const obs: Observation[] = [];
  for (const line of text.trim().split("\n").slice(1)) {
    const [date, raw] = line.split(",");
    const value = Number(raw);
    // FRED writes "." for a missing observation; skip rather than zero it.
    if (date && Number.isFinite(value)) obs.push({ date, value });
  }
  cache.set(id, { at: Date.now(), obs });
  return obs;
}

/** How the headline figure for each release is derived from its series. */
type Transform = "mom-pct" | "yoy-pct" | "level" | "level-diff-thousands";

interface SeriesSpec {
  id: string;
  transform: Transform;
  unit: string;
  label: string;
  /** Which agency actually produces it, for the source line. */
  origin: string;
}

const SPECS: Partial<Record<EventKind, SeriesSpec>> = {
  US_CPI: {
    id: "CPIAUCSL",
    transform: "mom-pct",
    unit: "% m/m",
    label: "CPI, all items, seasonally adjusted",
    origin: "US Bureau of Labor Statistics via FRED",
  },
  US_PCE: {
    id: "PCEPILFE",
    transform: "mom-pct",
    unit: "% m/m",
    label: "Core PCE price index",
    origin: "US Bureau of Economic Analysis via FRED",
  },
  US_NFP: {
    id: "PAYEMS",
    transform: "level-diff-thousands",
    unit: "k jobs",
    label: "Total nonfarm payrolls, change on month",
    origin: "US Bureau of Labor Statistics via FRED",
  },
  US_GDP: {
    id: "A191RL1Q225SBEA",
    transform: "level",
    unit: "% q/q annualised",
    label: "Real GDP, annualised quarterly rate",
    origin: "US Bureau of Economic Analysis via FRED",
  },
  FOMC: {
    id: "DFEDTARU",
    transform: "level",
    unit: "% upper target",
    label: "Federal funds target range, upper limit",
    origin: "Federal Reserve Board via FRED",
  },
  ECB: {
    id: "ECBDFR",
    transform: "level",
    unit: "%",
    label: "ECB deposit facility rate",
    origin: "European Central Bank via FRED",
  },
};

/** Apply the transform at index `i`, or null when the inputs are missing. */
function derive(obs: Observation[], i: number, t: Transform): number | null {
  const cur = obs[i];
  const prev = obs[i - 1];
  if (!cur) return null;
  switch (t) {
    case "level":
      return cur.value;
    case "mom-pct":
      return prev && prev.value !== 0 ? ((cur.value - prev.value) / prev.value) * 100 : null;
    case "yoy-pct": {
      const yearAgo = obs[i - 12];
      return yearAgo && yearAgo.value !== 0
        ? ((cur.value - yearAgo.value) / yearAgo.value) * 100
        : null;
    }
    case "level-diff-thousands":
      return prev ? cur.value - prev.value : null;
  }
}

/**
 * A policy rate only "releases" when it changes; the daily series repeats the
 * same value in between. For those, the meaningful previous value is the last
 * different one, not yesterday's identical print.
 */
function lastChangeIndex(obs: Observation[], from: number): number | null {
  for (let i = from - 1; i >= 0; i--) {
    if (obs[i].value !== obs[from].value) return i;
  }
  return null;
}

export const fredSource: ReleaseSource = {
  name: "FRED (BLS / BEA / Federal Reserve / ECB)",

  async lastRelease(kind: EventKind): Promise<Release | null> {
    const spec = SPECS[kind];
    if (!spec) return null;

    const obs = await series(spec.id);
    if (obs.length < 3) return null;

    const last = obs.length - 1;
    const isRate = spec.transform === "level" && (kind === "FOMC" || kind === "ECB");

    const actual = derive(obs, last, spec.transform);
    let previous: number | null;
    let period: string;

    if (isRate) {
      const changeAt = lastChangeIndex(obs, last);
      previous = changeAt !== null ? obs[changeAt].value : null;
      // For a policy rate the meaningful period is when it last moved.
      period = changeAt !== null ? `since ${obs[changeAt + 1]?.date ?? obs[last].date}` : obs[last].date;
    } else {
      previous = derive(obs, last - 1, spec.transform);
      period = obs[last].date.slice(0, 7);
    }

    return {
      period,
      releasedAt: obs[last].date,
      previous,
      consensus: null,
      actual,
      // Surprise is against consensus by definition. With no consensus source
      // there is no surprise, and computing actual-minus-previous and calling
      // it one would be inventing the benchmark.
      surprise: null,
      unit: spec.unit,
    };
  },
};

/** Series metadata for the UI's source line. */
export const releaseSourceInfo = (kind: EventKind): { label: string; origin: string } | null => {
  const s = SPECS[kind];
  return s ? { label: s.label, origin: s.origin } : null;
};

/** Recent history of a release, for the "what happened" comparison. */
export async function releaseHistory(
  kind: EventKind,
  count = 12,
): Promise<{ period: string; value: number | null }[]> {
  const spec = SPECS[kind];
  if (!spec) return [];
  const obs = await series(spec.id).catch(() => []);
  const out: { period: string; value: number | null }[] = [];
  for (let i = Math.max(1, obs.length - count); i < obs.length; i++) {
    out.push({ period: obs[i].date.slice(0, 7), value: derive(obs, i, spec.transform) });
  }
  return out;
}
