import "server-only";
import type { HiringActivity, HiringSource, Trend } from "@/lib/research/alt-data";
import { listJobSnapshots, saveJobSnapshot } from "@/lib/server/job-store";

/**
 * Job postings from Greenhouse public job boards.
 *
 * Greenhouse serves each company's board as a real JSON API that the company
 * itself publishes for its careers page. That is structured first-party data,
 * not a scrape, and it is the only job source here for that reason: LinkedIn
 * and Indeed are explicitly off the table.
 *
 * Coverage is an explicit map because a board slug is not derivable from a
 * ticker, and a wrong guess returns another company's jobs with a 200. Every
 * entry below was verified to return a real board.
 *
 * The mega-caps are absent on purpose — Apple, Microsoft, Nvidia and the rest
 * run their own applicant systems with no public API, so they read N/A rather
 * than being filled from somewhere less reliable.
 */

const BASE = "https://boards-api.greenhouse.io/v1/boards";
const TIMEOUT_MS = 12_000;

/** ticker -> Greenhouse board slug. Verified to return a live board. */
const BOARDS: Record<string, { slug: string; company: string }> = {
  COIN: { slug: "coinbase", company: "Coinbase" },
  DDOG: { slug: "datadog", company: "Datadog" },
  HOOD: { slug: "robinhood", company: "Robinhood" },
  ABNB: { slug: "airbnb", company: "Airbnb" },
  NET: { slug: "cloudflare", company: "Cloudflare" },
  GTLB: { slug: "gitlab", company: "GitLab" },
  MDB: { slug: "mongodb", company: "MongoDB" },
  TWLO: { slug: "twilio", company: "Twilio" },
  RBLX: { slug: "roblox", company: "Roblox" },
  AFRM: { slug: "affirm", company: "Affirm" },
  TOST: { slug: "toast", company: "Toast" },
  IOT: { slug: "samsara", company: "Samsara" },
  ZS: { slug: "zscaler", company: "Zscaler" },
  ASAN: { slug: "asana", company: "Asana" },
};

export const greenhouseCovers = (ticker: string): boolean =>
  Boolean(BOARDS[ticker.trim().toUpperCase()]);

export const GREENHOUSE_UNIVERSE = Object.keys(BOARDS);

export type JobCategory =
  | "AI/ML"
  | "Software/Engineering"
  | "Hardware/Semiconductor"
  | "Sales"
  | "Manufacturing"
  | "Operations"
  | "Finance"
  | "International"
  | "Other";

/**
 * Category from the job title and department.
 *
 * Order matters: an "AI Infrastructure Engineer" is counted as AI rather than
 * generic engineering, because the whole point of the breakdown is to see
 * where hiring is being redirected.
 */
export function categorise(title: string, department: string, location: string): JobCategory {
  const t = `${title} ${department}`.toLowerCase();
  if (/\b(ai|ml|machine learning|deep learning|llm|nlp|data scien|research scien)\b/.test(t)) {
    return "AI/ML";
  }
  if (/\b(hardware|silicon|asic|fpga|semiconductor|chip|electrical eng)\b/.test(t)) {
    return "Hardware/Semiconductor";
  }
  if (/\b(engineer|developer|software|infrastructure|platform|devops|sre|security eng)\b/.test(t)) {
    return "Software/Engineering";
  }
  if (/\b(sales|account executive|business development|revenue|partnership)\b/.test(t)) return "Sales";
  if (/\b(manufactur|production|assembly|supply chain|fulfil)\b/.test(t)) return "Manufacturing";
  if (/\b(finance|accounting|controller|treasury|fp&a|audit)\b/.test(t)) return "Finance";
  if (/\b(operations|support|success|program manager|logistics)\b/.test(t)) return "Operations";
  // Location is only consulted last: a US-titled role posted abroad is still
  // its function first, international second.
  if (location && !/united states|usa|remote - us|,\s*(ca|ny|wa|tx|ma|il)\b/i.test(location)) {
    return "International";
  }
  return "Other";
}

interface GhJob {
  id?: number;
  title?: string;
  updated_at?: string;
  location?: { name?: string };
  departments?: { name?: string }[];
  metadata?: unknown;
}

