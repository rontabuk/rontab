import { BadgeCheck } from "lucide-react";

export function CreatorVerificationBadge({ fanCount }: { fanCount: number }) {
  const blueBadge = fanCount >= 10000;
  return (
    <span
      className={`creator-verification-badge ${blueBadge ? "is-blue" : "is-grey"}`}
      title={blueBadge ? "Creator has reached 10,000 fans" : "Creator profile approved by the team"}
      aria-label={blueBadge ? "10,000 or more fans" : "Approved creator"}
    >
      <BadgeCheck size={14} aria-hidden="true" />
      <span>{blueBadge ? "10K+ fans" : "Approved"}</span>
    </span>
  );
}
