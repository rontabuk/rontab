"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { BadgeCheck, Bell, Check, CheckCheck, Gift, LifeBuoy, Mail, MailWarning, Megaphone, MessageSquareText, Sparkles, Volume2, VolumeX } from "lucide-react";
import { sendVisitorEmailVerification } from "@/app/account/actions";
import { useNotificationReads } from "@/lib/notifications/read-state";
import type { SiteNotification } from "@/lib/notifications/feed";
import { getNotificationChannel, type NotificationChannel } from "@/lib/notifications/channels";

const icons = { "verify-email": MailWarning, announcement: Megaphone, "new-product": Sparkles, "loyalty-offer": Gift, "reward-result": BadgeCheck, "support-case": LifeBuoy, "collaboration-request": MessageSquareText, "creator-programme": MessageSquareText };
const soundChangedEvent = "rontab:notification-sound-changed";
const volatileSoundPreferences = new Set<string>();

function subscribeToSoundPreference(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(soundChangedEvent, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(soundChangedEvent, onChange);
  };
}

function getSoundPreference(key: string) {
  try {
    return localStorage.getItem(key) === "on" || volatileSoundPreferences.has(key);
  } catch {
    return volatileSoundPreferences.has(key);
  }
}

function saveSoundPreference(key: string, enabled: boolean) {
  if (enabled) volatileSoundPreferences.add(key);
  else volatileSoundPreferences.delete(key);
  try {
    localStorage.setItem(key, enabled ? "on" : "off");
  } catch {
    return;
  }
}

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
  const [channel, setChannel] = useState<NotificationChannel>("messages");
  const [resendState, setResendState] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [isResending, startResend] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const knownIdsRef = useRef(new Set(items.map((item) => item.id)));
  const pendingToneRef = useRef(false);
  const soundStorageKey = `rontab:notification-sound:v1:${userId ?? "guest"}`;
  const soundEnabled = useSyncExternalStore(subscribeToSoundPreference, () => getSoundPreference(soundStorageKey), () => false);
  const { isUnread, markRead, error: readError, saving } = useNotificationReads({ userId, readIds, lastSeenAt });
  const unreadItems = items.filter(isUnread);
  const unread = unreadItems.length;
  const channelItems = items.filter((item) => getNotificationChannel(item) === channel);
  const visibleItems = tab === "unread" ? channelItems.filter(isUnread) : channelItems;
  const channelUnread = channelItems.filter(isUnread);

  useEffect(() => {
    const refreshNotifications = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const interval = window.setInterval(refreshNotifications, 30_000);
    document.addEventListener("visibilitychange", refreshNotifications);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshNotifications);
    };
  }, [router]);

  useEffect(() => {
    const currentIds = new Set(items.map((item) => item.id));
    const hasArrivals = [...currentIds].some((id) => !knownIdsRef.current.has(id));
    knownIdsRef.current = currentIds;
    if (hasArrivals && soundEnabled) {
      if (document.visibilityState === "visible") void playNotificationTone();
      else pendingToneRef.current = true;
    }
  }, [items, soundEnabled]);

  useEffect(() => {
    const playPendingTone = () => {
      if (document.visibilityState !== "visible" || !soundEnabled || !pendingToneRef.current) return;
      pendingToneRef.current = false;
      void playNotificationTone();
    };
    document.addEventListener("visibilitychange", playPendingTone);
    return () => document.removeEventListener("visibilitychange", playPendingTone);
  }, [soundEnabled]);

  async function playNotificationTone() {
    if (typeof window === "undefined" || !("AudioContext" in window)) return;
    try {
      const audioContext = audioContextRef.current ?? new AudioContext();
      audioContextRef.current = audioContext;
      if (audioContext.state === "suspended") await audioContext.resume();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, audioContext.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.24);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.25);
    } catch {
      return;
    }
  }

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
        aria-label={unread ? `Inbox, ${unread} unread` : "Inbox"}
        title="Inbox"
        aria-controls="notification-panel"
        onClick={toggle}
      >
        <Mail size={19} aria-hidden="true" />
        {unread > 0 && <span className="notification-bell-count" aria-hidden="true">{unread > 9 ? "9+" : unread}</span>}
      </button>
      <section id="notification-panel" className="notification-panel" data-open={open || undefined} aria-label="Inbox" aria-hidden={!open} inert={!open}>
        <header className="notification-panel-header">
          <div className="notification-panel-title">
            <h2>Inbox</h2>
            {userId && <div className="notification-panel-controls">
              <button type="button" className="notification-sound-toggle" title={soundEnabled ? "Turn notification sound off" : "Turn notification sound on"} aria-label={soundEnabled ? "Turn notification sound off" : "Turn notification sound on"} aria-pressed={soundEnabled} onClick={() => {
                const nextEnabled = !soundEnabled;
                saveSoundPreference(soundStorageKey, nextEnabled);
                window.dispatchEvent(new Event(soundChangedEvent));
                if (nextEnabled) void playNotificationTone();
              }}>
                {soundEnabled ? <Volume2 size={17} aria-hidden="true" /> : <VolumeX size={17} aria-hidden="true" />}
              </button>
              {channelUnread.some((item) => item.kind !== "verify-email") && (
                <button type="button" className="notification-mark-read" disabled={saving} onClick={() => void markRead(channelUnread.map((item) => item.id))}>
                  <CheckCheck size={15} aria-hidden="true" /> Mark all as read
                </button>
              )}
            </div>}
          </div>
          <div className="notification-channels" role="group" aria-label="Inbox sections">
            <button type="button" aria-pressed={channel === "messages"} onClick={() => setChannel("messages")}>Messages</button>
            <button type="button" aria-pressed={channel === "ads"} onClick={() => setChannel("ads")}>Ad notifications</button>
          </div>
          {userId && <div className="notification-tabs" role="tablist" aria-label="Filter notifications">
            <button type="button" role="tab" aria-selected={tab === "all"} onClick={() => setTab("all")}>All</button>
            <button type="button" role="tab" aria-selected={tab === "unread"} onClick={() => setTab("unread")}>
              Unread{channelUnread.length > 0 && <span>{channelUnread.length}</span>}
            </button>
          </div>}
        </header>
        {readError && <p className="form-error" role="alert">{readError}</p>}
        {hasOpened && !userId ? (
          <div className="notification-guest-state">
            <p>You&apos;re browsing as a guest. Sign in or create an account to receive notifications about your account.</p>
            <div>
              <Link href="/account?next=%2Fnotifications">Sign in</Link>
              <Link href="/account?mode=register&next=%2Fnotifications">Create account</Link>
            </div>
          </div>
        ) : hasOpened && (visibleItems.length ? (
          <ul className="notification-list">
            {visibleItems.map((item, index) => {
              const Icon = item.completed ? BadgeCheck : icons[item.kind];
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
                <li key={item.id} data-kind={item.kind} data-completed={item.completed || undefined} data-unread={unreadItem || undefined} style={{ animationDelay: `${Math.min(index, 8) * 25}ms` }}>
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
                  {item.kind === "verify-email" && item.completed && (
                    <div className="notification-actions"><span className="notification-done"><Check size={15} aria-hidden="true" /> Done</span></div>
                  )}
                  {item.kind === "verify-email" && !item.completed && (
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
            <p>{tab === "unread" ? "You're all caught up." : channel === "messages" ? "No messages yet." : "No ad notifications yet."}</p>
          </div>
        ))}
        <Link className="notification-view-all" href={`/notifications?tab=${channel}`} onClick={() => setOpen(false)}>Open inbox</Link>
      </section>
    </div>
  );
}
