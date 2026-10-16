"use client";

import { useActionState } from "react";
import { Heart, HeartOff } from "lucide-react";
import { toggleShopFollow } from "@/app/visitor/shop-follow-actions";

type ShopFollowState = { error: string | null; following: boolean };

export function ShopFollowButton({
  sellerProfileId,
  shopSlug,
  initialFollowing = false,
}: {
  sellerProfileId: string;
  shopSlug: string;
  initialFollowing?: boolean;
}) {
  const [state, formAction, isPending] = useActionState<ShopFollowState, FormData>(toggleShopFollow, {
    error: null,
    following: initialFollowing,
  });

  return (
    <form className="shop-follow-control" action={formAction} aria-busy={isPending}>
      <input type="hidden" name="seller_profile_id" value={sellerProfileId} />
      <input type="hidden" name="shop_slug" value={shopSlug} />
      <input type="hidden" name="follow_action" value={state.following ? "unfollow" : "follow"} />
      <button type="submit" aria-pressed={state.following} disabled={isPending}>
        {state.following ? <HeartOff size={15} aria-hidden="true" /> : <Heart size={15} aria-hidden="true" />}
        {isPending ? "Saving…" : state.following ? "Unfollow shop" : "Follow shop"}
      </button>
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  );
}
