import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSafeVisitorPath } from "@/lib/visitor/paths";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const flow = request.nextUrl.searchParams.get("flow");
  if (flow === "visitor") {
    const nextPath = getSafeVisitorPath(request.nextUrl.searchParams.get("next"));
    const nextUrl = new URL("/", request.nextUrl.origin);
    nextUrl.searchParams.set("welcome", "1");
    nextUrl.searchParams.set("next", nextPath);
    if (!code) return NextResponse.redirect(new URL(`/account?next=${encodeURIComponent(nextPath)}`, request.nextUrl.origin));

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const accountUrl = new URL("/account", request.nextUrl.origin);
      accountUrl.searchParams.set("next", nextPath);
      accountUrl.searchParams.set("confirmationError", "1");
      return NextResponse.redirect(accountUrl);
    }
    return NextResponse.redirect(nextUrl);
  }

  const profileUrl = new URL("/seller/profile", request.nextUrl.origin);

  if (!code || flow !== "contact-phone") {
    profileUrl.searchParams.set("verificationError", "1");
    return NextResponse.redirect(profileUrl);
  }

  const supabase = await createSupabaseServerClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

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
  revalidatePath("/admin/sellers");
  profileUrl.searchParams.set("phoneConfirmed", "1");
  return NextResponse.redirect(profileUrl);
}
