"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";
import { ArrowLeft, ArrowUpRight, BadgeCheck, CheckCheck, ChevronDown, ChevronRight, Gift, LifeBuoy, Mail, MailOpen, MailWarning, Megaphone, MessageSquareText, Sparkles } from "lucide-react";
import { useNotificationReads } from "@/lib/notifications/read-state";
import { getNotificationChannel, type NotificationChannel } from "@/lib/notifications/channels";
import { loadMoreNotifications } from "@/lib/notifications/actions";
import { sendVisitorEmailVerification } from "@/app/account/actions";
import type { SiteNotification } from "@/lib/notifications/feed";

type Message = { id: string; title: string; body: string; link_url: string | null; created_at: string };
const icons = { welcome: Mail, announcement: Megaphone, "new-product": Sparkles, "verify-email": MailWarning, "loyalty-offer": Gift, "reward-result": BadgeCheck, "support-case": LifeBuoy, "collaboration-request": MessageSquareText, "creator-programme": MessageSquareText };
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

function EmailConfirmationAction() {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  return <div className="inbox-confirmation-action">
    <button type="button" disabled={pending} onClick={() => startTransition(async () => {
      const { error } = await sendVisitorEmailVerification();
      setFeedback(error ?? "Sent! Check your inbox and spam folder.");
    })}>{pending ? "Sending..." : "Resend confirmation email"}</button>
    {feedback && <p role="status">{feedback}</p>}
  </div>;
}

