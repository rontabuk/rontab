create function public.seller_get_offer_audience_estimates()
returns table (
	request_id uuid,
	city_id text,
	city_name text,
	country_code text,
	registered_audience bigint,
	is_withheld boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	seller_id uuid;
begin
	select profile.id into seller_id
	from public.seller_profiles profile
	where profile.user_id = (select auth.uid()) and profile.status = 'active';
	if seller_id is null then
		raise exception 'An active seller account is required.' using errcode = '42501';
	end if;
	return query
	with target_cities as (
		select request.id as request_id, location.city_id
		from public.seller_offer_requests request
		join public.seller_offer_request_locations location on location.request_id = request.id
		where request.seller_profile_id = seller_id
		union
		select offer.request_id, location.city_id
		from public.seller_offers offer
		join public.seller_offer_locations location on location.offer_id = offer.id
		where offer.seller_profile_id = seller_id
	)
	select target.request_id, target.city_id, city.city_name, city.country_code,
		case when count(profile.id) filter (where public.is_supported_loyalty_visitor(profile.id)) >= 5
			then count(profile.id) filter (where public.is_supported_loyalty_visitor(profile.id))
			else null end::bigint,
		(count(profile.id) filter (where public.is_supported_loyalty_visitor(profile.id))) < 5
	from target_cities target
	join public.supported_cities city on city.city_id = target.city_id
	left join public.profiles profile on profile.city_id = target.city_id
	group by target.request_id, target.city_id, city.city_name, city.country_code
	order by city.city_name;
end;
$$;

revoke all on function public.seller_get_offer_audience_estimates() from public, anon;
grant execute on function public.seller_get_offer_audience_estimates() to authenticated;