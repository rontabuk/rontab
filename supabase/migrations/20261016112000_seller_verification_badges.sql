alter table public.seller_profiles
	add column verification_badge_mode text not null default 'automatic'
		check (verification_badge_mode in ('automatic', 'granted', 'hidden'));

create function public.get_public_seller_verification_badges(p_seller_profile_ids uuid[])
returns table (seller_profile_id uuid, is_verified boolean, is_blue boolean)
language sql
stable
security definer
set search_path = ''
as $$
	select
		seller.id,
		seller.verification_badge_mode <> 'hidden',
		seller.verification_badge_mode = 'granted'
			or (seller.verification_badge_mode = 'automatic' and count(follow.visitor_id) >= 1000)
	from public.seller_profiles seller
	left join public.seller_shop_follows follow on follow.seller_profile_id = seller.id
	where seller.id = any(p_seller_profile_ids)
		and seller.status = 'active'
		and seller.is_public
	group by seller.id, seller.verification_badge_mode;
$$;

create function public.admin_get_seller_verification_badges(p_seller_profile_ids uuid[])
returns table (seller_profile_id uuid, follower_count bigint, badge_mode text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not (select public.is_admin()) then
		raise exception 'Administrator access is required.' using errcode = '42501';
	end if;

	return query
	select seller.id, count(follow.visitor_id), seller.verification_badge_mode
	from public.seller_profiles seller
	left join public.seller_shop_follows follow on follow.seller_profile_id = seller.id
	where seller.id = any(p_seller_profile_ids)
	group by seller.id, seller.verification_badge_mode;
end;
$$;

create function public.admin_set_seller_verification_badge(p_seller_profile_id uuid, p_badge_mode text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not (select public.is_admin()) then
		raise exception 'Administrator access is required.' using errcode = '42501';
	end if;
	if p_seller_profile_id is null or p_badge_mode is null or p_badge_mode not in ('automatic', 'granted', 'hidden') then
		raise exception 'Choose automatic, granted, or hidden badge mode.' using errcode = '22023';
	end if;

	update public.seller_profiles
	set verification_badge_mode = p_badge_mode
	where id = p_seller_profile_id;
	if not found then
		raise exception 'Seller not found.' using errcode = 'P0002';
	end if;

	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values (
		(select auth.uid()),
		'seller_verification_badge_changed',
		'seller_profile',
		p_seller_profile_id,
		jsonb_build_object('badge_mode', p_badge_mode)
	);
end;
$$;

revoke all on function public.get_public_seller_verification_badges(uuid[]) from public;
revoke all on function public.admin_get_seller_verification_badges(uuid[]) from public, anon;
revoke all on function public.admin_set_seller_verification_badge(uuid, text) from public, anon;
grant execute on function public.get_public_seller_verification_badges(uuid[]) to anon, authenticated;
grant execute on function public.admin_get_seller_verification_badges(uuid[]) to authenticated;
grant execute on function public.admin_set_seller_verification_badge(uuid, text) to authenticated;