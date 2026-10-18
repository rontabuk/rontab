import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { signOut, type SignOutDestination } from "@/lib/auth/actions";

export function WorkspaceShell({
  area,
  sectionLabel,
  navigation,
  accountLabel,
  signOutTo,
  brandBackHref,
  hideMobileAccountDetails = false,
  children,
}: {
  area?: string;
  sectionLabel: string;
  navigation: ReactNode;
  accountLabel: string;
  signOutTo: SignOutDestination;
  brandBackHref?: string;
  hideMobileAccountDetails?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`admin-shell${hideMobileAccountDetails ? " admin-shell-hide-mobile-account" : ""}`}>
      <aside className="admin-sidebar">
        {brandBackHref ? (
          <Link className="admin-brand admin-brand-back" href={brandBackHref} aria-label="Back to products" title="Back to products">
            <ChevronLeft size={24} strokeWidth={2} aria-hidden="true" />
          </Link>
        ) : (
          <Link className="admin-brand" href="/products" aria-label="Back to products" title="Back to products">
            <ChevronLeft size={24} aria-hidden="true" />
            {area && <small>{area}</small>}
          </Link>
        )}
        <p className="admin-sidebar-label">{sectionLabel}</p>
        {navigation}
        <div className="admin-sidebar-bottom">
          <span>{accountLabel}</span>
          <form action={signOut.bind(null, signOutTo)}>
            <button className="admin-signout-button" type="submit">Sign out</button>
          </form>
        </div>
      </aside>
      <div className="admin-main">{children}</div>
    </div>
  );
}
