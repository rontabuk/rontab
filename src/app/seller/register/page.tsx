import type { Metadata } from "next";
import Link from "next/link";
import { SellerAuthForm } from "@/components/seller/SellerAuthForm";

export const metadata: Metadata = { title: "Seller registration", robots: { index: false, follow: false } };

export default function SellerRegisterPage() {
  return (
    <main className="seller-auth-page">
      <section className="seller-auth-panel" aria-labelledby="seller-register-title">
        <Link className="wordmark seller-auth-logo" href="/" aria-label="RonTab home">RonTab</Link>
        <h1 id="seller-register-title">Create your shop profile</h1>
        <p className="seller-auth-intro">Seller accounts are reviewed before a shop or its products become public.</p>
        <SellerAuthForm mode="register" />
        <Link className="seller-auth-back" href="/">Back to Rontab</Link>
      </section>
    </main>
  );
}