import { UniverseScreener } from "@/components/screener/universe-screener";
import "@/lib/providers/register";

export const dynamic = "force-dynamic";
export const metadata = { title: "Screener" };

/**
 * SCREENER — the same precomputed canonical universe the Opportunities page
 * reads. All 6,000+ companies are present the moment the page opens; filter
 * changes are in-memory queries (1–4ms measured), never provider calls.
 */
export default async function ScreenerPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await props.searchParams;
  const sector = typeof sp.sector === "string" ? sp.sector : undefined;
  return <UniverseScreener initialSector={sector} />;
}
