create function public.seller_get_location_registration_counts()
returns table (
	country_code text,
	city_id text,
	registered_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	active_seller_id uuid;
begin
	select seller.id into active_seller_id
	from public.seller_profiles seller
	where seller.user_id = (select auth.uid()) and seller.status = 'active';
	if active_seller_id is null then
		raise exception 'An active seller account is required.' using errcode = '42501';
	end if;

	return query
	select country.country_code, null::text, count(profile.id)::bigint
	from public.supported_countries country
	left join public.profiles profile on profile.country_code = country.country_code
	where country.is_enabled
	group by country.country_code
	union all
	select city.country_code, city.city_id, count(profile.id)::bigint
	from public.supported_cities city
	join public.supported_countries country on country.country_code = city.country_code and country.is_enabled
	left join public.profiles profile on profile.city_id = city.city_id
	where city.is_enabled
	group by city.country_code, city.city_id;
end;
$$;

revoke all on function public.seller_get_location_registration_counts() from public, anon;
grant execute on function public.seller_get_location_registration_counts() to authenticated;