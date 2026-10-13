"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownRight, ArrowUpRight, ShoppingCart } from "lucide-react";

export function RontabSplash({ showOnly = false, destination = "/products" }: { showOnly?: boolean; destination?: string }) {
  const router = useRouter();

  useEffect(() => {
    if (!showOnly) return;
    const timer = window.setTimeout(() => router.replace(destination), 1_650);
    return () => window.clearTimeout(timer);
  }, [destination, router, showOnly]);

  return (
    <main className={`rontab-splash${showOnly ? " rontab-splash-intro" : ""}`}>
      <div className="splash-corner splash-corner-top" aria-hidden="true" />
      <div className="splash-corner splash-corner-bottom" aria-hidden="true" />
      <section className="splash-content" aria-label="Rontab">
        <div className="splash-brand-mark" aria-hidden="true">
          <ShoppingCart size={57} strokeWidth={1.8} />
          <ArrowUpRight className="splash-brand-arrow" size={29} strokeWidth={2.8} />
        </div>
        <h1 className="splash-wordmark"><span>R</span>ontab</h1>
        <p className="splash-tagline">Connect <i /> Market <i /> Grow</p>

        {showOnly ? (
          <div className="splash-entering" role="status">
            <span className="splash-loading-line" />
            <span>Opening your Rontab</span>
          </div>
        ) : (
          <nav className="splash-actions" aria-label="Choose how to continue">
            <Link className="splash-action splash-action-primary" href="/products">
              Continue as a visitor <ArrowDownRight size={17} aria-hidden="true" />
            </Link>
            <Link className="splash-action splash-action-secondary" href="/seller/register">
              For sellers <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
            <div className="splash-seller-entry">
              <span>Already a seller?</span>
              <Link href="/seller/login">Sign in</Link>
            </div>
          </nav>
        )}
      </section>
      <p className="splash-footer">RONTAB <span>·</span> INDEPENDENT COMMERCE</p>
    </main>
  );
}