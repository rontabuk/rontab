"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Mail } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { requestPasswordReset, resetPassword } from "@/app/auth/password-actions";

export function PasswordRecoveryForm({ mode, returnTo, expired = false }: { mode: "request" | "reset"; returnTo: string; expired?: boolean }) {
  const [state, formAction, pending] = useActionState(mode === "request" ? requestPasswordReset : resetPassword, { error: null, success: false });
  const [showPassword, setShowPassword] = useState(false);
  const forgotPath = `/auth/forgot-password?returnTo=${encodeURIComponent(returnTo)}`;
  const Icon = state.success ? CheckCircle2 : mode === "request" ? Mail : KeyRound;

  return <main className="visitor-account-page">
    <section className="visitor-account-panel" aria-labelledby="password-recovery-title">
      <Link className="visitor-account-wordmark" href="/products" aria-label="RonTab products"><BrandMark width={42} height={30} /><span>RonTab</span></Link>
      <div className="password-recovery-icon"><Icon size={25} aria-hidden="true" /></div>
      <h1 id="password-recovery-title">{state.success ? mode === "request" ? "Check your inbox" : "Password updated" : mode === "request" ? "Forgot your password?" : "Set a new password"}</h1>
      <p className="visitor-account-intro">{state.success
        ? mode === "request" ? "If an account exists for this email, you'll receive a password reset link. Check your inbox and spam folder. Open the link in this browser." : "Your password has been changed. Sign in again with your new password."
        : mode === "request" ? "Enter your account email to receive a reset link." : "Choose a new password for your account."}</p>
      {expired && !state.success && <p className="visitor-account-alert" data-tone="error" role="alert">That reset link has expired, was already used, or could not be verified. Request a new link.</p>}
      {!state.success && <form className="visitor-account-form" aria-busy={pending} onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => formAction(formData));
      }}>
        <input type="hidden" name="returnTo" value={returnTo} />
        {mode === "request" ? <>
          <label htmlFor="recovery-email">Email address</label>
          <input id="recovery-email" name="email" type="email" autoComplete="email" inputMode="email" maxLength={254} required disabled={pending} />
        </> : <>
          <label htmlFor="recovery-password">New password</label>
          <div className="visitor-account-password">
            <input id="recovery-password" name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} maxLength={72} aria-describedby="recovery-password-hint" required disabled={pending} />
            <button type="button" title={showPassword ? "Hide passwords" : "Show passwords"} aria-label={showPassword ? "Hide passwords" : "Show passwords"} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button>
          </div>
          <small id="recovery-password-hint" className="visitor-account-hint">Use between 8 and 72 characters.</small>
          <label htmlFor="recovery-confirmation">Confirm new password</label>
          <input id="recovery-confirmation" name="confirmation" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} maxLength={72} required disabled={pending} />
        </>}
        {state.error && <p className="visitor-account-alert" data-tone="error" role="alert">{state.error}</p>}
        <button className="visitor-account-submit" type="submit" disabled={pending}>{pending ? <Loader2 className="visitor-account-spinner" size={17} aria-hidden="true" /> : mode === "request" ? <Mail size={17} aria-hidden="true" /> : <KeyRound size={17} aria-hidden="true" />}{pending ? "Please wait..." : mode === "request" ? "Send reset link" : "Update password"}</button>
      </form>}
      <div className="visitor-account-footer">
        <Link className="password-recovery-back" href={returnTo}><ArrowLeft size={15} aria-hidden="true" /> Back to sign in</Link>
        {mode === "reset" && !state.success && <Link href={forgotPath}>Request a new reset link</Link>}
        {state.success && mode === "request" && <button className="password-recovery-retry" type="button" onClick={() => window.location.reload()}>Use another email</button>}
      </div>
    </section>
  </main>;
}