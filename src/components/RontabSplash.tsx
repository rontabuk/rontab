"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoaderCircle, ShoppingBag, Store } from "lucide-react";

export function RontabSplash({ showOnly = false, destination = "/products" }: { showOnly?: boolean; destination?: string }) {
  const router = useRouter();

  useEffect(() => {
    if (!showOnly) return;
    const timer = window.setTimeout(() => router.replace(destination), 1_650);
    return () => window.clearTimeout(timer);
  }, [destination, router, showOnly]);

  if (showOnly) {
    return (
      <main className="account-welcome-screen">
        <h1>RonTab</h1>
        <div className="account-welcome-loading" role="status" aria-label="Loading your account">
          <LoaderCircle size={20} aria-hidden="true" />
        </div>
      </main>
    );
  }

  return (
    <main className="rontab-splash">
      <div className="splash-blob splash-blob-a" aria-hidden="true" />
      <div className="splash-blob splash-blob-b" aria-hidden="true" />
      <div className="splash-blob splash-blob-c" aria-hidden="true" />
      <section className="splash-content" aria-label="Welcome">
        <h1 className="splash-wordmark">Welcome</h1>
        <p className="splash-tagline">Find it. Sell it. Grow it.</p>
        <p className="splash-sub">The marketplace where independent shops and shoppers meet.</p>

          <nav className="splash-actions" aria-label="Choose how to continue">
            <Link className="splash-action splash-action-primary" href="/products">
              <ShoppingBag size={18} aria-hidden="true" /> Start shopping
            </Link>
            <Link className="splash-action splash-action-secondary" href="/seller/register">
              <Store size={18} aria-hidden="true" /> Open your shop
            </Link>
            <div className="splash-seller-entry">
              <span>Already selling with us?</span>
              <Link href="/seller/login">Seller sign in</Link>
            </div>
          </nav>
      </section>
      <p className="splash-footer">Independent commerce</p>
    </main>
  );
}