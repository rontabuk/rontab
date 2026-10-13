import "server-only";

import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/supabase/database.types";

const statelessAuth = { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false };

function getPublicSupabaseConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase environment variables are not configured.");
  }

  return { supabaseUrl, supabaseKey };
}

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const { supabaseUrl, supabaseKey } = getPublicSupabaseConfig();

  return createServerClient<Database>(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies; Proxy refreshes the session.
        }
      },
    },
  });
}

// Anonymous reads that only ever see what RLS exposes to the public.
export function createSupabasePublicClient() {
  const { supabaseUrl, supabaseKey } = getPublicSupabaseConfig();
  return createClient<Database>(supabaseUrl, supabaseKey, { auth: statelessAuth });
}

export function createSupabaseServiceRoleClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase service-role credentials are not configured on the server.");
  }

  return createClient<Database>(supabaseUrl, serviceRoleKey, { auth: statelessAuth });
}