"use client";

import { useActionState } from "react";
import { Check } from "lucide-react";
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
      <input type="hidden" name="follow_action" value="follow" />
      {state.following ? (
        <span className="shop-follow-control-status" role="status"><span className="shop-follow-confirmation-icon"><Check size={12} aria-hidden="true" /></span>Following</span>
      ) : (
        <button type="submit" disabled={isPending}>
          <span aria-hidden="true">+</span>{isPending ? "Saving…" : "Follow"}
        </button>
      )}
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  );
}
