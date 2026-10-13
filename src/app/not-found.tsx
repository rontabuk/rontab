import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export const metadata: Metadata = { title: "Page not found", robots: { index: false, follow: false } };

export default function NotFound() {
  return (
    <main className="status-page">
      <Link className="wordmark" href="/" aria-label="Rontab home">rontab<span>.</span></Link>
      <p className="eyebrow">404 · Page not found</p>
      <h1>This find has moved on.</h1>
      <p>The link may be out of date, or the product is no longer listed. The rest of the catalogue is still here.</p>
      <div className="status-page-actions">
        <Link className="button button-dark" href="/products">Discover products <ArrowRight size={15} aria-hidden="true" /></Link>
        <Link className="text-link" href="/">Back to Rontab</Link>
      </div>
    </main>
  );
}
