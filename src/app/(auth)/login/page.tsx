import { Suspense } from "react";
import { AuthForm } from "@/components/auth/auth-form";
import { signIn } from "../actions";

export const metadata = { title: "Sign in", robots: { index: false, follow: false } };

export default function LoginPage() {
  return (
    <div className="mx-auto flex w-full max-w-[340px] flex-col gap-4 py-10">
      <div>
        <h1 className="text-[15px] font-semibold">Sign in</h1>
        <p className="mt-1 text-[10.5px] leading-snug text-[var(--ink-3)]">
          Your portfolio, alerts, paper trades and saved screens are private to your account.
          Research, the scanner and the screener need no account.
        </p>
      </div>
      <section className="panel p-3">
        <Suspense fallback={null}>
          <AuthForm mode="signin" action={signIn} />
        </Suspense>
      </section>
    </div>
  );
}
