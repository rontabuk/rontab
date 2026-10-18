import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { CreatorInfluence } from "@/lib/creator/influence";

export async function getCreatorInfluence(supabase: SupabaseClient<Database>, creatorIds: string[]) {
  const ids = [...new Set(creatorIds)];
  const batches = Array.from({ length: Math.ceil(ids.length / 200) }, (_, index) => ids.slice(index * 200, (index + 1) * 200));
  const results = await Promise.all(batches.map((batch) => supabase.rpc("get_creator_influence", { p_creator_profile_ids: batch })));
  const influence = new Map<string, CreatorInfluence>();
  for (const result of results) {
    if (result.error?.code === "PGRST202") return influence;
    if (result.error) throw new Error(result.error.message);
    for (const row of result.data ?? []) influence.set(row.creator_profile_id, row);
  }
  return influence;
}