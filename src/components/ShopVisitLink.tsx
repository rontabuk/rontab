"use client";

import { useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
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
  const [promptBounds, setPromptBounds] = useState<CSSProperties | null>(null);
  const visitPath = `/visit/${slug}`;
  const accountUrl = `/account?next=${encodeURIComponent(visitPath)}`;

  function showVisitorPrompt(anchor: HTMLAnchorElement) {
    const productImage = anchor.closest<HTMLElement>(".product-image");
    const descriptionPanel = productImage?.querySelector<HTMLElement>(".description-panel");
    const panelBounds = descriptionPanel?.getBoundingClientRect();
    if (panelBounds) {
      setPromptBounds({
        position: "fixed",
        top: panelBounds.top,
        left: panelBounds.left,
        width: panelBounds.width,
        height: panelBounds.height,
      });
    } else if (productImage) {
      const imageBounds = productImage.getBoundingClientRect();
      const panelHeight = Math.min(116, imageBounds.height * 0.48);
      setPromptBounds({
        position: "fixed",
        top: Math.max(imageBounds.top + 8, imageBounds.bottom - 54 - panelHeight),
        left: imageBounds.left + 12,
        width: Math.max(0, imageBounds.width - 24),
        height: panelHeight,
      });
    } else {
      setPromptBounds(null);
    }
    setShowPrompt(true);
  }

  async function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (isChecking) return;
    const anchor = event.currentTarget;
    setIsChecking(true);
    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      setIsChecking(false);
      showVisitorPrompt(anchor);
      return;
    }

    const { data } = await supabase.auth.getUser();
    if (data.user?.email_confirmed_at) {
      router.push(visitPath);
      return;
    }
    setIsChecking(false);
    showVisitorPrompt(anchor);
  }

  return (
    <>
      <a className={className} href={visitPath} aria-label={`Visit shop for ${productName}`} onClick={handleClick}>
        {children}
      </a>
      {showPrompt && portalTarget && createPortal(
        <div className={`visitor-prompt-overlay${promptBounds ? " visitor-prompt-overlay-anchored" : ""}`} style={promptBounds ?? undefined} role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setShowPrompt(false);
        }}>
          <section className="visitor-prompt-dialog" role="dialog" aria-modal={promptBounds ? undefined : true} aria-labelledby={`visitor-prompt-${slug}`} onKeyDown={(event) => {
            if (event.key === "Escape") setShowPrompt(false);
          }}>
            <button className="visitor-prompt-close" type="button" aria-label="Close" autoFocus onClick={() => setShowPrompt(false)}><X size={18} /></button>
            <p className="admin-eyebrow">RONTAB POINT</p>
            <h2 id={`visitor-prompt-${slug}`}>Earn 1 point?</h2>
            <p>Sign in to earn a point for this product, or continue as a guest.</p>
            <div className="visitor-prompt-actions">
              <Link className="visitor-prompt-account" href={accountUrl}>Sign in / Join <ArrowUpRight size={13} aria-hidden="true" /></Link>
              <Link className="visitor-prompt-guest" href={`${visitPath}?asGuest=1`}>Guest</Link>
            </div>
            {!promptBounds && <small>Guests do not earn points.</small>}
          </section>
        </div>,
        portalTarget,
      )}
    </>
  );
}