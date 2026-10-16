"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="status-page">
      <Link className="wordmark" href="/products" aria-label="RonTab products">RonTab</Link>
      <p className="eyebrow">Something went wrong</p>
      <h1>We could not finish that request.</h1>
      <p>Please try again. If it keeps happening, wait a few minutes before retrying.</p>
      <div className="status-page-actions">
        <button className="button button-dark" type="button" onClick={() => retry()}>Try again</button>
        <Link className="text-link" href="/products">Go to products</Link>
      </div>
    </main>
  );
}
