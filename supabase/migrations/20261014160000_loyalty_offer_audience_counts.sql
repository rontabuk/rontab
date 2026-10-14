drop function if exists public.admin_get_loyalty_offer_audience_counts(integer, integer);

create function public.admin_get_loyalty_offer_audience_counts(
	p_minimum_points integer,
	p_points_cost integer
)
returns table (
	country_code text,
	city_id text,
	eligible_visitor_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not (select public.is_admin()) then
		raise exception 'Administrator access is required.' using errcode = '42501';
	end if;
	if p_minimum_points is null or p_minimum_points not between 0 and 1000000
		or p_points_cost is null or p_points_cost not between 1 and 1000000 then
		raise exception 'Offer point thresholds are invalid.' using errcode = '22023';
	end if;

	return query
	with locations as (
		select country.country_code, null::text as city_id
		from public.supported_countries country
		where country.is_enabled
		union all
		select city.country_code, city.city_id
		from public.supported_cities city
		join public.supported_countries country
			on country.country_code = city.country_code and country.is_enabled
		where city.is_enabled
	),
	visitors as (
		select profile.id, profile.country_code, profile.city_id,
			account.email_confirmed_at, profile.email_verified_at,
			account.raw_app_meta_data ->> 'role' as account_role,
			seller.user_id as seller_user_id,
			coalesce(loyalty.points_balance, 0) as points_balance
		from public.profiles profile
		join auth.users account on account.id = profile.id
		join public.supported_countries country
			on country.country_code = profile.country_code and country.is_enabled
		left join public.seller_profiles seller on seller.user_id = profile.id
		left join public.loyalty_accounts loyalty on loyalty.visitor_id = profile.id
	),
	counts as (
		select visitor.country_code, null::text as city_id,
			count(*) filter (
				where visitor.email_confirmed_at is not null
					and visitor.email_verified_at is not null
					and not coalesce(visitor.account_role = 'admin', false)
					and visitor.seller_user_id is null
					and visitor.points_balance >= greatest(p_minimum_points, p_points_cost)
			)::bigint as eligible_visitor_count
		from visitors visitor
		group by visitor.country_code
		union all
		select visitor.country_code, visitor.city_id,
			count(*) filter (
				where visitor.city_id is not null
					and visitor.email_confirmed_at is not null
					and visitor.email_verified_at is not null
					and not coalesce(visitor.account_role = 'admin', false)
					and visitor.seller_user_id is null
					and visitor.points_balance >= greatest(p_minimum_points, p_points_cost)
			)::bigint
		from visitors visitor
		where visitor.city_id is not null
		group by visitor.country_code, visitor.city_id
	)
	select location.country_code, location.city_id,
		coalesce(counts.eligible_visitor_count, 0)::bigint
	from locations location
	left join counts
		on counts.country_code = location.country_code
		and counts.city_id is not distinct from location.city_id
	order by location.country_code, location.city_id nulls first;
end;
$$;

revoke all on function public.admin_get_loyalty_offer_audience_counts(integer, integer) from public, anon;
grant execute on function public.admin_get_loyalty_offer_audience_counts(integer, integer) to authenticated;