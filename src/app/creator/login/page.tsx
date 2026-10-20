import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CreatorLoginForm } from "@/components/creator/CreatorLoginForm";

export const metadata: Metadata = { title: "Creator sign in", robots: { index: false, follow: false } };

export default function CreatorLoginPage() {
  return (
    <main className="visitor-account-page">
      <section className="visitor-account-panel" aria-labelledby="creator-login-title">
        <Link className="visitor-account-wordmark" href="/products" aria-label="Back to products" title="Back to products"><ArrowLeft size={22} aria-hidden="true" /></Link>
        <p className="admin-eyebrow">CREATOR ACCOUNT</p>
        <h1 id="creator-login-title">Creator sign in</h1>
        <p className="visitor-account-intro">Manage your creator profile, product opportunities, and influence.</p>
        <CreatorLoginForm />
        <div className="visitor-account-footer">
          <span>New creator? <Link href="/creator/register">Create a creator account</Link></span>
          <span>Visitor? <Link href="/account">Visitor sign in</Link> · Seller? <Link href="/seller/login">Seller sign in</Link></span>
        </div>
      </section>
    </main>
  );
}
