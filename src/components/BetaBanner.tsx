import { isBetaMode } from "@/lib/beta";

export function BetaBanner() {
  if (!isBetaMode()) return null;

  return (
    <aside className="beta-banner" aria-label="Beta notice">
      <p>RonTab is in beta. Features may change and nothing here is a final offer.</p>
      <a href="mailto:rontabuk@gmail.com?subject=RonTab%20beta%20feedback">Give feedback</a>
    </aside>
  );
}
