create or replace function public.normalize_and_lock_profile_city()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	selected_city public.supported_cities%rowtype;
begin
	if new.city_id is null then
		if tg_op = 'UPDATE' and not (select public.is_admin())
			and (new.city is distinct from old.city or new.country_code is distinct from old.country_code) then
			raise exception 'Select a supported United Kingdom city from the location list.' using errcode = '22023';
		end if;
		new.city := null;
		new.country_code := null;
	else
		select * into selected_city
		from public.supported_cities city
		join public.supported_countries country on country.country_code = city.country_code
		where city.city_id = new.city_id and country.is_enabled;
		if not found then
			raise exception 'Select a currently supported city.' using errcode = '22023';
		end if;

		if tg_op = 'UPDATE' and old.city_id is not null and not (select public.is_admin())
			and new.city_id is distinct from old.city_id
			and exists (
				select 1
				from public.loyalty_offer_city_quotas quota
				join public.loyalty_offers offer on offer.id = quota.offer_id
				where offer.status = 'published'
					and offer.starts_at <= now()
					and offer.ends_at > now()
					and quota.city_id in (old.city_id, new.city_id)
			) then
			raise exception 'Your city cannot be changed while an offer for that city is active.' using errcode = '55000';
		end if;

		new.city := selected_city.city_name;
		new.country_code := selected_city.country_code;
	end if;
	return new;
end;
$$;