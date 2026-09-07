import { QuantLab } from "@/components/quant/quant-lab";
import "@/lib/providers/register";

export const dynamic = "force-dynamic";
export const metadata = { title: "Quant Lab" };

/** QUANT LAB — user-driven backtests of the live signal engine. */
export default async function QuantPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await props.searchParams;
  const symbols = typeof sp.symbols === "string" && sp.symbols ? sp.symbols : "AAPL, NVDA, MU";
  return <QuantLab initial={symbols} />;
}
