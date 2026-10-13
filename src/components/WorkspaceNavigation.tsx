"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type WorkspaceLink = {
  href: string;
  label: string;
  exact?: boolean;
  indicator?: string;
};

export function WorkspaceNavigation({ label, links }: { label: string; links: readonly WorkspaceLink[] }) {
  const pathname = usePathname();

  return (
    <nav className="admin-navigation" aria-label={label}>
      {links.map(({ href, label: linkLabel, exact, indicator }) => {
        const isActive = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            className={isActive ? "admin-navigation-active" : undefined}
            href={href}
            aria-current={isActive ? "page" : undefined}
            key={href}
          >
            {linkLabel}
            {indicator && !isActive && <span className="workspace-nav-indicator" role="img" aria-label={indicator} title={indicator} />}
          </Link>
        );
      })}
    </nav>
  );
}
