import { ScreenerView } from "@/components/screener/screener-view";
import "@/lib/providers/register";

export const dynamic = "force-dynamic";
export const metadata = { title: "Custom Screener" };

export default async function ScreenerPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await props.searchParams;
  const sector = typeof sp.sector === "string" ? sp.sector : undefined;
  return <ScreenerView initialSector={sector} />;
}
