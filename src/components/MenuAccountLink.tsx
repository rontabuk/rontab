import Image from "next/image";
import Link from "next/link";
import { CircleUserRound } from "lucide-react";

export function MenuAccountLink({ href, displayName, avatarUrl, label }: {
  href: string;
  displayName: string;
  avatarUrl: string | null;
  label: string;
}) {
  return (
    <Link className="menu-account-profile" href={href}>
      <span className="menu-account-avatar">
        {avatarUrl
          ? <Image src={avatarUrl} alt="" width={44} height={44} unoptimized />
          : <CircleUserRound size={26} aria-hidden="true" />}
      </span>
      <span className="menu-account-copy">
        <strong dir="auto">{displayName}</strong>
        <span>{label}</span>
      </span>
    </Link>
  );
}