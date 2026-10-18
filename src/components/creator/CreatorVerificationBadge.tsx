import { BadgeCheck } from "lucide-react";

export function CreatorVerificationBadge() {
  return (
    <span
      className="creator-verification-badge is-grey"
      title="Creator profile approved by the team"
      aria-label="Approved creator"
    >
      <BadgeCheck size={14} aria-hidden="true" />
      <span>Approved</span>
    </span>
  );
}
