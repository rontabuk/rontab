import "server-only";

import { headers } from "next/headers";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

export type CreatorEmailVerificationResult = "sent" | "rate-limited" | "failed";

// The emailed sign-in link proves inbox ownership; the callback then records profiles.email_verified_at.
export async function sendCreatorEmailVerification(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, email: string): Promise<CreatorEmailVerificationResult> {
  const origin = (await headers()).get("origin");
  if (!origin) return "failed";
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: new URL("/auth/callback?flow=verify-email&returnTo=/creator", origin).toString() },
  });
  if (!error) return "sent";
  if (error.status === 429) return "rate-limited";
  console.error("Creator verification email failed:", error.message);
  return "failed";
}
