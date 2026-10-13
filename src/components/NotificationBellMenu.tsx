"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Bell, CheckCheck, MailWarning, Megaphone, Sparkles } from "lucide-react";
import { sendVisitorEmailVerification } from "@/app/account/actions";
import { useNotificationReads } from "@/lib/notifications/read-state";
import type { SiteNotification } from "@/lib/notifications/feed";

const icons = { "verify-email": MailWarning, announcement: Megaphone, "new-product": Sparkles };

function formatExact(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function NotificationBellMenu({
  items,
  userId,
  readIds,
  lastSeenAt,
}: {
  items: SiteNotification[];
  userId: string | null;
  readIds: string[];
  lastSeenAt: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [resendState, setResendState] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [isResending, startResend] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const { isUnread, markRead, error: readError, saving } = useNotificationReads({ userId, readIds, lastSeenAt });
  const unreadItems = items.filter(isUnread);
  const unread = unreadItems.length;
  const visibleItems = tab === "unread" ? unreadItems : items;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    // The mobile panel is fixed-positioned; anchor it under the bell so the trigger stays clickable.
    const placePanel = () => {
      const bottom = rootRef.current?.getBoundingClientRect().bottom ?? 0;
      rootRef.current?.style.setProperty("--notification-panel-top", `${Math.max(8, Math.round(bottom + 8))}px`);
    };
    placePanel();
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", placePanel, { passive: true });
    window.addEventListener("resize", placePanel);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", placePanel);
      window.removeEventListener("resize", placePanel);
    };
  }, [open]);

  function toggle() {
    setOpen(!open);
    setHasOpened(true);
  }

  function resend() {
    startResend(async () => {
      const { error } = await sendVisitorEmailVerification();
      setResendState(error ? { tone: "error", text: error } : { tone: "ok", text: "Sent! Check your inbox and spam folder." });
    });
  }

  return (
    <div className="notification-bell" ref={rootRef}>
      <button
        className="notification-bell-trigger"
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-controls="notification-panel"
        onClick={toggle}
      >
        <Bell size={19} aria-hidden="true" />
        {unread > 0 && <span className="notification-bell-count" aria-hidden="true">{unread > 9 ? "9+" : unread}</span>}
      </button>
      <section id="notification-panel" className="notification-panel" data-open={open || undefined} aria-label="Notifications" aria-hidden={!open} inert={!open}>
        <header className="notification-panel-header">
          <div className="notification-panel-title">
            <h2>Notifications</h2>
            {unreadItems.some((item) => item.kind !== "verify-email") && (
              <button type="button" className="notification-mark-read" disabled={saving} onClick={() => void markRead(unreadItems.map((item) => item.id))}>
                <CheckCheck size={15} aria-hidden="true" /> Mark all as read
              </button>
            )}
          </div>
          <div className="notification-tabs" role="tablist" aria-label="Filter notifications">
            <button type="button" role="tab" aria-selected={tab === "all"} onClick={() => setTab("all")}>All</button>
            <button type="button" role="tab" aria-selected={tab === "unread"} onClick={() => setTab("unread")}>
              Unread{unreadItems.length > 0 && <span>{unreadItems.length}</span>}
            </button>
          </div>
        </header>
        {readError && <p className="form-error" role="alert">{readError}</p>}
        {hasOpened && (visibleItems.length ? (
          <ul className="notification-list">
            {visibleItems.map((item, index) => {
              const Icon = icons[item.kind];
              const unreadItem = isUnread(item);
              const content = (
                <>
                  <span className="notification-icon" data-kind={item.kind}><Icon size={20} aria-hidden="true" /></span>
                  <span className="notification-copy">
                    <span className="notification-text"><strong>{item.title}</strong> {item.body}</span>
                    <time dateTime={item.createdAt} title={formatExact(item.createdAt)}>{formatExact(item.createdAt)}</time>
                  </span>
                  {unreadItem && <span className="notification-dot" aria-label="Unread" />}
                </>
              );
              return (
                <li key={item.id} data-kind={item.kind} data-unread={unreadItem || undefined} style={{ animationDelay: `${Math.min(index, 8) * 25}ms` }}>
                  {item.href ? (
                    <Link className="notification-item" href={item.href} onClick={async (event) => {
                      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                      event.preventDefault();
                      if (await markRead([item.id])) {
                        setOpen(false);
                        router.push(item.href!);
                      }
                    }}>{content}</Link>
                  ) : (
                    <div className="notification-item">{content}</div>
                  )}
                  {item.kind === "verify-email" && (
                    <div className="notification-actions">
                      <button type="button" onClick={resend} disabled={isResending}>
                        {isResending ? "Sending…" : "Resend confirmation email"}
                      </button>
                      {resendState && <p data-tone={resendState.tone} role="status">{resendState.text}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="notification-empty">
            <Bell size={30} aria-hidden="true" />
            <p>{tab === "unread" ? "No unread notifications." : "You're all caught up."}</p>
          </div>
        ))}
        <Link className="notification-view-all" href="/notifications" onClick={() => setOpen(false)}>View all notifications</Link>
      </section>
    </div>
  );
}
