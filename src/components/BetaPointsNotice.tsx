import { isBetaMode } from "@/lib/beta";

export function BetaPointsNotice() {
  if (!isBetaMode()) return null;

  return (
    <aside className="visitor-beta-value-notice" role="note">
      Beta: points and vouchers are for testing. They have no cash value and may be reset or changed.
    </aside>
  );
}
