import Link from "next/link";
import { getContext } from "@/lib/server/context";
import { Chip, Note, Panel } from "@/components/shell/ui";
import { CHAINS, WORLD_THEMES, type Confidence, type ExposureKind } from "@/lib/events/chains";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Event Chains" };

const CONF_TONE: Record<Confidence, "pos" | "neutral" | "warn"> = {
  HIGH: "pos",
  MEDIUM: "neutral",
  LOW: "warn",
};

const KIND_TONE: Record<ExposureKind, "neg" | "neutral" | "pos"> = {
  DIRECT: "neg",
  INDIRECT: "neutral",
  HEDGE: "pos",
};

export default async function ChainsPage() {
  const ctx = await getContext().catch(() => null);
  const held = new Set(
    (ctx?.rows ?? []).map((r) => (r.position.symbol ?? r.position.code).toUpperCase()),
  );

  return (
    <div className="flex flex-col gap-3">
      <Note tone="warn">
        <span>
          <strong>Transmission mechanisms, not forecasts.</strong> Each chain describes how an
          impulse would propagate <em>if</em> the trigger occurs. Nothing here says it will, and
          the confidence tag refers to how well-established the linkage is — not to how likely
          the event is. Positions you actually hold are highlighted.
        </span>
      </Note>

      <Panel
        title="World Events → Portfolio"
        subtitle="which themes reach the book, and through what"
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Theme</th>
                <th className="tl">Category</th>
                <th className="tl">Asset</th>
                <th className="tl">Exposure</th>
                <th className="tl">Why</th>
              </tr>
            </thead>
            <tbody>
              {WORLD_THEMES.flatMap((t) =>
                t.exposures.map((e, i) => (
                  <tr key={`${t.id}-${e.symbol}`}>
                    {i === 0 && (
                      <>
                        <td className="tl font-semibold" rowSpan={t.exposures.length}>
                          {t.chainId ? (
                            <Link href={`#${t.chainId}`} className="hover:text-[var(--amber)]">
                              {t.label}
                            </Link>
                          ) : (
                            t.label
                          )}
                        </td>
                        <td
                          className="tl text-[10px] text-[var(--ink-3)]"
                          rowSpan={t.exposures.length}
                        >
                          {t.category}
                        </td>
                      </>
                    )}
                    <td className="tl">
                      <Link
                        href={`/ticker/${e.symbol}`}
                        className={cn(
                          "hover:text-[var(--amber)]",
                          held.has(e.symbol) && "font-semibold text-[var(--amber)]",
                        )}
                      >
                        {e.symbol}
                      </Link>
                      {held.has(e.symbol) && (
                        <span className="ml-1 text-[9px] text-[var(--ink-3)]">held</span>
                      )}
                    </td>
                    <td className="tl">
                      <Chip tone={KIND_TONE[e.kind]}>{e.kind}</Chip>
                    </td>
                    <td className="tl max-w-[420px] whitespace-normal text-[10px] leading-snug text-[var(--ink-3)]">
                      {e.why}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {CHAINS.map((chain) => (
        <Panel
          key={chain.id}
          title={chain.title}
          subtitle={chain.trigger}
          bodyClassName="p-0"
        >
          <div id={chain.id} className="border-b border-[var(--line)] px-3 py-2 text-[10.5px] leading-snug text-[var(--ink-2)]">
            {chain.premise}
          </div>
          {([1, 2, 3] as const).map((order) => {
            const nodes = chain.nodes.filter((n) => n.order === order);
            if (!nodes.length) return null;
            return (
              <div key={order} className="border-b border-[var(--line)] last:border-b-0">
                <div className="bg-[var(--panel-2)] px-3 py-1 text-[9.5px] uppercase tracking-wide text-[var(--ink-3)]">
                  {order === 1 ? "1st order" : order === 2 ? "2nd order" : "3rd order"}
                </div>
                {nodes.map((n) => (
                  <div key={n.id} className="px-3 py-2">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-[11.5px] font-semibold">{n.label}</span>
                      <Chip tone={CONF_TONE[n.confidence]}>{n.confidence}</Chip>
                      <span className="flex flex-wrap gap-1">
                        {n.assets.map((a) => (
                          <Link
                            key={a}
                            href={`/ticker/${a}`}
                            className={cn(
                              "rounded-sm border border-[var(--line)] px-1.5 py-0.5 text-[9.5px] hover:border-[var(--ink-3)]",
                              held.has(a)
                                ? "border-[var(--amber)]/50 text-[var(--amber)]"
                                : "text-[var(--ink-2)]",
                            )}
                          >
                            {a}
                          </Link>
                        ))}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[10px] leading-snug text-[var(--ink-3)]">
                      <span className="text-[var(--ink-2)]">Why:</span> {n.why}
                    </p>
                  </div>
                ))}
              </div>
            );
          })}
        </Panel>
      ))}
    </div>
  );
}
