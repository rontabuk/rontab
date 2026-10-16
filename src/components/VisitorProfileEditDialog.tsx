"use client";

import { useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function VisitorProfileEditDialog({ children }: { children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button className="visitor-account-edit-button" type="button" aria-haspopup="dialog" onClick={() => dialogRef.current?.showModal()}>
        Edit profile
      </button>
      <dialog
        className="visitor-profile-edit-dialog"
        ref={dialogRef}
        aria-labelledby="visitor-profile-edit-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) dialogRef.current?.close();
        }}
      >
        <div className="visitor-profile-edit-dialog-panel">
          <header>
            <h2 id="visitor-profile-edit-title">Edit profile</h2>
            <button className="visitor-profile-edit-close" type="button" aria-label="Close edit profile" onClick={() => dialogRef.current?.close()}>
              <X size={19} aria-hidden="true" />
            </button>
          </header>
          {children}
        </div>
      </dialog>
    </>
  );
}
