import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { SellerAuthForm } from "@/components/seller/SellerAuthForm";

export const metadata: Metadata = { title: "Seller sign in", robots: { index: false, follow: false } };
export const instant = false;

export default async function SellerLoginPage({ searchParams }: { searchParams: Promise<{ registered?: string; confirmation?: string }> }) {
  await connection();
  const { registered, confirmation } = await searchParams;
  return (
    <main className="seller-auth-page">
      <section className="seller-auth-panel" aria-labelledby="seller-login-title">
        <Link className="wordmark seller-auth-logo" href="/" aria-label="Back to home" title="Home"><ArrowLeft size={22} aria-hidden="true" /></Link>
        <h1 id="seller-login-title">Seller sign in</h1>
        <p className="seller-auth-intro">Manage your shop profile and product submissions.</p>
        {registered === "1" && <p className="seller-auth-message" role="status">Registration complete. Sign in after confirming your email.</p>}
        {confirmation === "1" && <p className="seller-auth-message" role="status">Check your email for the confirmation link, then sign in here.</p>}
        <SellerAuthForm mode="login" />
        <Link className="seller-auth-back" href="/">Back to home</Link>
      </section>
    </main>
  );
}