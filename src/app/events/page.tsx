import Link from "next/link";
import { Chip, Empty, Note, Panel } from "@/components/shell/ui";
import { buildCalendar } from "@/lib/events/calendar";
import { MACRO_SENSITIVITY, TEMPLATES, DIRECTION_LABEL } from "@/lib/events/playbook";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function countdown(date: string): string {
  const days = Math.round(
    (Date.parse(`${date}T12:00:00Z`) - Date.now()) / 86_400_000,
  );
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 0) return `in ${days}d`;
  return `${Math.abs(days)}d ago`;
}

const TONE = { HIGH: "neg", MEDIUM: "warn", LOW: "neutral" } as const;

/**
 * Calendar view. Deliberately compact — the detail lives one click away in the
 * per-event playbook so this screen stays scannable.
 */
export default function EventsPage() {
  const all = buildCalendar(1, 3);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = all.filter((e) => e.date >= today).slice(0, 24);
  const past = all.filter((e) => e.date < today).reverse().slice(0, 10);

  return (
    <div className="flex flex-col gap-3">
      <Note tone="info">
        <span>
          Scenario directions are stated <strong>sensitivities</strong>, not forecasts. Consensus,
          previous prints and market-implied probabilities are <strong>N/A</strong> — the
          configured data plan has no economic calendar, so none are estimated.
        </span>
      </Note>

      <Panel
        title="Upcoming Events"
        subtitle="dates from published release rules and central-bank schedules"
        bodyClassName="p-0"
      >
        {upcoming.length === 0 ? (
          <Empty>No events in the window.</Empty>
        ) : (
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Date</th>
                <th className="tl">Countdown</th>
                <th className="tl">Event</th>
                <th className="tl">Importance</th>
                <th className="tl">Previous</th>
                <th className="tl">Consensus</th>
                <th className="tl">Relevant positions</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((e) => {
                const tpl = TEMPLATES[e.kind];
                return (
                  <tr key={e.id}>
                    <td className="tl tabular-nums">{e.date}</td>
                    <td className="tl text-[10px] text-[var(--ink-3)]">{countdown(e.date)}</td>
                    <td className="tl font-semibold">
                      <Link
                        href={`/events/${encodeURIComponent(e.id)}`}
                        className="hover:text-[var(--amber)]"
                      >
                        {e.title}
                      </Link>
                    </td>
                    <td className="tl">
                      <Chip tone={TONE[e.importance]}>{e.importance}</Chip>
                    </td>
                    <td className="tl text-[10px] text-[var(--ink-3)]">
                      {e.previous ?? "N/A"}
                    </td>
                    <td className="tl text-[10px] text-[var(--ink-3)]">
                      {e.consensus ?? "N/A"}
                    </td>
                    <td className="tl">
                      <div className="flex flex-wrap gap-1">
                        {tpl.relevantPositions.slice(0, 5).map((c) => (
                          <span
                            key={c}
                            className="rounded-sm border border-[var(--line)] px-1 py-px text-[9px]"
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Recent Events" subtitle="switch to review once released" bodyClassName="p-0">
        {past.length === 0 ? (
          <Empty>Nothing in the recent window.</Empty>
        ) : (
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Date</th>
                <th className="tl">Event</th>
                <th className="tl">Status</th>
                <th className="tl">Actual</th>
              </tr>
            </thead>
            <tbody>
              {past.map((e) => (
                <tr key={e.id}>
                  <td className="tl tabular-nums">{e.date}</td>
                  <td className="tl font-semibold">
                    <Link
                      href={`/events/${encodeURIComponent(e.id)}`}
                      className="hover:text-[var(--amber)]"
                    >
                      {e.title}
                    </Link>
                  </td>
                  <td className="tl">
                    <Chip tone="neutral">EVENT REVIEW</Chip>
                  </td>
                  <td className="tl text-[10px] text-[var(--ink-3)]">{e.actual ?? "N/A"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel
        title="Macro Sensitivity Map"
        subtitle="which holdings respond to which driver — stated sensitivities, not forecasts"
        bodyClassName="p-0"
      >
        <div className="divide-y divide-[var(--line-soft)]">
          {MACRO_SENSITIVITY.map((m) => (
            <div key={m.driver} className="px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-semibold">{m.driver}</span>
                <span className="text-[10px] text-[var(--ink-3)]">{m.note}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {m.positions.map((p) => (
                  <span
                    key={p.code}
                    title={`${p.why} — ${DIRECTION_LABEL[p.direction]}`}
                    className={cn(
                      "rounded-sm border px-1.5 py-0.5 text-[10px]",
                      p.direction.startsWith("+")
                        ? "border-emerald-500/40 text-emerald-400"
                        : p.direction.startsWith("-")
                          ? "border-rose-500/40 text-rose-400"
                          : "border-[var(--line)] text-[var(--ink-3)]",
                    )}
                  >
                    {p.code} {p.direction}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
