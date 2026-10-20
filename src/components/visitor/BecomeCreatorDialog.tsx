"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { Sparkles, X } from "lucide-react";
import { CREATOR_MIN_TOTAL_FOLLOWERS } from "@/lib/creator/catalog";

const minimumFollowers = CREATOR_MIN_TOTAL_FOLLOWERS.toLocaleString("en-GB");

export function BecomeCreatorDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const shouldOpen = searchParams.get("becomeCreator") === "1";

  useEffect(() => {
    if (!shouldOpen) return;
    if (dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
    const params = new URLSearchParams(searchParams.toString());
    params.delete("becomeCreator");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [shouldOpen, searchParams, pathname, router]);

  return (
    <>
      <button className="become-creator-button" type="button" aria-haspopup="dialog" onClick={() => dialogRef.current?.showModal()}>
        <Sparkles size={15} aria-hidden="true" />
        Become a creator
      </button>
      <dialog
        className="become-creator-dialog"
        ref={dialogRef}
        aria-labelledby="become-creator-title"
        aria-describedby="become-creator-description"
        onClick={(event) => {
          if (event.target === event.currentTarget) dialogRef.current?.close();
        }}
      >
        <div className="become-creator-panel">
          <header>
            <h2 id="become-creator-title">Become a Rontab creator</h2>
            <button className="become-creator-close" type="button" aria-label="Close" onClick={() => dialogRef.current?.close()}>
              <X size={19} aria-hidden="true" />
            </button>
          </header>
          <div id="become-creator-description">
            <p className="become-creator-requirement">
              You can&apos;t apply as a content creator with fewer than <strong>{minimumFollowers} followers</strong> across your social media platforms.
            </p>
            <p>
              Choosing &ldquo;Not ready yet&rdquo; does not reduce your chances of becoming a creator later. Please make sure you meet the requirement before you continue.
            </p>
            <p className="become-creator-note">
              A creator account is a separate account with its own email, sign-in, profile, and influence balance. Your visitor account and points stay as they are.
            </p>
          </div>
          <div className="become-creator-actions">
            <Link className="become-creator-confirm" href="/creator/register">Yes, I have</Link>
            <button className="become-creator-cancel" type="button" onClick={() => dialogRef.current?.close()}>No, not ready yet</button>
          </div>
        </div>
      </dialog>
    </>
  );
}
