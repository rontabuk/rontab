import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { ActionForm } from "@/components/ActionForm";
import { CityPicker } from "@/components/CityPicker";
import { CreatorApplicationFields } from "@/components/creator/CreatorApplicationFields";
import { registerCreatorAccount } from "@/app/creator/register/actions";
import { isCreatorUser } from "@/lib/creator/access";
import { CREATOR_MIN_TOTAL_FOLLOWERS } from "@/lib/creator/catalog";
import { formatNumber } from "@/lib/format";
import { getSupportedLocations } from "@/lib/locations";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Create a creator account", robots: { index: false, follow: false } };
export const instant = false;

export default async function CreatorRegisterPage() {
  await connection();
  const supabase = await createSupabaseServerClient();
  const [{ data: { user } }, { countries, cities }] = await Promise.all([supabase.auth.getUser(), getSupportedLocations()]);
  if (user?.email_confirmed_at && isCreatorUser(user)) redirect("/creator");

  return (
    <main className="visitor-account-page">
      <section className="visitor-account-panel creator-register-panel" aria-labelledby="creator-register-title">
        <Link className="visitor-account-wordmark" href="/products" aria-label="Back to products" title="Back to products"><ArrowLeft size={22} aria-hidden="true" /></Link>
        <p className="admin-eyebrow">CREATOR ACCOUNT</p>
        <h1 id="creator-register-title">Create your creator account</h1>
        <p className="visitor-account-intro">A creator account is separate from visitor and seller accounts, with its own sign-in, public profile, and influence balance.</p>
        <p className="visitor-account-alert" data-tone="info">
          You need at least {formatNumber(CREATOR_MIN_TOTAL_FOLLOWERS)} followers across your social platforms. Your profile is reviewed before it appears publicly.
        </p>
        {user && (
          <p className="visitor-account-alert" data-tone="info" role="status">
            You are signed in with another Rontab account. Use a different email here; creating a creator account signs you out of the current one.
          </p>
        )}

        <ActionForm className="creator-application-form creator-register-form" action={registerCreatorAccount}>
          <fieldset className="creator-register-account">
            <legend>Account details</legend>
            <label>Email address
              <input name="email" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" maxLength={254} required />
            </label>
            <label>Password
              <input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required />
              <small>Use at least 8 characters.</small>
            </label>
            <label>Phone number <small>(optional)</small>
              <input name="phone" type="tel" autoComplete="tel" maxLength={32} placeholder="+44…" />
              <small>Shown only to a seller after you share it in an offer and they select you. You can change this later.</small>
            </label>
            <div className="creator-register-location">
              <p>Country and city</p>
              <CityPicker name="city_id" countries={countries} cities={cities} initialCity={null} initialCountryCode={null} required />
            </div>
          </fieldset>

          <CreatorApplicationFields cities={cities} requireProfileImage />

          <button className="admin-primary-button" type="submit">Create creator account</button>
          <p className="visitor-account-legal">
            By creating an account you agree to our <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.
          </p>
        </ActionForm>

        <div className="visitor-account-footer">
          <span>Already a creator? <Link href="/creator/login">Creator sign in</Link></span>
          <Link href="/products">Back to products</Link>
        </div>
      </section>
    </main>
  );
}
