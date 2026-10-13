"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function AdminLoginForm() {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      setErrorMessage("Admin sign-in is temporarily unavailable.");
      setIsSubmitting(false);
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.user) {
      setErrorMessage("The email or password is incorrect.");
      setIsSubmitting(false);
      return;
    }

    const role = data.user.app_metadata?.role;

    if (role !== "admin") {
      await supabase.auth.signOut();
      setErrorMessage("This account is not authorized for administration.");
      setIsSubmitting(false);
      return;
    }

    router.replace("/admin");
    router.refresh();
  }

  return (
    <form className="admin-login-form" onSubmit={handleSubmit}>
      <label htmlFor="admin-email">Admin email</label>
      <input id="admin-email" name="email" type="email" autoComplete="username" required />
      <label htmlFor="admin-password">Password</label>
      <input id="admin-password" name="password" type="password" autoComplete="current-password" required />
      <Link className="admin-security-note" href="/auth/forgot-password?returnTo=%2Fadmin%2Flogin">Forgot password?</Link>
      {errorMessage && <p className="admin-login-error" role="alert">{errorMessage}</p>}
      <button className="admin-primary-button" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Signing in…" : "Sign in to admin"}
      </button>
    </form>
  );
}