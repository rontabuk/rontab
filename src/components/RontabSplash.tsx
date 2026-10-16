"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, ShoppingBag, ShoppingCart, Store } from "lucide-react";

export function RontabSplash({ showOnly = false, destination = "/products" }: { showOnly?: boolean; destination?: string }) {
  const router = useRouter();

  useEffect(() => {
    if (!showOnly) return;
    const timer = window.setTimeout(() => router.replace(destination), 1_650);
    return () => window.clearTimeout(timer);
  }, [destination, router, showOnly]);

  return (
    <main className={`rontab-splash${showOnly ? " rontab-splash-intro" : ""}`}>
      <div className="splash-blob splash-blob-a" aria-hidden="true" />
      <div className="splash-blob splash-blob-b" aria-hidden="true" />
      <div className="splash-blob splash-blob-c" aria-hidden="true" />
      <section className="splash-content" aria-label="Rontab">
        <div className="splash-brand-mark" aria-hidden="true">
          <ShoppingCart size={46} strokeWidth={2} />
          <ArrowUpRight className="splash-brand-arrow" size={24} strokeWidth={3} />
        </div>
        <h1 className="splash-wordmark">Ron<span>.</span>Tab</h1>
        <p className="splash-tagline">Find it. Sell it. Grow it.</p>
        <p className="splash-sub">The marketplace where independent shops and shoppers meet.</p>

        {showOnly ? (
          <div className="splash-entering" role="status">
            <span className="splash-loading-line" />
            <span>Opening your Rontab</span>
          </div>
        ) : (
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
        )}
      </section>
      <p className="splash-footer">RonTab · Independent commerce</p>
    </main>
  );
}