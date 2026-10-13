import "server-only";

import { unstable_rethrow } from "next/navigation";

export type FormState = { error: string | null };

// Messages written for the person filling in the form; anything else stays server-side.
export class FormError extends Error {}

export async function runFormAction(action: () => Promise<void>): Promise<FormState> {
  try {
    await action();
    return { error: null };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof FormError) return { error: error.message };
    console.error("Form action failed:", error instanceof Error ? error.message : error);
    return { error: "We could not save your changes. Please try again." };
  }
}