export interface JobRow {
  jobId: string;
  title: string;
  department: string;
  location: string;
  postedAt: string | null;
  category: JobCategory;
}

/** Fetch the live board. One request per company. */
export async function fetchBoard(ticker: string): Promise<JobRow[] | null> {
  const entry = BOARDS[ticker.trim().toUpperCase()];
  if (!entry) return null;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/${entry.slug}/jobs`, {
      signal: ctl.signal,
      cache: "no-store",
      headers: { "User-Agent": "PortfolioEG/1.0" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { jobs?: GhJob[] };
    const jobs = json.jobs ?? [];
    if (jobs.length === 0) return null;

    return jobs.map((j) => {
      const title = j.title ?? "";
      const department = j.departments?.[0]?.name ?? "";
      const location = j.location?.name ?? "";
      return {
        jobId: String(j.id ?? `${title}-${location}`),
        title,
        department,
        location,
        postedAt: j.updated_at ?? null,
        category: categorise(title, department, location),
      };
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const CATEGORIES: JobCategory[] = [
  "AI/ML",
  "Software/Engineering",
  "Hardware/Semiconductor",
  "Sales",
  "Manufacturing",
  "Operations",
  "Finance",
  "International",
  "Other",
];

const pctChange = (now: number, then: number | null): number | null =>
  then === null || then === 0 ? null : ((now - then) / then) * 100;

/**
 * Hiring activity, from today's board against stored snapshots.
 *
 * The change figures are the reason snapshots are persisted at all: a job
 * board is a level, and a level tells you nothing about direction. Without a
 * prior snapshot the counts are real but the changes read N/A rather than
 * being estimated from posting dates, which reflect edits rather than
 * openings.
 */
export const greenhouseSource: HiringSource = {
  name: "Greenhouse public job boards",

  async hiring(ticker: string): Promise<HiringActivity | null> {
    const key = ticker.trim().toUpperCase();
    const entry = BOARDS[key];
    if (!entry) return null;

    const rows = await fetchBoard(key);
    if (!rows) return null;

    const byCat = new Map<JobCategory, number>();
    for (const r of rows) byCat.set(r.category, (byCat.get(r.category) ?? 0) + 1);

    // Persist today's counts so tomorrow has something to compare against.
    await saveJobSnapshot({
      ticker: key,
      company: entry.company,
      total: rows.length,
      byCategory: Object.fromEntries(CATEGORIES.map((c) => [c, byCat.get(c) ?? 0])),
      source: "greenhouse",
    }).catch(() => undefined);

    const history = await listJobSnapshots(key).catch(() => []);
    const at = (days: number): { total: number; byCategory: Record<string, number> } | null => {
      const cutoff = Date.now() - days * 86_400_000;
      // Nearest snapshot at or before the cutoff; null when we were not
      // collecting yet.
      const older = history.filter((h) => Date.parse(h.capturedAt) <= cutoff);
      return older.length ? older[older.length - 1] : null;
    };

    const s30 = at(30);
    const s90 = at(90);
    const change30d = s30 ? pctChange(rows.length, s30.total) : null;
    const change90d = s90 ? pctChange(rows.length, s90.total) : null;

    let trend: Trend = "N/A";
    if (change90d !== null) {
      trend = change90d > 10 ? "ACCELERATING" : change90d < -10 ? "DECELERATING" : "STABLE";
    } else if (change30d !== null) {
      trend = change30d > 10 ? "ACCELERATING" : change30d < -10 ? "DECELERATING" : "STABLE";
    }

    return {
      totalOpenings: rows.length,
      change30d,
      change90d,
      byCategory: CATEGORIES.filter((c) => (byCat.get(c) ?? 0) > 0).map((c) => ({
        label: c,
        count: byCat.get(c) ?? 0,
        change90d: s90 ? pctChange(byCat.get(c) ?? 0, s90.byCategory[c] ?? null) : null,
      })),
      trend,
    };
  },
};

/** Why the change columns are blank on a first run. */
export const SNAPSHOT_NOTE =
  "Open-role counts are live from each company's own Greenhouse board. Change figures compare against stored daily snapshots, so they read N/A until this app has been collecting for the relevant window — posting dates reflect edits rather than when a role opened, so they are not used as a substitute.";
