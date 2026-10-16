create function public.get_public_seller_follower_count(p_seller_profile_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
	select count(follow.visitor_id)
	from public.seller_profiles seller
	left join public.seller_shop_follows follow on follow.seller_profile_id = seller.id
	where seller.id = p_seller_profile_id
		and seller.status = 'active'
		and seller.is_public;
$$;

revoke all on function public.get_public_seller_follower_count(uuid) from public;
grant execute on function public.get_public_seller_follower_count(uuid) to anon, authenticated;