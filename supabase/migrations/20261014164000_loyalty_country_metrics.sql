create function public.admin_get_loyalty_country_metrics()
returns table (
	country_code text,
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
	with visitor_metrics as (
		select coalesce(city.country_code, profile.country_code) as country_code,
			count(profile.id) filter (
				where not coalesce(account.raw_app_meta_data ->> 'role' = 'admin', false)
					and seller.user_id is null
			)::bigint as registered_visitor_count,
			count(profile.id) filter (
				where account.email_confirmed_at is not null and profile.email_verified_at is not null
					and not coalesce(account.raw_app_meta_data ->> 'role' = 'admin', false)
					and seller.user_id is null
			)::bigint as verified_visitor_count,
			count(profile.id) filter (
				where loyalty.points_balance > 0 and account.email_confirmed_at is not null
					and profile.email_verified_at is not null
					and not coalesce(account.raw_app_meta_data ->> 'role' = 'admin', false)
					and seller.user_id is null
			)::bigint as eligible_point_holder_count
		from public.profiles profile
		left join public.supported_cities city on city.city_id = profile.city_id
		left join auth.users account on account.id = profile.id
		left join public.seller_profiles seller on seller.user_id = profile.id
		left join public.loyalty_accounts loyalty on loyalty.visitor_id = profile.id
		group by coalesce(city.country_code, profile.country_code)
	),
	supply_metrics as (
		select city.country_code,
			count(distinct seller.id)::bigint as active_seller_count,
			count(distinct product.id)::bigint as approved_product_count
		from public.supported_countries country
		left join public.supported_cities city
			on city.country_code = country.country_code and city.is_enabled
		left join public.seller_profiles seller
			on seller.shop_city_id = city.city_id and seller.status = 'active' and seller.is_public
		left join public.products product
			on product.seller_profile_id = seller.id and product.status = 'approved'
		where country.is_enabled
		group by city.country_code
	),
	loyalty_metrics as (
		select country.country_code, count(distinct offer.id)::bigint as active_loyalty_offer_count
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
	),
	seller_offer_metrics as (
		select country.country_code, count(distinct offer.id)::bigint as active_seller_offer_count
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
		select coalesce(city.country_code, claim.country_code) as country_code,
			count(claim.id) filter (where claim.created_at >= now() - interval '30 days')::bigint as claims_last_30_days
		from public.loyalty_offer_claims claim
		left join public.supported_cities city on city.city_id = claim.city_id
		group by coalesce(city.country_code, claim.country_code)
	)
	select country.country_code,
		coalesce(visitor.registered_visitor_count, 0)::bigint,
		coalesce(visitor.verified_visitor_count, 0)::bigint,
		coalesce(visitor.eligible_point_holder_count, 0)::bigint,
		coalesce(supply.active_seller_count, 0)::bigint,
		coalesce(supply.approved_product_count, 0)::bigint,
		coalesce(loyalty.active_loyalty_offer_count, 0)::bigint,
		coalesce(seller_offer.active_seller_offer_count, 0)::bigint,
		coalesce(claim.claims_last_30_days, 0)::bigint
	from public.supported_countries country
	left join visitor_metrics visitor on visitor.country_code = country.country_code
	left join supply_metrics supply on supply.country_code = country.country_code
	left join loyalty_metrics loyalty on loyalty.country_code = country.country_code
	left join seller_offer_metrics seller_offer on seller_offer.country_code = country.country_code
	left join claim_metrics claim on claim.country_code = country.country_code
	where country.is_enabled
	order by country.country_name;
end;
$$;

revoke all on function public.admin_get_loyalty_country_metrics() from public, anon;
grant execute on function public.admin_get_loyalty_country_metrics() to authenticated;