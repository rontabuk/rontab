import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/database.types";

export type SupabaseBrowserClient = ReturnType<typeof createBrowserClient<Database>>;

export function createSupabaseBrowserClient(): SupabaseBrowserClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) return null;

  return createBrowserClient<Database>(supabaseUrl, supabaseKey);
}
