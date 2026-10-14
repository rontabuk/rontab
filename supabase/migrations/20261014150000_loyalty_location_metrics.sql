create or replace function public.admin_get_loyalty_location_metrics()
returns table (
	country_code text,
	country_name text,
	city_id text,
	city_name text,
	admin_name text,
	registered_visitor_count bigint,
	verified_visitor_count bigint,
	eligible_point_holder_count bigint,
	active_seller_count bigint,
	approved_product_count bigint,
	active_loyalty_offer_count bigint,
	active_seller_offer_count bigint,
	claims_last_30_days bigint
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

	return query
	with locations as (
		select country.country_code, country.country_name, null::text as city_id,
			null::text as city_name, null::text as admin_name
		from public.supported_countries country
		where country.is_enabled
		union all
		select city.country_code, country.country_name, city.city_id,
			city.city_name, city.admin_name
		from public.supported_cities city
		join public.supported_countries country
			on country.country_code = city.country_code and country.is_enabled
		where city.is_enabled
	),
	visitor_metrics as (
		select country.country_code, null::text as city_id,
			count(profile.id) filter (
				where not coalesce(account.raw_app_meta_data ->> 'role' = 'admin', false)
					and seller.user_id is null
			)::bigint as registered_visitor_count,
			count(profile.id) filter (
				where account.email_confirmed_at is not null
					and profile.email_verified_at is not null
					and not coalesce(account.raw_app_meta_data ->> 'role' = 'admin', false)
					and seller.user_id is null
			)::bigint as verified_visitor_count,
			count(profile.id) filter (
				where loyalty.points_balance > 0
					and account.email_confirmed_at is not null
					and profile.email_verified_at is not null
					and not coalesce(account.raw_app_meta_data ->> 'role' = 'admin', false)
					and seller.user_id is null
			)::bigint as eligible_point_holder_count
		from public.supported_countries country
		left join public.profiles profile on profile.country_code = country.country_code
		left join auth.users account on account.id = profile.id
		left join public.seller_profiles seller on seller.user_id = profile.id
		left join public.loyalty_accounts loyalty on loyalty.visitor_id = profile.id
		where country.is_enabled
		group by country.country_code
		union all
		select city.country_code, city.city_id,
			count(profile.id) filter (
				where not coalesce(account.raw_app_meta_data ->> 'role' = 'admin', false)
					and seller.user_id is null
			)::bigint,
			count(profile.id) filter (
				where account.email_confirmed_at is not null
					and profile.email_verified_at is not null
					and not coalesce(account.raw_app_meta_data ->> 'role' = 'admin', false)
					and seller.user_id is null
			)::bigint,
			count(profile.id) filter (
				where loyalty.points_balance > 0
					and account.email_confirmed_at is not null
					and profile.email_verified_at is not null
					and not coalesce(account.raw_app_meta_data ->> 'role' = 'admin', false)
					and seller.user_id is null
			)::bigint
		from public.supported_cities city
		join public.supported_countries country
			on country.country_code = city.country_code and country.is_enabled
		left join public.profiles profile on profile.city_id = city.city_id
		left join auth.users account on account.id = profile.id
		left join public.seller_profiles seller on seller.user_id = profile.id
		left join public.loyalty_accounts loyalty on loyalty.visitor_id = profile.id
		where city.is_enabled
		group by city.country_code, city.city_id
	),
	city_supply as (
		select city.country_code, city.city_id,
			count(distinct seller.id) filter (where seller.id is not null)::bigint as active_seller_count,
			count(distinct product.id) filter (where product.id is not null)::bigint as approved_product_count
		from public.supported_cities city
		join public.supported_countries country
			on country.country_code = city.country_code and country.is_enabled
		left join public.seller_profiles seller
			on seller.shop_city_id = city.city_id and seller.status = 'active' and seller.is_public
		left join public.products product
			on product.seller_profile_id = seller.id and product.status = 'approved'
		where city.is_enabled
		group by city.country_code, city.city_id
	),
	supply_metrics as (
		select country.country_code, null::text as city_id,
			coalesce(sum(supply.active_seller_count), 0)::bigint as active_seller_count,
			coalesce(sum(supply.approved_product_count), 0)::bigint as approved_product_count
		from public.supported_countries country
		left join city_supply supply on supply.country_code = country.country_code
		where country.is_enabled
		group by country.country_code
		union all
		select supply.country_code, supply.city_id,
			supply.active_seller_count, supply.approved_product_count
		from city_supply supply
	),
	loyalty_offer_metrics as (
		select country.country_code, null::text as city_id,
			count(distinct offer.id)::bigint as active_loyalty_offer_count
		from public.supported_countries country
		left join public.loyalty_offers offer
			on offer.status = 'published' and offer.starts_at <= now() and offer.ends_at > now()
			and (
				not exists (select 1 from public.loyalty_offer_city_quotas quota where quota.offer_id = offer.id)
				or exists (
					select 1 from public.loyalty_offer_city_quotas quota
					join public.supported_cities city on city.city_id = quota.city_id
					where quota.offer_id = offer.id and city.country_code = country.country_code
				)
			)
		where country.is_enabled
		group by country.country_code
		union all
		select city.country_code, city.city_id,
			count(distinct offer.id)::bigint
		from public.supported_cities city
		join public.supported_countries country
			on country.country_code = city.country_code and country.is_enabled
		left join public.loyalty_offers offer
			on offer.status = 'published' and offer.starts_at <= now() and offer.ends_at > now()
			and (
				not exists (select 1 from public.loyalty_offer_city_quotas quota where quota.offer_id = offer.id)
				or exists (
					select 1 from public.loyalty_offer_city_quotas quota
					where quota.offer_id = offer.id and quota.city_id = city.city_id
				)
			)
		where city.is_enabled
		group by city.country_code, city.city_id
	),
	seller_offer_metrics as (
		select city.country_code, city.city_id,
			count(distinct offer.id)::bigint as active_seller_offer_count
		from public.supported_cities city
		join public.supported_countries country
			on country.country_code = city.country_code and country.is_enabled
		left join public.seller_offer_locations location on location.city_id = city.city_id
		left join public.seller_offers offer
			on offer.id = location.offer_id and offer.status = 'published'
			and offer.valid_from <= timezone('Europe/London', now())::date
			and offer.valid_until >= timezone('Europe/London', now())::date
		where city.is_enabled
		group by city.country_code, city.city_id
		union all
		select country.country_code, null::text as city_id,
			count(distinct offer.id)::bigint
		from public.supported_countries country
		left join public.supported_cities city
			on city.country_code = country.country_code and city.is_enabled
		left join public.seller_offer_locations location on location.city_id = city.city_id
		left join public.seller_offers offer
			on offer.id = location.offer_id and offer.status = 'published'
			and offer.valid_from <= timezone('Europe/London', now())::date
			and offer.valid_until >= timezone('Europe/London', now())::date
		where country.is_enabled
		group by country.country_code
	),
	claim_metrics as (
		select country.country_code, null::text as city_id,
			count(claim.id) filter (where claim.created_at >= now() - interval '30 days')::bigint as claims_last_30_days
		from public.supported_countries country
		left join public.loyalty_offer_claims claim on claim.country_code = country.country_code
		where country.is_enabled
		group by country.country_code
		union all
		select city.country_code, city.city_id,
			count(claim.id) filter (where claim.created_at >= now() - interval '30 days')::bigint
		from public.supported_cities city
		join public.supported_countries country
			on country.country_code = city.country_code and country.is_enabled
		left join public.loyalty_offer_claims claim on claim.city_id = city.city_id
		where city.is_enabled
		group by city.country_code, city.city_id
	),
	metrics as (
		select location.country_code, location.country_name, location.city_id,
			location.city_name, location.admin_name,
			coalesce(visitor.registered_visitor_count, 0)::bigint as registered_visitor_count,
			coalesce(visitor.verified_visitor_count, 0)::bigint as verified_visitor_count,
			coalesce(visitor.eligible_point_holder_count, 0)::bigint as eligible_point_holder_count,
			coalesce(supply.active_seller_count, 0)::bigint as active_seller_count,
			coalesce(supply.approved_product_count, 0)::bigint as approved_product_count,
			coalesce(reward.active_loyalty_offer_count, 0)::bigint as active_loyalty_offer_count,
			coalesce(seller_offer.active_seller_offer_count, 0)::bigint as active_seller_offer_count,
			coalesce(claim.claims_last_30_days, 0)::bigint as claims_last_30_days
		from locations location
		left join visitor_metrics visitor using (country_code, city_id)
		left join supply_metrics supply using (country_code, city_id)
		left join loyalty_offer_metrics reward using (country_code, city_id)
		left join seller_offer_metrics seller_offer using (country_code, city_id)
		left join claim_metrics claim using (country_code, city_id)
	)
	select metrics.country_code, metrics.country_name, metrics.city_id,
		metrics.city_name, metrics.admin_name, metrics.registered_visitor_count,
		metrics.verified_visitor_count, metrics.eligible_point_holder_count,
		metrics.active_seller_count, metrics.approved_product_count,
		metrics.active_loyalty_offer_count, metrics.active_seller_offer_count,
		metrics.claims_last_30_days
	from metrics
	where metrics.city_id is null
		or metrics.registered_visitor_count > 0
		or metrics.verified_visitor_count > 0
		or metrics.eligible_point_holder_count > 0
		or metrics.active_seller_count > 0
		or metrics.approved_product_count > 0
		or metrics.active_loyalty_offer_count > 0
		or metrics.active_seller_offer_count > 0
		or metrics.claims_last_30_days > 0
	order by metrics.country_name, metrics.city_id is not null, metrics.verified_visitor_count desc, metrics.city_name;
end;
$$;

revoke all on function public.admin_get_loyalty_location_metrics() from public, anon;
grant execute on function public.admin_get_loyalty_location_metrics() to authenticated;