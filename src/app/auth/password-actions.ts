"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type PasswordFormState = { error: string | null; success: boolean };

export async function requestPasswordReset(_state: PasswordFormState, formData: FormData): Promise<PasswordFormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Enter a valid email address.", success: false };
  }
  const requestedReturn = String(formData.get("returnTo") ?? "");
  const returnTo = requestedReturn === "/seller/login" || requestedReturn === "/admin/login" || requestedReturn === "/creator/login" ? requestedReturn : "/account";
  try {
    const origin = (await headers()).get("origin");
    if (!origin) return { error: "We couldn't send the reset link. Please try again.", success: false };
    const callback = new URL("/auth/callback", origin);
    if (!["http:", "https:"].includes(callback.protocol)) return { error: "We couldn't send the reset link. Please try again.", success: false };
    callback.searchParams.set("flow", "recovery");
    callback.searchParams.set("returnTo", returnTo);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: callback.toString() });
    if (error) {
      if (error.status === 429) return { error: "Please wait a minute before requesting another reset link.", success: false };
      return { error: "We couldn't send the reset link. Please try again later.", success: false };
    }
    return { error: null, success: true };
  } catch {
    return { error: "Password recovery is temporarily unavailable. Please try again later.", success: false };
  }
}

export async function resetPassword(_state: PasswordFormState, formData: FormData): Promise<PasswordFormState> {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  if (password.length < 8 || password.length > 72) return { error: "Use a password between 8 and 72 characters.", success: false };
  if (password !== confirmation) return { error: "The passwords don't match.", success: false };
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return { error: "Your reset session has expired. Request a new reset link.", success: false };
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      if (error.code === "same_password") return { error: "Choose a password different from your current one.", success: false };
      if (error.code === "weak_password") return { error: "Choose a stronger password between 8 and 72 characters.", success: false };
      return { error: "We couldn't update your password. Request a new reset link and try again.", success: false };
    }
    await supabase.auth.signOut();
    revalidatePath("/", "layout");
    return { error: null, success: true };
  } catch {
    return { error: "Password recovery is temporarily unavailable. Please try again later.", success: false };
  }
}