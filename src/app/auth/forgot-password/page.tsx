import type { Metadata } from "next";
import { connection } from "next/server";
import { PasswordRecoveryForm } from "@/components/PasswordRecoveryForm";
import "@/app/account/account.css";

export const metadata: Metadata = { title: "Reset your password", robots: { index: false, follow: false } };
export const instant = false;

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ returnTo?: string; expired?: string }> }) {
  await connection();
  const { returnTo: requestedReturn, expired } = await searchParams;
  const returnTo = requestedReturn === "/seller/login" || requestedReturn === "/admin/login" || requestedReturn === "/creator/login" ? requestedReturn : "/account";
  return <PasswordRecoveryForm mode="request" returnTo={returnTo} expired={expired === "1"} />;
}