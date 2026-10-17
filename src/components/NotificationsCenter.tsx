"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { ArrowLeft, ArrowUpRight, BadgeCheck, Bell, CheckCheck, ChevronRight, Gift, LifeBuoy, MailOpen, MailWarning, Megaphone, MessageSquareText, Sparkles } from "lucide-react";
import { useNotificationReads } from "@/lib/notifications/read-state";
import type { SiteNotification } from "@/lib/notifications/feed";

type Message = { id: string; title: string; body: string; link_url: string | null; created_at: string };
const icons = { announcement: Megaphone, "new-product": Sparkles, "verify-email": MailWarning, "loyalty-offer": Gift, "reward-result": BadgeCheck, "support-case": LifeBuoy, "collaboration-request": MessageSquareText, "creator-programme": MessageSquareText };
function subscribeTime() { return () => {}; }

function ReceivedTime({ value, compact = false }: { value: string; compact?: boolean }) {
  const hydrated = useSyncExternalStore(subscribeTime, () => true, () => false);
  const date = new Date(value);
  const formatted = hydrated ? date.toLocaleString("en-GB", {
    day: "numeric", month: compact ? "short" : "long",
    ...(compact ? {} : { year: "numeric" }),
    hour: "2-digit", minute: "2-digit",
    ...(compact ? {} : { timeZoneName: "short" }),
  }) : `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC`;
  return <time dateTime={value}>{formatted}</time>;
}

export function NotificationsCenter({ items, userId, readIds, lastSeenAt, message = null }: {
  items: SiteNotification[];
  userId: string | null;
  readIds: string[];
  lastSeenAt: string | null;
  message?: Message | null;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const { isUnread, markRead, error: readError, saving } = useNotificationReads({ userId, readIds, lastSeenAt, autoReadId: message ? `announcement-${message.id}` : undefined });
  const unreadCount = items.filter(isUnread).length;
  const visibleItems = filter === "unread" ? items.filter(isUnread) : items;

  return (
    <main className="notifications-page page-shell" data-message-open={message ? true : undefined}>
      {!userId ? (
        <>
          <header className="inbox-heading">
            <div><h1><Bell size={24} aria-hidden="true" /> Notifications</h1><p>Personal notifications are tied to your account.</p></div>
          </header>
          <section className="notifications-guest-state" aria-labelledby="notifications-guest-title">
            <Bell size={28} aria-hidden="true" />
            <h2 id="notifications-guest-title">You&apos;re browsing as a guest</h2>
            <p>Sign in or create an account to receive notifications about your activity, rewards, and messages.</p>
            <div>
              <Link href="/account?next=%2Fnotifications">Sign in</Link>
              <Link href="/account?mode=register&next=%2Fnotifications">Create account</Link>
            </div>
            {message && <article className="inbox-message notifications-guest-message">
              <div className="inbox-sender"><span className="inbox-kind" data-kind="announcement"><Megaphone size={20} aria-hidden="true" /></span><div><strong>Rontab</strong><span>Public announcement</span></div></div>
              <h2 dir="auto">{message.title}</h2>
              <div className="inbox-received"><ReceivedTime value={message.created_at} /></div>
              <div className="inbox-message-body" dir="auto">{message.body}</div>
              {message.link_url && <a className="inbox-message-link" href={message.link_url} {...(message.link_url.startsWith("https://") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>Open link <ArrowUpRight size={17} aria-hidden="true" /></a>}
            </article>}
          </section>
        </>
      ) : <>
      <header className="inbox-heading">
        <div><h1><Bell size={24} aria-hidden="true" /> Notifications</h1><p>{items.length} notifications{unreadCount > 0 ? ` / ${unreadCount} unread` : ""}</p></div>
        <button className="inbox-mark-read" type="button" title="Mark all as read" onClick={() => void markRead(visibleItems.filter((item) => isUnread(item)).map((item) => item.id))} disabled={saving || !items.some((item) => item.kind !== "verify-email" && isUnread(item))}>
          <CheckCheck size={18} aria-hidden="true" /><span>{saving ? "Updating..." : "Mark all as read"}</span>
        </button>
      </header>
      {readError && <p className="form-error" role="alert">{readError}</p>}
      <div className="inbox-workspace">
        <section className="inbox-sidebar" aria-label="Notification list">
          <div className="inbox-filters" role="group" aria-label="Filter notifications">
            <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button>
            <button type="button" aria-pressed={filter === "unread"} onClick={() => setFilter("unread")}>Unread <span>{unreadCount}</span></button>
          </div>
          {visibleItems.length ? <ul className="inbox-list">
            {visibleItems.map((item) => {
              const Icon = icons[item.kind];
              const selected = item.id === `announcement-${message?.id}`;
              return <li key={item.id}>
                <Link href={item.href ?? "/account"} className="inbox-row" aria-current={selected ? "page" : undefined} data-unread={isUnread(item) || undefined} onClick={async (event) => {
                  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  if (await markRead([item.id])) router.push(item.href ?? "/account");
                }}>
                  <span className="inbox-kind" data-kind={item.kind}><Icon size={18} aria-hidden="true" /></span>
                  <span className="inbox-row-copy"><strong>{item.title}</strong><span className="inbox-preview">{item.body}</span><ReceivedTime value={item.createdAt} compact /></span>
                  {isUnread(item) ? <span className="inbox-unread" aria-label="Unread" /> : <ChevronRight size={14} aria-hidden="true" />}
                </Link>
              </li>;
            })}
          </ul> : <div className="inbox-list-empty"><CheckCheck size={26} aria-hidden="true" /><p>{filter === "unread" ? "No unread notifications" : "No notifications yet"}</p></div>}
        </section>
        <section className="inbox-reader" aria-label="Notification content">
          {message ? <article className="inbox-message">
            <Link href="/notifications" className="inbox-back"><ArrowLeft size={17} aria-hidden="true" /> All notifications</Link>
            <div className="inbox-sender"><span className="inbox-kind" data-kind="announcement"><Megaphone size={20} aria-hidden="true" /></span><div><strong>Rontab</strong><span>Administration</span></div></div>
            <h2 dir="auto">{message.title}</h2>
            <div className="inbox-received"><ReceivedTime value={message.created_at} /></div>
            <div className="inbox-message-body" dir="auto">{message.body}</div>
            {message.link_url && <a className="inbox-message-link" href={message.link_url} {...(message.link_url.startsWith("https://") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>Open link <ArrowUpRight size={17} aria-hidden="true" /></a>}
          </article> : <div className="inbox-reader-empty"><MailOpen size={36} strokeWidth={1.5} aria-hidden="true" /><p>Select a notification</p></div>}
        </section>
      </div>
      </>}
    </main>
  );
}