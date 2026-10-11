import type { Metadata } from "next";
import Link from "next/link";
import { SellerAuthForm } from "@/components/seller/SellerAuthForm";

export const metadata: Metadata = { title: "Seller sign in", robots: { index: false, follow: false } };

export default function SellerLoginPage() {
  return (
    <main className="seller-auth-page">
      <section className="seller-auth-panel" aria-labelledby="seller-login-title">
        <p className="admin-eyebrow">RONTAB / SELLERS</p>
        <h1 id="seller-login-title">Seller sign in</h1>
        <p className="seller-auth-intro">Manage your shop profile and product submissions.</p>
        <SellerAuthForm mode="login" />
        <Link className="seller-auth-back" href="/">Back to Rontab</Link>
      </section>
    </main>
  );
}