export function NotificationsCenter({ items, userId, readIds, lastSeenAt, message = null, hasMore, unreadCounts }: {
  items: SiteNotification[];
  userId: string | null;
  readIds: string[];
  lastSeenAt: string | null;
  message?: Message | null;
  hasMore?: Record<NotificationChannel, boolean>;
  unreadCounts?: Record<NotificationChannel, number>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const channel = message || searchParams.get("tab") !== "ads" ? "messages" : "ads";
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [older, setOlder] = useState<{ userId: string | null; items: SiteNotification[]; readIds: string[]; hasMore: Partial<Record<NotificationChannel, boolean>> }>({ userId, items: [], readIds: [], hasMore: {} });
  const [loading, startLoading] = useTransition();
  const [loadError, setLoadError] = useState<string | null>(null);
  const extraItems = older.userId === userId ? older.items : [];
  const allItems = [...new Map([...extraItems, ...items].map((item) => [item.id, item])).values()].sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt) || (first.id < second.id ? 1 : first.id > second.id ? -1 : 0));
  const allReadIds = [...readIds, ...(older.userId === userId ? older.readIds : [])];
  const { isUnread, getUnreadCount, markRead, error: readError, saving } = useNotificationReads({ userId, readIds: allReadIds, lastSeenAt, items, unreadCounts, autoReadId: message ? `announcement-${message.id}` : undefined });
  const channelItems = allItems.filter((item) => getNotificationChannel(item) === channel);
  const unreadCount = getUnreadCount(channel);
  const visibleItems = filter === "unread" ? channelItems.filter(isUnread) : channelItems;
  const unreadMessages = getUnreadCount("messages");
  const unreadAds = getUnreadCount("ads");
  const moreAvailable = (older.userId === userId ? older.hasMore[channel] : undefined) ?? hasMore?.[channel] ?? false;

  function loadMore() {
    const last = channelItems.filter((item) => item.kind !== "verify-email").at(-1);
    if (!last || !userId || loading) return;
    setLoadError(null);
    startLoading(async () => {
      const result = await loadMoreNotifications(channel, { createdAt: last.createdAt, id: last.id }, userId);
      if (result.error || !result.page) {
        setLoadError(result.error ?? "We couldn't load more notifications. Please try again.");
        return;
      }
      const page = result.page;
      setOlder((current) => ({
        userId,
        items: [...(current.userId === userId ? current.items : []), ...items.filter((item) => item.kind !== "verify-email"), ...page.items],
        readIds: [...(current.userId === userId ? current.readIds : []), ...readIds, ...page.readIds],
        hasMore: { ...(current.userId === userId ? current.hasMore : {}), [channel]: page.hasMore },
      }));
    });
  }

  return (
    <main className="notifications-page page-shell" data-message-open={message ? true : undefined}>
      <header className="inbox-heading">
        <div><h1>Inbox</h1></div>
        {userId && <button className="inbox-mark-read" type="button" title="Mark displayed notifications as read" aria-label="Mark displayed notifications as read" onClick={() => void markRead(visibleItems.filter((item) => isUnread(item)).map((item) => item.id))} disabled={saving || !visibleItems.some((item) => item.kind !== "verify-email" && isUnread(item))}>
          <CheckCheck size={18} aria-hidden="true" /><span>{saving ? "Updating..." : "Mark displayed as read"}</span>
        </button>}
      </header>
      <div className="inbox-channels" role="tablist" aria-label="Inbox sections" onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>('[role="tab"]'));
        const index = tabs.indexOf(event.target as HTMLAnchorElement);
        const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        event.preventDefault();
        tabs[nextIndex]?.focus();
        tabs[nextIndex]?.click();
      }}>
        <Link id="inbox-messages-tab" role="tab" aria-selected={channel === "messages"} aria-controls="inbox-channel-panel" href="/notifications?tab=messages" replace scroll={false}>Messages{unreadMessages > 0 && <span aria-label={`${unreadMessages} unread messages`}>{unreadMessages}</span>}</Link>
        <Link id="inbox-ads-tab" role="tab" aria-selected={channel === "ads"} aria-controls="inbox-channel-panel" href="/notifications?tab=ads" replace scroll={false}>Ad notifications{unreadAds > 0 && <span aria-label={`${unreadAds} unread ad notifications`}>{unreadAds}</span>}</Link>
      </div>
      <div id="inbox-channel-panel" role="tabpanel" aria-labelledby={`inbox-${channel}-tab`} tabIndex={0}>
      {!userId ? (
        <>
          <section className="notifications-guest-state" aria-labelledby="notifications-guest-title">
            {channel === "messages" ? <Mail size={52} strokeWidth={1.5} aria-hidden="true" /> : <Megaphone size={52} strokeWidth={1.5} aria-hidden="true" />}
            <h2 id="notifications-guest-title">{channel === "messages" ? "No messages yet" : "No ad notifications yet"}</h2>
            <p>{channel === "messages" ? "Sign in to receive messages from the team, sellers, and creators." : "Sign in to receive product updates and offers."}</p>
            <div>
              <Link href={`/account?next=${encodeURIComponent(`/notifications?tab=${channel}`)}`}>Sign in</Link>
              <Link href={`/account?mode=register&next=${encodeURIComponent(`/notifications?tab=${channel}`)}`}>Create account</Link>
            </div>
            {message && <article className="inbox-message notifications-guest-message">
              <div className="inbox-sender"><span className="inbox-kind" data-kind="announcement"><Megaphone size={20} aria-hidden="true" /></span><div><strong>Announcements</strong><span>Public announcement</span></div></div>
              <h2 dir="auto">{message.title}</h2>
              <div className="inbox-received"><ReceivedTime value={message.created_at} /></div>
              <div className="inbox-message-body" dir="auto">{message.body}</div>
              {message.link_url && <a className="inbox-message-link" href={message.link_url} {...(message.link_url.startsWith("https://") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>Open link <ArrowUpRight size={17} aria-hidden="true" /></a>}
            </article>}
          </section>
        </>
      ) : <>
      {readError && <p className="form-error" role="alert">{readError}</p>}
      <div className="inbox-workspace" data-empty={!channelItems.length && !message || undefined}>
        <section className="inbox-sidebar" aria-label="Notification list" aria-busy={loading}>
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
                {item.kind === "verify-email" && !item.completed && <EmailConfirmationAction />}
              </li>;
            })}
          </ul> : <div className="inbox-list-empty">{channel === "messages" ? <Mail size={52} strokeWidth={1.5} aria-hidden="true" /> : <Megaphone size={52} strokeWidth={1.5} aria-hidden="true" />}<h2>{filter === "unread" ? "You're all caught up" : channel === "messages" ? "No messages yet" : "No ad notifications yet"}</h2><p>{filter === "unread" ? "No unread items in this section." : channel === "messages" ? "Messages from the team, sellers, and creators will appear here." : "Product updates and offers will appear here."}</p></div>}
          {loadError && <p className="form-error" role="alert">{loadError}</p>}
          {moreAvailable && <button className="inbox-load-more" type="button" disabled={loading} onClick={loadMore}><ChevronDown size={17} aria-hidden="true" />{loading ? "Loading..." : "Load more"}</button>}
        </section>
        <section className="inbox-reader" aria-label="Notification content">
          {message ? <article className="inbox-message">
            <Link href="/notifications?tab=messages" className="inbox-back"><ArrowLeft size={17} aria-hidden="true" /> All messages</Link>
            <div className="inbox-sender"><span className="inbox-kind" data-kind="announcement"><Megaphone size={20} aria-hidden="true" /></span><div><strong>Support team</strong><span>Administration</span></div></div>
            <h2 dir="auto">{message.title}</h2>
            <div className="inbox-received"><ReceivedTime value={message.created_at} /></div>
            <div className="inbox-message-body" dir="auto">{message.body}</div>
            {message.link_url && <a className="inbox-message-link" href={message.link_url} {...(message.link_url.startsWith("https://") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>Open link <ArrowUpRight size={17} aria-hidden="true" /></a>}
          </article> : <div className="inbox-reader-empty"><MailOpen size={36} strokeWidth={1.5} aria-hidden="true" /><p>{channel === "messages" ? "Select a message" : "Select an ad notification"}</p></div>}
        </section>
      </div>
      </>}
      </div>
    </main>
  );
}