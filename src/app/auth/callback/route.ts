import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSafeVisitorPath } from "@/lib/visitor/paths";

// A reused link should still report success when this browser's account is already confirmed.
async function isEmailAlreadyVerified(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("profiles").select("email_verified_at").eq("id", user.id).maybeSingle();
  return Boolean(data?.email_verified_at);
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const flow = request.nextUrl.searchParams.get("flow");
  if (flow === "recovery") {
    const requestedReturn = request.nextUrl.searchParams.get("returnTo");
    const returnTo = requestedReturn === "/seller/login" || requestedReturn === "/admin/login" || requestedReturn === "/creator/login" ? requestedReturn : "/account";
    const tokenHash = request.nextUrl.searchParams.get("token_hash");
    const supabase = await createSupabaseServerClient();
    const { error } = tokenHash
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" })
      : code ? await supabase.auth.exchangeCodeForSession(code) : { error: true };
    const resultUrl = new URL(error ? "/auth/forgot-password" : "/auth/reset-password", request.nextUrl.origin);
    resultUrl.searchParams.set("returnTo", returnTo);
    if (error) resultUrl.searchParams.set("expired", "1");
    return NextResponse.redirect(resultUrl);
  }
  if (flow === "verify-email") {
    const creatorReturn = request.nextUrl.searchParams.get("returnTo") === "/creator";
    const resultUrl = new URL(creatorReturn ? "/creator" : "/products", request.nextUrl.origin);
    const supabase = await createSupabaseServerClient();
    const tokenHash = request.nextUrl.searchParams.get("token_hash");
    const { error } = tokenHash
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "email" })
      : code ? await supabase.auth.exchangeCodeForSession(code) : { error: true };
    const { error: verifyError } = error ? { error } : await supabase.rpc("visitor_mark_email_verified", {});
    resultUrl.searchParams.set("emailVerified", verifyError && !(await isEmailAlreadyVerified(supabase)) ? "0" : "1");
    revalidatePath("/", "layout");
    return NextResponse.redirect(resultUrl);
  }
  if (flow === "visitor") {
    const nextPath = getSafeVisitorPath(request.nextUrl.searchParams.get("next"));
    const nextUrl = new URL("/", request.nextUrl.origin);
    nextUrl.searchParams.set("welcome", "1");
    nextUrl.searchParams.set("next", nextPath);
    const supabase = await createSupabaseServerClient();
    const tokenHash = request.nextUrl.searchParams.get("token_hash");
    const { error } = tokenHash
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "email" })
      : code ? await supabase.auth.exchangeCodeForSession(code) : { error: true };
    if (error) {
      const accountUrl = new URL("/account", request.nextUrl.origin);
      accountUrl.searchParams.set("next", nextPath);
      accountUrl.searchParams.set("confirmationError", "1");
      return NextResponse.redirect(accountUrl);
    }
    // Older sign-up confirmation links also prove the visitor owns the inbox.
    await supabase.rpc("visitor_mark_email_verified", {});
    return NextResponse.redirect(nextUrl);
  }

  const profileUrl = new URL("/seller/profile/edit", request.nextUrl.origin);
  const tokenHash = request.nextUrl.searchParams.get("token_hash");

  if ((!code && !tokenHash) || flow !== "contact-phone") {
    profileUrl.searchParams.set("verificationError", "1");
    return NextResponse.redirect(profileUrl);
  }

  const supabase = await createSupabaseServerClient();
  const { error: exchangeError } = tokenHash
    ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "email" })
    : code ? await supabase.auth.exchangeCodeForSession(code) : { error: true };

  if (exchangeError) {
    profileUrl.searchParams.set("verificationError", "1");
    return NextResponse.redirect(profileUrl);
  }

  const { error: confirmationError } = await supabase.rpc("seller_confirm_contact_email", {});
  if (confirmationError) {
    profileUrl.searchParams.set("verificationError", "1");
    return NextResponse.redirect(profileUrl);
  }

  revalidatePath("/seller/profile");
  revalidatePath("/seller/profile/edit");
  revalidatePath("/admin/sellers");
  profileUrl.searchParams.set("phoneConfirmed", "1");
  return NextResponse.redirect(profileUrl);
}
