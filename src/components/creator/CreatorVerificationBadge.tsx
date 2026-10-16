import { BadgeCheck } from "lucide-react";

export function CreatorVerificationBadge({ fanCount }: { fanCount: number }) {
  const blueBadge = fanCount >= 10000;
  return (
    <span
      className={`creator-verification-badge ${blueBadge ? "is-blue" : "is-grey"}`}
      title={blueBadge ? "Creator has reached 10,000 Rontab fans" : "Creator profile approved by Rontab"}
      aria-label={blueBadge ? "10,000 or more Rontab fans" : "Rontab-approved creator"}
    >
      <BadgeCheck size={14} aria-hidden="true" />
      <span>{blueBadge ? "10K+ fans" : "Rontab approved"}</span>
    </span>
  );
}
