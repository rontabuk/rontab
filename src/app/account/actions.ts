"use server";

import { headers } from "next/headers";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Visitors are approved automatically, so the account is usable at once; email ownership is confirmed later.
export async function registerVisitorAccount(email: string, password: string): Promise<{ error: string | null }> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalizedEmail) || normalizedEmail.length > 254) return { error: "Enter a valid email address." };
  if (password.length < 8 || password.length > 72) return { error: "Use a password between 8 and 72 characters." };

  let admin;
  try {
    admin = createSupabaseServiceRoleClient();
  } catch {
    return { error: "Account registration is temporarily unavailable. Please try again shortly." };
  }

  const { error } = await admin.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true,
    user_metadata: { account_type: "visitor" },
  });

  if (error) {
    if (error.status === 422 || /already/i.test(error.message)) {
      return { error: "An account with this email already exists. Sign in instead." };
    }
    if (/password/i.test(error.message)) return { error: "Choose a stronger password with at least 8 characters." };
    console.error("Visitor registration failed:", error.message);
    return { error: "We couldn't create your account. Please try again." };
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
