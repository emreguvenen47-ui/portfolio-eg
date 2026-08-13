import { CompareLab } from "@/components/compare/compare-lab";

export const dynamic = "force-dynamic";
export const metadata = { title: "Comparison Lab" };

export default async function ComparePage(props: PageProps<"/compare">) {
  const sp = await props.searchParams;
  const raw = typeof sp.symbols === "string" ? sp.symbols : "";
  const initial = raw
    ? raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 5)
    : ["AAPL", "MSFT", "NVDA"];

  return <CompareLab initial={initial} />;
}
