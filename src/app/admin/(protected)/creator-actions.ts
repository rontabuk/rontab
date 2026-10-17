"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/access";
import { FormError } from "@/lib/form-state";
import { isUuid } from "@/lib/validation";

export async function reviewCreatorProfile(formData: FormData) {
  const profileId = String(formData.get("creator_profile_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const reviewNote = String(formData.get("review_note") ?? "").trim();
  if (!isUuid(profileId) || !["approve", "changes_requested", "reject", "suspend", "reinstate"].includes(decision)) {
    throw new FormError("Invalid creator review request.");
  }
  if (reviewNote.length > 2000 || (["changes_requested", "reject", "suspend"].includes(decision) && !reviewNote)) {
    throw new FormError("Add a review note of 2,000 characters or fewer when requesting changes, rejecting, or suspending.");
  }

  const { supabase } = await requireAdmin();
  let previousMediaPaths: string[] = [];
  if (decision === "approve") {
    const { data: previousMedia, error: previousMediaError } = await supabase.from("creator_profiles")
      .select("published_profile_image_path,published_cover_image_path")
      .eq("id", profileId)
      .maybeSingle();
    if (previousMediaError) throw new Error(previousMediaError.message);
    previousMediaPaths = [previousMedia?.published_profile_image_path, previousMedia?.published_cover_image_path]
      .filter((path): path is string => Boolean(path));
  }

  const { error } = await supabase.rpc("admin_review_creator_profile", {
    p_creator_profile_id: profileId,
    p_decision: decision,
    p_review_note: reviewNote || null,
  });
  if (error?.code === "22023" || error?.code === "55000") throw new FormError(error.message);
  if (error) throw new Error(error.message);

  if (decision === "approve" && previousMediaPaths.length) {
    const { data: publishedMedia, error: publishedMediaError } = await supabase.from("creator_profiles")
      .select("published_profile_image_path,published_cover_image_path")
      .eq("id", profileId)
      .maybeSingle();
    if (publishedMediaError) throw new Error(publishedMediaError.message);
    const currentMediaPaths = new Set([publishedMedia?.published_profile_image_path, publishedMedia?.published_cover_image_path]);
    const obsoleteMediaPaths = previousMediaPaths.filter((path) => !currentMediaPaths.has(path));
    if (obsoleteMediaPaths.length) {
      const { error: cleanupError } = await supabase.storage.from("creator-profile-media").remove(obsoleteMediaPaths);
      if (cleanupError) console.error("Superseded creator media could not be deleted:", cleanupError.message);
    }
  }

  revalidatePath("/admin/creators");
  revalidatePath("/creators");
  revalidatePath("/visitor/creator");
  redirect("/admin/creators?reviewed=1");
}

export async function grantCreatorPoints(formData: FormData) {
  const profileId = String(formData.get("creator_profile_id") ?? "");
  const points = Number(formData.get("points"));
  const reason = String(formData.get("reason") ?? "").trim();
  const idempotencyKey = String(formData.get("idempotency_key") ?? "");
  if (!isUuid(profileId) || !isUuid(idempotencyKey) || !Number.isSafeInteger(points) || points < 1 || points > 100000
    || reason.length < 5 || reason.length > 500) {
    throw new FormError("Enter a points amount from 1 to 100,000 and a reason of at least five characters.");
  }

  const { supabase } = await requireAdmin();
  const { data: granted, error } = await supabase.rpc("admin_grant_creator_points", {
    p_creator_profile_id: profileId,
    p_points: points,
    p_reason: reason,
    p_idempotency_key: idempotencyKey,
  });
  if (error?.code === "22023" || error?.code === "55000") throw new FormError(error.message);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/creators");
  revalidatePath("/visitor/creator");
  redirect(granted ? "/admin/creators?granted=1" : "/admin/creators?duplicate=1");
}