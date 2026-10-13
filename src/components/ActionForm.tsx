"use client";

import { startTransition, useActionState, type ReactNode } from "react";
import type { FormState } from "@/lib/form-state";

export function ActionForm({
  action,
  className,
  children,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  className?: string;
  children: ReactNode;
}) {
  const [state, formAction, isPending] = useActionState(action, { error: null });

  return (
    <form
      className={className}
      aria-busy={isPending}
      onSubmit={(event) => {
        // Submitting manually keeps the entered values when the server returns an error.
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => formAction(formData));
      }}
    >
      {children}
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
    </form>
  );
}
