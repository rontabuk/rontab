create or replace function public.admin_get_loyalty_offer_city_metrics()
returns table (
	offer_id uuid,
	city text,
	country_code text,
	capacity integer,
	eligible_count bigint,
	claim_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
	with offer_locations as (
		select offer.id as current_offer_id, quota.city as current_city,
			quota.country_code as current_country_code, quota.capacity as current_capacity
		from public.loyalty_offers offer
		join public.loyalty_offer_city_quotas quota on quota.offer_id = offer.id
		union all
		select offer.id, null::text, null::text, offer.capacity
		from public.loyalty_offers offer
		where not exists (
			select 1 from public.loyalty_offer_city_quotas quota where quota.offer_id = offer.id
		)
	)
	select
		offer_locations.current_offer_id,
		offer_locations.current_city,
		offer_locations.current_country_code,
		offer_locations.current_capacity,
		(
			select count(*)
			from public.loyalty_accounts account
			join public.profiles profile on profile.id = account.visitor_id
			join auth.users account_user on account_user.id = account.visitor_id
			join public.loyalty_offers offer on offer.id = offer_locations.current_offer_id
			where account.points_balance >= greatest(offer.minimum_points, offer.points_cost)
				and account_user.email_confirmed_at is not null
				and not coalesce((account_user.raw_app_meta_data ->> 'role') = 'admin', false)
				and not exists (select 1 from public.seller_profiles seller where seller.user_id = account.visitor_id)
				and not exists (
					select 1 from public.loyalty_offer_claims claim
					where claim.offer_id = offer.id and claim.visitor_id = account.visitor_id
				)
				and (
					offer_locations.current_city is null
					or (
						lower(btrim(profile.city)) = lower(btrim(offer_locations.current_city))
						and profile.country_code = offer_locations.current_country_code
					)
				)
		)::bigint,
		(
			select count(*)
			from public.loyalty_offer_claims claim
			where claim.offer_id = offer_locations.current_offer_id
				and (
					offer_locations.current_city is null
					or (
						lower(btrim(claim.city)) = lower(btrim(offer_locations.current_city))
						and claim.country_code = offer_locations.current_country_code
					)
				)
		)::bigint
	from offer_locations
	where (select public.is_admin())
	order by offer_locations.current_offer_id, lower(offer_locations.current_city);
$$;

revoke all on function public.admin_get_loyalty_offer_city_metrics() from public, anon;
grant execute on function public.admin_get_loyalty_offer_city_metrics() to authenticated;