"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#eef2f3", color: "#17201f", fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif" }}>
        <title>Something went wrong | RonTab</title>
        <main style={{ maxWidth: 460, padding: 24, textAlign: "center" }}>
          <p style={{ margin: 0, fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.7 }}>Something went wrong</p>
          <h1 style={{ margin: "12px 0", fontSize: 28 }}>RonTab could not load this page.</h1>
          <p style={{ margin: "0 0 24px", lineHeight: 1.5 }}>Please try again. If it keeps happening, wait a few minutes before retrying.</p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={() => retry()} style={{ padding: "12px 22px", border: 0, borderRadius: 999, background: "#17201f", color: "#fff", font: "inherit", fontWeight: 600, cursor: "pointer" }}>Try again</button>
            <Link href="/products" style={{ color: "inherit", fontWeight: 600 }}>Go to products</Link>
          </div>
        </main>
      </body>
    </html>
  );
}
