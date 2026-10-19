"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Bike,
  Check,
  UsersRound,
  CircleUserRound,
  Gift,
  House,
  LayoutDashboard,
  Languages,
  LogIn,
  Mail,
  Megaphone,
  Menu,
  Package,
  Plus,
  ShieldCheck,
  Store,
  Sun,
  Ticket,
  UserPlus,
  Volume2,
  type LucideIcon,
} from "lucide-react";
import { DismissibleDetails } from "@/components/DismissibleDetails";
import { MenuAccountLink } from "@/components/MenuAccountLink";
import {
  DEFAULT_CLIENT_PREFERENCES,
  readClientPreferences,
  subscribeToClientPreferences,
  updateClientPreferences,
  type ClientPreferences,
} from "@/lib/preferences/client";
import { signOut, type SignOutDestination } from "@/lib/auth/actions";
import { useNotificationReads } from "@/lib/notifications/read-state";
import type { getNotificationFeed } from "@/lib/notifications/feed";

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
  inbox: Mail,
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
  account?: { href: string; displayName: string; avatarUrl: string | null; label: string };
  items: NavItem[];
  menuLinks: { href: string; label: string }[];
  signOutTo?: SignOutDestination;
};

// The splash is a full-screen entry page with its own choices.
const HIDDEN_PATHS = new Set(["/"]);

export function MobileBottomNavBar({ config, notifications }: { config: MobileNavConfig; notifications: Awaited<ReturnType<typeof getNotificationFeed>> }) {
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preferences, setPreferences] = useState<ClientPreferences>(DEFAULT_CLIENT_PREFERENCES);
  const { getUnreadCount } = useNotificationReads(notifications);
  const inboxUnread = getUnreadCount("messages") + getUnreadCount("ads");

  useEffect(() => {
    const syncPreferences = () => setPreferences(readClientPreferences());
    syncPreferences();
    return subscribeToClientPreferences(syncPreferences);
  }, []);

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
        const badge = item.icon === "inbox" ? (inboxUnread ? String(Math.min(inboxUnread, 99)) : undefined) : item.badge;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={item.highlight ? "mobile-nav-highlight" : undefined}
            aria-current={active ? "page" : undefined}
            aria-label={item.icon === "inbox" ? (inboxUnread ? `Inbox, ${inboxUnread} unread` : "Inbox") : item.ariaLabel}
            data-nav-icon={item.icon}
          >
            <span className="mobile-nav-icon"><Icon size={21} aria-hidden="true" /></span>
            <span className="mobile-nav-label">{item.label}</span>
            {badge && <strong className="mobile-nav-badge" aria-hidden="true">{badge}</strong>}
            {item.dot && <span className="mobile-nav-dot" aria-hidden="true" />}
          </Link>
        );
      })}
      <DismissibleDetails className="mobile-nav-menu" onToggle={(open) => !open && setSettingsOpen(false)}>
        <summary aria-label="Open menu">
          <span className="mobile-nav-icon"><Menu size={21} aria-hidden="true" /></span>
          <span className="mobile-nav-label" aria-hidden="true">Menu</span>
        </summary>
        <div className="site-menu-panel mobile-nav-menu-panel">
          {settingsOpen ? (
            <section className="mobile-nav-settings" aria-label="Settings">
              <div className="mobile-nav-settings-heading">
                <button type="button" onClick={() => setSettingsOpen(false)} aria-label="Back to menu"><ArrowLeft size={18} aria-hidden="true" /></button>
                <h2>Settings</h2>
              </div>
              <div className="mobile-nav-settings-options">
                <label className="mobile-nav-setting-row">
                  <span className="mobile-nav-setting-copy"><Volume2 size={18} aria-hidden="true" /><span><strong>Reel sound</strong><small>{preferences.reelSoundEnabled ? "On" : "Off"}</small></span></span>
                  <input type="checkbox" checked={preferences.reelSoundEnabled} onChange={(event) => setPreferences(updateClientPreferences({ reelSoundEnabled: event.currentTarget.checked }))} aria-label="Reel sound" />
                </label>
                <label className="mobile-nav-setting-row">
                  <span className="mobile-nav-setting-copy"><Check size={18} aria-hidden="true" /><span><strong>Auto-play reels</strong><small>{preferences.autoplayReels ? "On" : "Off"}</small></span></span>
                  <input type="checkbox" checked={preferences.autoplayReels} onChange={(event) => setPreferences(updateClientPreferences({ autoplayReels: event.currentTarget.checked }))} aria-label="Auto-play reels" />
                </label>
                <label className="mobile-nav-setting-row is-unavailable">
                  <span className="mobile-nav-setting-copy"><Languages size={18} aria-hidden="true" /><span><strong>Language</strong><small>Coming soon</small></span></span>
                  <select disabled aria-label="Language"><option>English</option><option>العربية</option></select>
                </label>
                <label className="mobile-nav-setting-row is-unavailable">
                  <span className="mobile-nav-setting-copy"><Sun size={18} aria-hidden="true" /><span><strong>Appearance</strong><small>Coming soon</small></span></span>
                  <select disabled aria-label="Appearance"><option>Light</option><option>Dark</option></select>
                </label>
              </div>
              {config.signOutTo && (
                <form className="mobile-nav-settings-signout" action={signOut.bind(null, config.signOutTo)}>
                  <button className="mobile-nav-signout" type="submit">Sign out</button>
                </form>
              )}
            </section>
          ) : (
            <div className="mobile-nav-menu-links">
              {config.account && <MenuAccountLink {...config.account} />}
              {config.menuLinks.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}
              <Link href="/information">Site information</Link>
              <button className="mobile-nav-settings-button" type="button" onClick={() => setSettingsOpen(true)}>Settings</button>
            </div>
          )}
        </div>
      </DismissibleDetails>
    </nav>
  );
}
