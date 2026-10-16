"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Check, Eye, EyeOff, Loader2 } from "lucide-react";
import { CityPicker, type SupportedCity, type SupportedCountry } from "@/components/CityPicker";
import { registerVisitorAccount, sendVisitorEmailVerification } from "@/app/account/actions";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Mode = "login" | "register";
type Feedback = { tone: "error" | "success"; text: string } | null;

const copy = {
  login: {
    title: "Welcome back",
    intro: "Sign in to see your points, rewards and offers.",
    submit: "Sign in",
    pending: "Signing in…",
  },
  register: {
    title: "Create your free account",
    intro: "Join Rontab to keep your points and take part in reward offers.",
    submit: "Create account",
    pending: "Creating account…",
  },
} as const;

const benefits = [
  "Collect points as you discover new products",
  "Take part in Rontab reward offers",
  "Your points stay safe on every device",
];

export function VisitorAccountForm({ nextPath, notice, initialMode = "login", countries, cities }: {
  nextPath: string;
  notice: string | null;
  initialMode?: Mode;
  countries: SupportedCountry[];
  cities: SupportedCity[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const text = copy[mode];

  function switchMode(nextMode: Mode) {
    if (nextMode === mode) return;
    setMode(nextMode);
    setFeedback(null);
    // Keep the address in sync so refresh and sharing open the same tab.
    const url = new URL(window.location.href);
    if (nextMode === "register") url.searchParams.set("mode", "register");
    else url.searchParams.delete("mode");
    window.history.replaceState(null, "", url);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      setFeedback({ tone: "error", text: "Account access is temporarily unavailable. Please try again shortly." });
      setIsSubmitting(false);
      return;
    }

    if (mode === "register") {
      const cityId = String(formData.get("city_id") ?? "").trim();
      const countryCode = String(formData.get("city_id_country_code") ?? "").trim().toUpperCase();
      if (!cityId || !countryCode) {
        setFeedback({ tone: "error", text: "Choose your country and city to create your account." });
        setIsSubmitting(false);
        return;
      }
      const { error: registerError } = await registerVisitorAccount(email, password, cityId, countryCode);
      if (registerError) {
        setFeedback({ tone: "error", text: registerError });
        setIsSubmitting(false);
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setFeedback({ tone: "success", text: "Your account is ready. Sign in to continue." });
        setMode("login");
        setIsSubmitting(false);
        return;
      }

      // The confirmation email is a follow-up; the visitor can browse immediately.
      await sendVisitorEmailVerification().catch(() => null);
      router.replace(nextPath === "/visitor" ? "/products" : nextPath);
      router.refresh();
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      setFeedback({ tone: "error", text: "That email and password don't match. Check them and try again." });
      setIsSubmitting(false);
      return;
    }

    router.replace(`/?welcome=1&next=${encodeURIComponent(nextPath)}`);
    router.refresh();
  }

  return (
    <main className="visitor-account-page">
      <section className="visitor-account-panel" aria-labelledby="visitor-account-title">
        <Link className="visitor-account-wordmark" href="/products" aria-label="RonTab products">RonTab</Link>

        <div className="visitor-account-tabs" role="group" aria-label="Account options">
          <button type="button" aria-pressed={mode === "login"} onClick={() => switchMode("login")}>Sign in</button>
          <button type="button" aria-pressed={mode === "register"} onClick={() => switchMode("register")}>Create account</button>
        </div>

        <h1 id="visitor-account-title">{text.title}</h1>
        <p className="visitor-account-intro">{text.intro}</p>

        {mode === "register" && (
          <ul className="visitor-account-benefits">
            {benefits.map((benefit) => (
              <li key={benefit}><Check size={15} strokeWidth={3} aria-hidden="true" />{benefit}</li>
            ))}
          </ul>
        )}

        {notice && <p className="visitor-account-alert" data-tone="info" role="status">{notice}</p>}

        <form className="visitor-account-form" onSubmit={handleSubmit}>
          <label htmlFor="visitor-email">Email address</label>
          <input id="visitor-email" name="email" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" required />

          <label htmlFor="visitor-password">Password</label>
          <div className="visitor-account-password">
            <input
              id="visitor-password"
              name="password"
              type={showPassword ? "text" : "password"}
              minLength={8}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              aria-describedby={mode === "register" ? "visitor-password-hint" : undefined}
              required
            />
            <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>
              {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
            </button>
          </div>
          {mode === "register" && <small id="visitor-password-hint" className="visitor-account-hint">Use at least 8 characters.</small>}
          {mode === "login" && <Link className="password-recovery-link" href="/auth/forgot-password">Forgot password?</Link>}

          {mode === "register" && (
            <div className="visitor-registration-location">
              <p>Choose your location to access local offers and redeem points.</p>
              <CityPicker name="city_id" countries={countries} cities={cities} initialCity={null} initialCountryCode={null} required />
            </div>
          )}

          {feedback && (
            <p className="visitor-account-alert" data-tone={feedback.tone} role={feedback.tone === "error" ? "alert" : "status"}>{feedback.text}</p>
          )}

          <button className="visitor-account-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="visitor-account-spinner" size={17} aria-hidden="true" />}
            {isSubmitting ? text.pending : text.submit}
          </button>

          {mode === "register" && (
            <p className="visitor-account-legal">
              By creating an account you agree to our <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.
            </p>
          )}
        </form>

        <div className="visitor-account-footer">
          <Link href="/products">Continue browsing without an account</Link>
          <span>Selling on Rontab? <Link href="/seller/login">Seller sign in</Link></span>
        </div>
      </section>
    </main>
  );
}