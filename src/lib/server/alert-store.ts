import "server-only";
import { randomUUID } from "node:crypto";
import { ownerOrRefuse } from "./auth";
import { useFallback } from "./supabase";
import { devCollection, devList } from "./dev-store";
import type { AlertKind, AlertRule } from "@/lib/portfolio/alert-engine";

/**
 * User-defined alert rules and the log of fires.
 *
 * Once the tables exist, Supabase is the only store: reads go to it, and a
 * failed write throws rather than being absorbed by a memory copy. A write
 * that reports success while the row never landed is worse than an error,
 * because the rule then disappears on the next deploy with no trace.
 *
 * The fallback below covers two cases: no Supabase credentials at all, and
 * credentials present but the migrations not yet run. It is written to disk so
 * a restart does not destroy the user's rules, and the second case logs a
 * one-time setup hint.
 */

export interface AlertEvent {
  id: string;
  ruleId: string;
  subject: string;
  kind: AlertKind;
  detail: string;
  value: number | null;
  at: string;
}

const TABLE_RULES = "alert_rules";
const TABLE_EVENTS = "alert_events";

/**
 * Fallback store, used when Supabase is unavailable. Disk-backed so a restart
 * does not silently delete every rule the user set up.
 */
const rules = devCollection<AlertRule>("alert-rules");
const events = devList<AlertEvent>("alert-events", 500);

function ruleFromRow(r: Record<string, unknown>): AlertRule {
  return {
    id: String(r.id),
    subject: String(r.subject),
    kind: r.kind as AlertKind,
    threshold: Number(r.threshold),
    enabled: Boolean(r.enabled),
    note: (r.note as string | null) ?? undefined,
  };
}

function eventFromRow(r: Record<string, unknown>): AlertEvent {
  return {
    id: String(r.id),
    ruleId: String(r.rule_id),
    subject: String(r.subject),
    kind: r.kind as AlertKind,
    detail: String(r.detail ?? ""),
    value: r.value === null || r.value === undefined ? null : Number(r.value),
    at: String(r.at),
  };
}

export async function listRules(): Promise<AlertRule[]> {
  const owner = await ownerOrRefuse();
  if (owner) {
    const sb = owner.sb;
    const { data, error } = await sb.from(TABLE_RULES).select("*").order("created_at");
    if (!error) return (data ?? []).map(ruleFromRow);
    if (!useFallback(error, TABLE_RULES)) {
      throw new Error(`Failed to load alert rules: ${error.message}`);
    }
  }
  return rules.all();
}

export async function saveRule(input: Omit<AlertRule, "id">): Promise<AlertRule> {
  const rule: AlertRule = { ...input, id: randomUUID() };
  const owner = await ownerOrRefuse();
  if (owner) {
    const sb = owner.sb;
    const { error } = await sb.from(TABLE_RULES).insert({
      id: rule.id,
      subject: rule.subject,
      kind: rule.kind,
      threshold: rule.threshold,
      enabled: rule.enabled,
      note: rule.note ?? null,
      user_id: owner.userId,
    });
    if (!error) return rule;
    if (!useFallback(error, TABLE_RULES)) {
      throw new Error(`Failed to save alert rule: ${error.message}`);
    }
  }
  rules.set(rule.id, rule);
  return rule;
}

export async function deleteRule(id: string): Promise<boolean> {
  const owner = await ownerOrRefuse();
  if (owner) {
    const sb = owner.sb;
    const { error } = await sb.from(TABLE_RULES).delete().eq("id", id);
    if (!error) return true;
    if (!useFallback(error, TABLE_RULES)) {
      throw new Error(`Failed to delete alert rule: ${error.message}`);
    }
  }
  return rules.delete(id);
}

export async function toggleRule(id: string, enabled: boolean): Promise<AlertRule | null> {
  const owner = await ownerOrRefuse();
  if (owner) {
    const sb = owner.sb;
    const { data, error } = await sb
      .from(TABLE_RULES)
      .update({ enabled })
      .eq("id", id)
      .select()
      .maybeSingle();
    if (!error) return data ? ruleFromRow(data) : null;
    if (!useFallback(error, TABLE_RULES)) {
      throw new Error(`Failed to update alert rule: ${error.message}`);
    }
  }
  const existing = rules.get(id);
  if (!existing) return null;
  const next = { ...existing, enabled };
  rules.set(id, next);
  return next;
}

/**
 * Record a fire, but only once per rule per calendar day.
 *
 * Alerts are evaluated on every page render, so an unguarded log would append
 * an identical row every few seconds for as long as the condition holds and
 * bury the one moment it actually crossed. The `(rule_id, fired_on)` unique
 * index enforces this in the database too — two concurrent renders can both
 * read "no fire yet", so the check here alone is not enough. Conflicts on that
 * index are the expected case and are swallowed; anything else propagates.
 */
export async function recordFires(
  hits: { ruleId: string; subject: string; kind: AlertKind; detail: string; value: number | null }[],
): Promise<AlertEvent[]> {
  if (!hits.length) return [];
  const today = new Date().toISOString().slice(0, 10);
  const owner = await ownerOrRefuse();

  if (owner) {
    const sb = owner.sb;
    const { data: seen, error: seenErr } = await sb
      .from(TABLE_EVENTS)
      .select("rule_id")
      .eq("fired_on", today)
      .in("rule_id", hits.map((h) => h.ruleId));

    if (!seenErr) {
      const already = new Set((seen ?? []).map((r: { rule_id: unknown }) => String(r.rule_id)));
      const fresh: AlertEvent[] = hits
        .filter((h) => !already.has(h.ruleId))
        .map((h) => ({ ...h, id: randomUUID(), at: new Date().toISOString() }));
      if (!fresh.length) return [];

      const { error } = await sb.from(TABLE_EVENTS).insert(
        fresh.map((e) => ({
          id: e.id,
          rule_id: e.ruleId,
          subject: e.subject,
          kind: e.kind,
          detail: e.detail,
          value: e.value,
          at: e.at,
          user_id: owner.userId,
        })),
      );

      // 23505 is the once-per-day index doing its job under a race. Every other
      // failure is real and should not be reported back as a successful fire.
      if (error && error.code !== "23505") {
        throw new Error(`Failed to record alert fires: ${error.message}`);
      }
      return error ? [] : fresh;
    }

    if (!useFallback(seenErr, TABLE_EVENTS)) {
      throw new Error(`Failed to read alert log: ${seenErr.message}`);
    }
  }

  const existing = events.all();
  const fresh: AlertEvent[] = [];
  for (const h of hits) {
    if (existing.some((e) => e.ruleId === h.ruleId && e.at.slice(0, 10) === today)) continue;
    fresh.push({ ...h, id: randomUUID(), at: new Date().toISOString() });
  }
  if (fresh.length) events.prepend(fresh);
  return fresh;
}

export async function listEvents(limit = 50): Promise<AlertEvent[]> {
  const owner = await ownerOrRefuse();
  if (owner) {
    const sb = owner.sb;
    const { data, error } = await sb
      .from(TABLE_EVENTS)
      .select("*")
      .order("at", { ascending: false })
      .limit(limit);
    if (!error) return (data ?? []).map(eventFromRow);
    if (!useFallback(error, TABLE_EVENTS)) {
      throw new Error(`Failed to load alert log: ${error.message}`);
    }
  }
  return events.all().slice(0, limit);
}
