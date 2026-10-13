import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Every admin page and action must call this: layouts do not guard the segments they wrap.
export const requireAdmin = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user || data.user.app_metadata?.role !== "admin") redirect("/admin/login");

  return { supabase, admin: { id: data.user.id, email: data.user.email ?? "" } };
});
