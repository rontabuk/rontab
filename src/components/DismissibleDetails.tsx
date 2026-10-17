"use client";

import { useEffect, useRef, type ReactNode } from "react";

// Native <details> stays open until its summary is clicked again; close it like a regular menu.
export function DismissibleDetails({ className, children, onToggle }: { className: string; children: ReactNode; onToggle?: (open: boolean) => void }) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const details = ref.current;
    if (!details) return;

    const close = () => details.removeAttribute("open");
    const onPointerDown = (event: PointerEvent) => {
      if (details.open && !details.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && details.open) {
        close();
        details.querySelector("summary")?.focus();
      }
    };
    const onClick = (event: MouseEvent) => {
      if ((event.target as Element).closest("a")) close();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    details.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      details.removeEventListener("click", onClick);
    };
  }, []);

  return <details ref={ref} className={className} onToggle={(event) => onToggle?.(event.currentTarget.open)}>{children}</details>;
}
