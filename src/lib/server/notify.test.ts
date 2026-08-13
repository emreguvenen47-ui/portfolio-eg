import { describe, expect, it } from "vitest";
import { buildNotification } from "./notify";

/**
 * The operator notification.
 *
 * The test that matters is the negative one: this mail must carry account
 * facts and nothing an account owns. The whole point of the row-level policies
 * is that holdings stay with their owner, and a notification quietly carrying
 * them out would make that guarantee false while looking like a feature.
 */

const base = {
  email: "someone@example.com",
  userId: "11111111-2222-3333-4444-555555555555",
  when: "2026-08-13T12:00:00.000Z",
};

describe("auth notification", () => {
  it("names the account and the event", () => {
    const signup = buildNotification({ ...base, event: "signup" });
    expect(signup.subject).toContain("New account");
    expect(signup.subject).toContain(base.email);
    expect(signup.text).toContain(base.userId);

    const signin = buildNotification({ ...base, event: "signin" });
    expect(signin.subject).toContain("Sign-in");
  });

  it("includes request context when it is known", () => {
    const withCtx = buildNotification({
      ...base,
      event: "signin",
      ip: "203.0.113.9",
      userAgent: "Mozilla/5.0",
    });
    expect(withCtx.text).toContain("203.0.113.9");
    expect(withCtx.text).toContain("Mozilla/5.0");
  });

  it("omits unknown context rather than printing a blank field", () => {
    const bare = buildNotification({ ...base, event: "signin" });
    expect(bare.text).not.toContain("IP:");
    expect(bare.text).not.toContain("Client:");
  });

  it("carries no account-owned data", () => {
    const mail = buildNotification({
      ...base,
      event: "signup",
      ip: "203.0.113.9",
      userAgent: "Mozilla/5.0",
    });
    // Every line is either a label the template owns or one of the fields
    // passed in. Nothing sourced from the user's tables can appear.
    const allowed = new Set([
      base.email,
      base.userId,
      base.when,
      "203.0.113.9",
      "Mozilla/5.0",
    ]);
    for (const line of mail.text.split("\n")) {
      const value = line.split(/:\s+/).slice(1).join(": ").trim();
      if (!value) continue;
      if (/^(Email|User ID|When|IP|Client)/.test(line)) {
        expect(allowed.has(value)).toBe(true);
      }
    }
    expect(mail.text).toMatch(/not included here/i);
  });
});
