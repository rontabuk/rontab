"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Download, Maximize, MonitorSmartphone, Share, SquarePlus, X, Zap } from "lucide-react";
import "./InstallPrompt.css";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type Mode = "native" | "ios" | "ios-inapp" | "safari-mac";

const SNOOZE_KEY = "rontab-install-snooze-until";
const SNOOZE_DAYS = 7;
const OPEN_DELAY_MS = 2_500;

function snooze(days: number) {
  try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + days * 86_400_000)); } catch { /* storage unavailable */ }
}

function isSnoozed() {
  try { return Number(localStorage.getItem(SNOOZE_KEY) ?? 0) > Date.now(); } catch { return false; }
}

function detectStaticMode(): Mode | null {
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIos) return /FBAN|FBAV|Instagram|Line\/|Snapchat|TikTok|GSA\//.test(ua) ? "ios-inapp" : "ios";
  const isSafari = /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(ua);
  return isSafari && /Macintosh/.test(ua) ? "safari-mac" : null;
}

export function InstallPrompt() {
  const pathname = usePathname();
  const [mode, setMode] = useState<Mode | null>(null);
  const [open, setOpen] = useState(false);
  const installEvent = useRef<InstallEvent | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const hidden = pathname.startsWith("/admin");

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const installed = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    if (installed || isSnoozed()) return;

    let timer: number | undefined;
    const schedule = (next: Mode) => {
      setMode(next);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setOpen(!isSnoozed()), OPEN_DELAY_MS);
    };
    const onPrompt = (event: Event) => {
      event.preventDefault();
      installEvent.current = event as InstallEvent;
      schedule("native");
    };
    const onInstalled = () => { setOpen(false); snooze(365); };

    const staticMode = detectStaticMode();
    if (staticMode) schedule(staticMode);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = useCallback(() => { setOpen(false); snooze(SNOOZE_DAYS); }, []);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss, open]);

  async function install() {
    const event = installEvent.current;
    if (!event) return;
    await event.prompt();
    const { outcome } = await event.userChoice;
    installEvent.current = null;
    setOpen(false);
    snooze(outcome === "accepted" ? 365 : SNOOZE_DAYS);
  }

  if (!open || !mode || hidden) return null;

  return (
    <div className="install-overlay" onClick={dismiss}>
      <div className="install-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="install-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <button className="install-close" type="button" onClick={dismiss} aria-label="Close"><X size={18} /></button>
        <div className="install-icon" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/pwa-icon/192" alt="" width={72} height={72} />
        </div>
        <h2 id="install-title">Get the app</h2>
        <p className="install-lead">Add the app to your {mode === "safari-mac" ? "Dock" : mode.startsWith("ios") ? "Home Screen" : "device"} and shop like it&apos;s a native app.</p>
        <ul className="install-benefits">
          <li><Zap size={18} aria-hidden="true" /><span>One tap from your {mode.startsWith("ios") ? "Home Screen" : "desktop or dock"}</span></li>
          <li><Maximize size={18} aria-hidden="true" /><span>Full screen with no browser bars</span></li>
          <li><MonitorSmartphone size={18} aria-hidden="true" /><span>Free, no App Store, always up to date</span></li>
        </ul>

        {mode === "native" && (
          <button className="install-primary" type="button" onClick={install}><Download size={18} aria-hidden="true" /> Install app</button>
        )}
        {mode === "ios" && (
          <ol className="install-steps">
            <li><Share size={18} aria-hidden="true" /><span>Tap <b>Share</b> in Safari (or <b>•••</b> then <b>Share</b>)</span></li>
            <li><SquarePlus size={18} aria-hidden="true" /><span>Choose <b>Add to Home Screen</b></span></li>
            <li><Download size={18} aria-hidden="true" /><span>Tap <b>Add</b> and open the app from your Home Screen</span></li>
          </ol>
        )}
        {mode === "ios-inapp" && (
          <p className="install-note">Open this page in Safari first, then tap Share and choose <b>Add to Home Screen</b>.</p>
        )}
        {mode === "safari-mac" && (
          <p className="install-note">In Safari, choose <b>File</b> then <b>Add to Dock</b>.</p>
        )}
        <button className="install-later" type="button" onClick={dismiss}>{mode === "native" ? "Not now" : "Got it"}</button>
      </div>
    </div>
  );
}
