revoke select on public.creator_profile_reviews, public.creator_point_accounts, public.creator_point_transactions from authenticated;

grant select (creator_profile_id, review_note, created_at)
	on public.creator_profile_reviews to authenticated;
grant select (creator_profile_id, points_balance)
	on public.creator_point_accounts to authenticated;
grant select (id, creator_profile_id, points_delta, reason, created_at)
	on public.creator_point_transactions to authenticated;
