import type { Metadata } from "next";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { PasswordRecoveryForm } from "@/components/PasswordRecoveryForm";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import "@/app/account/account.css";

export const metadata: Metadata = { title: "Set a new password", robots: { index: false, follow: false } };
export const instant = false;

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  await connection();
  const { returnTo: requestedReturn } = await searchParams;
  const returnTo = requestedReturn === "/seller/login" || requestedReturn === "/admin/login" || requestedReturn === "/creator/login" ? requestedReturn : "/account";
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect(`/auth/forgot-password?expired=1&returnTo=${encodeURIComponent(returnTo)}`);
  return <PasswordRecoveryForm mode="reset" returnTo={returnTo} />;
}