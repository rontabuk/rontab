"use client";

import { useRef, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { ArrowUpRight, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function ShopVisitLink({
  slug,
  productName,
  className,
  children,
}: {
  slug: string;
  productName: string;
  className: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [isChecking, setIsChecking] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [portalTarget] = useState<HTMLElement | null>(() => typeof document === "undefined" ? null : document.body);
  const visitWindow = useRef<Window | null>(null);
  const openingVisit = useRef(false);
  const visitPath = `/visit/${slug}`;
  const accountUrl = `/account?next=${encodeURIComponent(visitPath)}`;
  const targetName = `rontab-shop-${slug}`;

  async function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (openingVisit.current) {
      visitWindow.current?.focus();
      return;
    }
    openingVisit.current = true;
    setIsChecking(true);
    let destination = visitWindow.current;
    let openedBlankThisClick = false;
    if (!destination || destination.closed) {
      destination = window.open("about:blank", targetName);
      if (destination) {
        openedBlankThisClick = true;
        destination.opener = null;
        visitWindow.current = destination;
      }
    } else {
      destination.focus();
    }

    const closeBlankDestination = () => {
      if (destination && !destination.closed) destination.close();
      if (visitWindow.current === destination) visitWindow.current = null;
    };

    try {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        closeBlankDestination();
        openingVisit.current = false;
        setIsChecking(false);
        setShowPrompt(true);
        return;
      }

      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user?.email_confirmed_at) {
        if (openedBlankThisClick) closeBlankDestination();
        openingVisit.current = false;
        setIsChecking(false);
        setShowPrompt(true);
        return;
      }

      if (destination && !destination.closed) destination.location.replace(visitPath);
      else router.push(visitPath);
      openingVisit.current = false;
      setIsChecking(false);
    } catch {
      closeBlankDestination();
      openingVisit.current = false;
      setIsChecking(false);
      setShowPrompt(true);
    }
  }

  return (
    <>
      <a className={className} href={visitPath} aria-label={`Visit shop for ${productName}`} aria-busy={isChecking} onClick={handleClick}>
        {children}
      </a>
      {showPrompt && portalTarget && createPortal(
        <div className="visitor-prompt-overlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setShowPrompt(false);
        }}>
          <section className="visitor-prompt-dialog" role="dialog" aria-modal="true" aria-labelledby={`visitor-prompt-${slug}`} onKeyDown={(event) => {
            if (event.key === "Escape") setShowPrompt(false);
          }}>
            <button className="visitor-prompt-close" type="button" aria-label="Close" autoFocus onClick={() => setShowPrompt(false)}><X size={18} /></button>
            <p className="admin-eyebrow">REWARD POINT</p>
            <h2 id={`visitor-prompt-${slug}`}>Earn 1 point?</h2>
            <p>Sign in to earn a point for this product, or continue as a guest.</p>
            <div className="visitor-prompt-actions">
              <Link className="visitor-prompt-account" href={accountUrl}>Sign in / Join <ArrowUpRight size={13} aria-hidden="true" /></Link>
              <Link className="visitor-prompt-guest" href={`${visitPath}?asGuest=1`}>Guest</Link>
            </div>
            <small>Guests do not earn points.</small>
          </section>
        </div>,
        portalTarget,
      )}
    </>
  );
}