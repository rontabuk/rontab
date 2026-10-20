"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function CreatorLoginForm() {
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
      setMessage("Creator sign in is temporarily unavailable.");
      setIsSubmitting(false);
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      setMessage("The email or password is incorrect.");
      setIsSubmitting(false);
      return;
    }
    if (data.user.app_metadata?.account_type !== "creator") {
      await supabase.auth.signOut();
      setMessage("This is not a creator account. Visitors and sellers sign in from their own pages.");
      setIsSubmitting(false);
      return;
    }
    window.location.replace("/creator");
  }

  return (
    <form className="visitor-account-form" onSubmit={handleSubmit}>
      <label htmlFor="creator-email">Email</label>
      <input id="creator-email" name="email" type="email" autoComplete="email" required />
      <label htmlFor="creator-password">Password</label>
      <input id="creator-password" name="password" type="password" minLength={8} autoComplete="current-password" required />
      <Link className="password-recovery-link" href="/auth/forgot-password?returnTo=%2Fcreator%2Flogin">Forgot password?</Link>
      {message && <p className="visitor-account-alert" data-tone="error" role="alert">{message}</p>}
      <button className="visitor-account-submit" type="submit" disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="visitor-account-spinner" size={17} aria-hidden="true" />}
        {isSubmitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
