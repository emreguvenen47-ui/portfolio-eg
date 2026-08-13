import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Anthropic client.
 *
 * Every call site here is user-initiated — a clicked AI ANALYZE, BUILD
 * PORTFOLIO, or GENERATE DAILY BRIEF. Nothing on this path runs on a timer or
 * on page render, because token spend should track deliberate actions rather
 * than how long a dashboard is left open.
 */

export const AI_MODEL = "claude-opus-5";

let client: Anthropic | null = null;

export function aiKey(): string | null {
  const k = process.env.ANTHROPIC_API_KEY?.trim();
  return k && k.length > 10 ? k : null;
}

export const isAiConfigured = (): boolean => aiKey() !== null;

function getClient(): Anthropic {
  const key = aiKey();
  if (!key) throw new AiUnavailableError();
  client ??= new Anthropic({ apiKey: key });
  return client;
}

export class AiUnavailableError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not configured — AI features are disabled");
    this.name = "AiUnavailableError";
  }
}

export interface AiCallOptions {
  system: string;
  user: string;
  /** JSON Schema the response is constrained to. */
  schema: Record<string, unknown>;
  maxTokens?: number;
  /** Lower effort for short, well-specified extractions. */
  effort?: "low" | "medium" | "high";
}

/**
 * One structured-JSON call.
 *
 * `output_config.format` constrains the response to the schema at the API
 * level, so there is no prompt-side "reply with JSON only", no fenced-block
 * stripping, and no parse-retry loop. Callers still validate semantics
 * (weights summing to 100, tickers being real) — the schema guarantees shape,
 * not correctness.
 */
export async function generateJson<T>(opts: AiCallOptions): Promise<T> {
  const response = await getClient().messages.create({
    model: AI_MODEL,
    max_tokens: opts.maxTokens ?? 8000,
    system: opts.system,
    output_config: {
      effort: opts.effort ?? "medium",
      format: { type: "json_schema", schema: opts.schema },
    },
    messages: [{ role: "user", content: opts.user }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("The model declined this request");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("Response was truncated — try a shorter description");
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  if (!text.trim()) throw new Error("Model returned an empty response");
  return JSON.parse(text) as T;
}
