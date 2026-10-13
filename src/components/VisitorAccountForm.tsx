"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function VisitorAccountForm({ nextPath, notice }: { nextPath: string; notice: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      setMessage("Account access is temporarily unavailable.");
      setIsSubmitting(false);
      return;
    }

    if (mode === "register") {
      const callbackUrl = new URL("/auth/callback", window.location.origin);
      callbackUrl.searchParams.set("flow", "visitor");
      callbackUrl.searchParams.set("next", nextPath);
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { account_type: "visitor" },
          emailRedirectTo: callbackUrl.toString(),
        },
      });

      if (error) {
        setMessage("We could not create this account. Check the email and password, or sign in if you already registered.");
        setIsSubmitting(false);
        return;
      }

      if (!data.session) {
        setMessage("Check your email to confirm your account. Then return here and sign in to continue.");
        setIsSubmitting(false);
        return;
      }
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.user) {
        setMessage("The email or password is incorrect. Confirm your email address if you just registered.");
        setIsSubmitting(false);
        return;
      }
    }

    router.replace(`/?welcome=1&next=${encodeURIComponent(nextPath)}`);
    router.refresh();
  }

  return (
    <main className="visitor-account-page">
      <section className="visitor-account-panel" aria-labelledby="visitor-account-title">
        <Link className="visitor-account-wordmark" href="/">rontab<span>.</span></Link>
        <p className="admin-eyebrow">ONE VERIFIED CLICK PER PRODUCT</p>
        <h1 id="visitor-account-title">{mode === "login" ? "Sign in to visit the shop" : "Create your Rontab account"}</h1>
        <p className="visitor-account-intro">Earn one Rontab point the first time you visit each product. Your points stay with your confirmed account across browsers and devices.</p>
        {notice && <p className="visitor-account-notice" role="status">{notice}</p>}
        <form className="visitor-account-form" onSubmit={handleSubmit}>
          <label htmlFor="visitor-email">Email</label>
          <input id="visitor-email" name="email" type="email" autoComplete="email" required />
          <label htmlFor="visitor-password">Password</label>
          <input id="visitor-password" name="password" type="password" minLength={8} autoComplete={mode === "register" ? "new-password" : "current-password"} required />
          {message && <p className="visitor-account-message" role="status">{message}</p>}
          <button className="visitor-account-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Please wait…" : mode === "login" ? "Sign in and continue" : "Create account"}
          </button>
        </form>
        <button className="visitor-account-mode" type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setMessage(""); }}>
          {mode === "login" ? "New to Rontab? Create an account" : "Already have an account? Sign in"}
        </button>
        <Link className="visitor-account-back" href="/">Back to Rontab</Link>
      </section>
    </main>
  );
}