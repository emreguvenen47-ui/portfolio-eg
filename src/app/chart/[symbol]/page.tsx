import { Workstation } from "@/components/chart/workstation";
import "@/lib/providers/register";

export const dynamic = "force-dynamic";
export const metadata = { title: "Technical Workstation" };

/**
 * COMMAND CHART — the fullscreen Technical Workstation route.
 *
 * Layout: LEFT drawing tools · CENTER chart · TOP timeframe/type/indicators ·
 * RIGHT EG Technical Analysis (Analyze, layer toggles, NL command, paper
 * trade). Uses the same canonical decision/report engines as the stock page
 * and the screener — one signal source, never a second engine.
 */
export default async function ChartPage(props: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await props.params;
  return <Workstation symbol={decodeURIComponent(symbol).toUpperCase()} />;
}
