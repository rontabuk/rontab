create function public.admin_get_seller_voucher_location_metrics()
returns table (
	country_code text,
	city_id text,
	vouchers_issued_last_30_days bigint,
	vouchers_redeemed_last_30_days bigint
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
	city_metrics as (
		select city.country_code, city.city_id,
			count(coupon.id) filter (
				where coupon.created_at >= now() - interval '30 days'
			)::bigint as vouchers_issued_last_30_days,
			count(coupon.id) filter (
				where coupon.status = 'redeemed'
					and coupon.redeemed_at >= now() - interval '30 days'
			)::bigint as vouchers_redeemed_last_30_days
		from public.supported_cities city
		join public.supported_countries country
			on country.country_code = city.country_code and country.is_enabled
		left join public.seller_offer_locations location on location.city_id = city.city_id
		left join public.seller_offer_coupons coupon on coupon.location_id = location.id
		where city.is_enabled
		group by city.country_code, city.city_id
	),
country_metrics as (
		select country.country_code, null::text as city_id,
			coalesce(sum(city_metrics.vouchers_issued_last_30_days), 0)::bigint as vouchers_issued_last_30_days,
			coalesce(sum(city_metrics.vouchers_redeemed_last_30_days), 0)::bigint as vouchers_redeemed_last_30_days
		from public.supported_countries country
		left join city_metrics on city_metrics.country_code = country.country_code
		where country.is_enabled
		group by country.country_code
	),
metrics as (
		select * from country_metrics
		union all
		select * from city_metrics
	)
	select location.country_code, location.city_id,
		coalesce(metrics.vouchers_issued_last_30_days, 0)::bigint,
		coalesce(metrics.vouchers_redeemed_last_30_days, 0)::bigint
	from locations location
	left join metrics
		on metrics.country_code = location.country_code
		and metrics.city_id is not distinct from location.city_id
	where location.city_id is null
		or coalesce(metrics.vouchers_issued_last_30_days, 0) > 0
		or coalesce(metrics.vouchers_redeemed_last_30_days, 0) > 0
	order by location.country_code, location.city_id nulls first;
end;
$$;

revoke all on function public.admin_get_seller_voucher_location_metrics() from public, anon;
grant execute on function public.admin_get_seller_voucher_location_metrics() to authenticated;