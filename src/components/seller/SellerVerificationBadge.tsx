import { BadgeCheck } from "lucide-react";

export function SellerVerificationBadge({ isBlue = false }: { isBlue?: boolean }) {
  return (
    <span
      className={`seller-verification-badge ${isBlue ? "is-blue" : "is-grey"}`}
      title={isBlue ? "Blue verified Rontab seller" : "Verified Rontab seller"}
      aria-label={isBlue ? "Blue verified Rontab seller" : "Verified Rontab seller"}
    >
      <BadgeCheck size={15} aria-hidden="true" />
    </span>
  );
}