"use server";

import { headers } from "next/headers";
import { isCityId } from "@/lib/validation";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Visitors are approved automatically, so the account is usable at once; email ownership is confirmed later.
export async function registerVisitorAccount(email: string, password: string, cityId: string, countryCode: string, name: string): Promise<{ error: string | null }> {
  const normalizedEmail = email.trim().toLowerCase();
  const displayName = name.trim().replace(/\s+/g, " ");
  if (displayName.length < 2 || displayName.length > 100) return { error: "Enter your name (2 to 100 characters)." };
  if (!EMAIL_PATTERN.test(normalizedEmail) || normalizedEmail.length > 254) return { error: "Enter a valid email address." };
  if (password.length < 8 || password.length > 72) return { error: "Use a password between 8 and 72 characters." };
  if (!isCityId(cityId) || !/^[A-Z]{2}$/.test(countryCode)) return { error: "Choose a supported country and city." };

  let admin;
  try {
    admin = createSupabaseServiceRoleClient();
  } catch {
    return { error: "Account registration is temporarily unavailable. Please try again shortly." };
  }

  const { data: city, error: cityError } = await admin
    .from("supported_cities")
    .select("city_id,country_code")
    .eq("city_id", cityId)
    .eq("is_enabled", true)
    .maybeSingle();
  if (cityError) return { error: "We couldn't verify your location. Please try again." };
  if (!city || city.country_code !== countryCode) return { error: "Choose a city in the selected country." };

  const { data: country, error: countryError } = await admin
    .from("supported_countries")
    .select("country_code")
    .eq("country_code", countryCode)
    .eq("is_enabled", true)
    .maybeSingle();
  if (countryError) return { error: "We couldn't verify your location. Please try again." };
  if (!country) return { error: "Choose a country currently supported by Rontab." };

  const { data, error } = await admin.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true,
    user_metadata: { account_type: "visitor", display_name: displayName },
  });

  if (error) {
    if (error.status === 422 || /already/i.test(error.message)) {
      return { error: "An account with this email already exists. Sign in instead." };
    }
    if (/password/i.test(error.message)) return { error: "Choose a stronger password with at least 8 characters." };
    console.error("Visitor registration failed:", error.message);
    return { error: "We couldn't create your account. Please try again." };
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({ city_id: cityId, country_code: countryCode, display_name: displayName })
    .eq("id", data.user.id);
  if (profileError) {
    const { error: rollbackError } = await admin.auth.admin.deleteUser(data.user.id);
    console.error("Visitor location save failed:", profileError.message, rollbackError?.message);
    return { error: rollbackError
      ? "Your account was created, but we couldn't save your location. Sign in and complete your profile before joining offers."
      : "We couldn't save your location, so no account was created. Please try again." };
  }

  return { error: null };
}

export async function sendVisitorEmailVerification(): Promise<{ error: string | null }> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return { error: "Sign in to confirm your email." };

  const { data: profile } = await supabase.from("profiles").select("email_verified_at").eq("id", user.id).maybeSingle();
  if (profile?.email_verified_at) return { error: null };

  const origin = (await headers()).get("origin");
  if (!origin) return { error: "We couldn't send the email right now. Please try again." };

  const { error } = await supabase.auth.signInWithOtp({
    email: user.email,
    options: { shouldCreateUser: false, emailRedirectTo: new URL("/auth/callback?flow=verify-email", origin).toString() },
  });

  if (error) {
    if (error.status === 429) return { error: "We just sent you an email. Please wait a minute before asking again." };
    console.error("Verification email failed:", error.message);
    return { error: "We couldn't send the email right now. Please try again." };
  }
  return { error: null };
}
