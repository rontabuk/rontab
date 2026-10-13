import type { Metadata } from "next";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { VisitorAccountForm } from "@/components/VisitorAccountForm";
import { getSupportedLocations } from "@/lib/locations";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSafeVisitorPath } from "@/lib/visitor/paths";
import "./account.css";

export const metadata: Metadata = { title: "Visitor account", robots: { index: false, follow: false } };
export const instant = false;

export default async function VisitorAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; confirm?: string; confirmationError?: string; mode?: string }>;
}) {
  await connection();
  const { next, confirm, confirmationError, mode } = await searchParams;
  const nextPath = getSafeVisitorPath(next);
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.email_confirmed_at) redirect(`/?welcome=1&next=${encodeURIComponent(nextPath)}`);

  const notice = confirmationError === "1"
    ? "That confirmation link has expired or was already used. Sign in, or create your account again to receive a new link."
    : confirm === "1"
      ? "Confirm your email address before visiting a shop. Check your inbox for the confirmation link."
      : null;

  const initialMode = mode === "register" ? "register" : "login";
  const locations = await getSupportedLocations(supabase);
  return <VisitorAccountForm nextPath={nextPath} notice={notice} initialMode={initialMode} {...locations} />;
}