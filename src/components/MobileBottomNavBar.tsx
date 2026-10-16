"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bike,
  UsersRound,
  CircleUserRound,
  Gift,
  House,
  LayoutDashboard,
  LogIn,
  Megaphone,
  Menu,
  Package,
  Plus,
  ShieldCheck,
  Store,
  Ticket,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { DismissibleDetails } from "@/components/DismissibleDetails";
import { signOut, type SignOutDestination } from "@/lib/auth/actions";

const icons = {
  home: House,
  riders: Bike,
  creators: UsersRound,
  join: UserPlus,
  signin: LogIn,
  rewards: Gift,
  account: CircleUserRound,
  products: Package,
  add: Plus,
  ads: Megaphone,
  overview: LayoutDashboard,
  review: ShieldCheck,
  sellers: Store,
  ticket: Ticket,
} satisfies Record<string, LucideIcon>;

type NavItem = {
  href: string;
  label: string;
  icon: keyof typeof icons;
  exact?: boolean;
  highlight?: boolean;
  badge?: string;
  dot?: boolean;
  ariaLabel?: string;
  disabled?: boolean;
};

export type MobileNavConfig = {
  label: string;
  items: NavItem[];
  menuLinks: { href: string; label: string }[];
  signOutTo?: SignOutDestination;
};

// The splash is a full-screen entry page with its own choices.
const HIDDEN_PATHS = new Set(["/"]);

export function MobileBottomNavBar({ config }: { config: MobileNavConfig }) {
  const pathname = usePathname();
  if (HIDDEN_PATHS.has(pathname)) return null;

  const isActive = ({ href, exact }: NavItem) => {
    if (/[?#]/.test(href)) return false;
    return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <nav className="mobile-bottom-nav" aria-label={config.label}>
      {config.items.map((item) => {
        const Icon = icons[item.icon];
        if (item.disabled) {
          return (
            <button key={item.href} type="button" aria-disabled="true" aria-label={`${item.label}, coming soon`} title={`${item.label}, coming soon`}>
              <span className="mobile-nav-icon"><Icon size={21} aria-hidden="true" /></span>
              <span className="mobile-nav-label">{item.label}</span>
            </button>
          );
        }
        const active = isActive(item);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={item.highlight ? "mobile-nav-highlight" : undefined}
            aria-current={active ? "page" : undefined}
            aria-label={item.ariaLabel}
          >
            <span className="mobile-nav-icon"><Icon size={21} aria-hidden="true" /></span>
            <span className="mobile-nav-label">{item.label}</span>
            {item.badge && <strong className="mobile-nav-badge" aria-hidden="true">{item.badge}</strong>}
            {item.dot && <span className="mobile-nav-dot" aria-hidden="true" />}
          </Link>
        );
      })}
      <DismissibleDetails className="mobile-nav-menu">
        <summary aria-label="Open menu">
          <span className="mobile-nav-icon"><Menu size={21} aria-hidden="true" /></span>
          <span className="mobile-nav-label" aria-hidden="true">Menu</span>
        </summary>
        <div className="site-menu-panel mobile-nav-menu-panel">
          <div className="site-menu-extras">
            {config.menuLinks.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}
          </div>
          {config.signOutTo && (
            <form className="site-menu-extras" action={signOut.bind(null, config.signOutTo)}>
              <button className="mobile-nav-signout" type="submit">Sign out</button>
            </form>
          )}
        </div>
      </DismissibleDetails>
    </nav>
  );
}
