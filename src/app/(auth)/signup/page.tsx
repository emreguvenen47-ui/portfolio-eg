import { Suspense } from "react";
import { AuthForm } from "@/components/auth/auth-form";
import { signUp } from "../actions";

export const metadata = { title: "Create account", robots: { index: false, follow: false } };

export default function SignupPage() {
  return (
    <div className="mx-auto flex w-full max-w-[340px] flex-col gap-4 py-10">
      <div>
        <h1 className="text-[15px] font-semibold">Create account</h1>
        <p className="mt-1 text-[10.5px] leading-snug text-[var(--ink-3)]">
          An account holds your own portfolio, alerts, paper trades and saved screens. Nobody else
          can read them — isolation is enforced by the database, not by this page.
        </p>
      </div>
      <section className="panel p-3">
        <Suspense fallback={null}>
          <AuthForm mode="signup" action={signUp} />
        </Suspense>
      </section>
    </div>
  );
}
