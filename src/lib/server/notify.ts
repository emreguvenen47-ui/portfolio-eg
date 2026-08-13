import "server-only";

/**
 * Operator notifications.
 *
 * Tells whoever runs this deployment when an account is created or signed in.
 * That is ordinary for a service owner — the same rows are already visible in
 * the Supabase dashboard — and it is deliberately limited to account-level
 * facts.
 *
 * WHAT IS NOT SENT, and will not be added here: portfolio holdings, positions,
 * paper trades, alerts, saved screens. Those belong to the account that
 * created them, the database enforces that with row-level policies, and the
 * sign-in page tells users so. Mailing them out would make that statement
 * false, and the operator has no need for them to run the service.
 *
 * Optional, like every other key in this app: with no RESEND_API_KEY the
 * function returns quietly and sign-in is unaffected. A notification failing
 * must never stop somebody signing in.
 */

export type AuthEvent = "signup" | "signin";

const endpoint = "https://api.resend.com/emails";

/** The operator's address. Overridable, but this is who runs the deployment. */
const DEFAULT_OWNER = "emreguvenen47@gmail.com";

const key = () => process.env.RESEND_API_KEY?.trim();
const to = () => process.env.OWNER_NOTIFY_EMAIL?.trim() || DEFAULT_OWNER;
/** Resend requires a verified sender; onboarding@resend.dev works untouched. */
const from = () => process.env.NOTIFY_FROM_EMAIL?.trim() || "onboarding@resend.dev";

export const isNotifyConfigured = (): boolean => Boolean(key() && to());

/** Exported for tests: everything the mail would contain, without sending. */
export function buildNotification(input: {
  event: AuthEvent;
  email: string;
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
  when?: string;
}): { subject: string; text: string } {
  const when = input.when ?? new Date().toISOString();
  const title = input.event === "signup" ? "New account" : "Sign-in";
  const lines = [
    `${title} on Portfolio EG`,
    "",
    `Email:    ${input.email}`,
    `User ID:  ${input.userId}`,
    `When:     ${when}`,
    input.ip ? `IP:       ${input.ip}` : null,
    input.userAgent ? `Client:   ${input.userAgent}` : null,
    "",
    "Account details only. Holdings, alerts, paper trades and saved screens",
    "stay in that account and are not included here.",
  ].filter(Boolean);
  return { subject: `${title}: ${input.email}`, text: lines.join("\n") };
}

export async function notifyAuthEvent(input: {
  event: AuthEvent;
  email: string;
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  const apiKey = key();
  const recipient = to();
  if (!apiKey || !recipient) return;

  // No point mailing the operator about their own sessions.
  if (input.email.toLowerCase() === recipient.toLowerCase()) return;

  const { subject, text } = buildNotification(input);

  try {
    await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: `Portfolio EG <${from()}>`,
        to: [recipient],
        subject,
        text,
      }),
      // A slow mail API must not hold up a sign-in.
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // Swallowed on purpose. Sign-in succeeded; the notification is secondary.
  }
}
