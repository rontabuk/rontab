"use client";

import { Pencil } from "lucide-react";

export function SellerProfileEditButton({ targetId }: { targetId: string }) {
  return (
    <button
      className="seller-profile-edit-button"
      type="button"
      onClick={() => {
        const editor = document.getElementById(targetId);
        if (!(editor instanceof HTMLDetailsElement)) return;

        editor.open = true;
        editor.querySelector("summary")?.focus();
        editor.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
    >
      <Pencil size={14} aria-hidden="true" />Edit
    </button>
  );
}