create or replace function public.is_supported_loyalty_visitor(p_visitor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		from auth.users account_user
		join public.profiles profile on profile.id = account_user.id
		join public.supported_countries country on country.country_code = profile.country_code
		where account_user.id = p_visitor_id
			and account_user.email_confirmed_at is not null
			and country.is_enabled
			and not coalesce((account_user.raw_app_meta_data ->> 'role') = 'admin', false)
	)
	and not exists (
		select 1 from public.seller_profiles seller where seller.user_id = p_visitor_id
	);
$$;

revoke all on function public.is_supported_loyalty_visitor(uuid) from public, anon, authenticated;

create or replace function public.is_eligible_visitor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select public.is_supported_loyalty_visitor((select auth.uid()));
$$;

create or replace function public.record_visitor_loyalty_point()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	new_transaction_id bigint;
	product_name text;
begin
	if not public.is_supported_loyalty_visitor(new.visitor_id) then
		return new;
	end if;
	select product.name into product_name
	from public.products product
	where product.id = new.product_id;

	insert into public.loyalty_point_transactions (
		visitor_id, points_delta, transaction_type, source_product_id, source_product_name, idempotency_key
	)
	values (new.visitor_id, 1, 'visit_earned', new.product_id, coalesce(product_name, 'Product visit'), 'visit:' || new.product_id::text)
	on conflict (visitor_id, idempotency_key) do nothing
	returning id into new_transaction_id;

	if new_transaction_id is not null then
		insert into public.loyalty_accounts (visitor_id, points_balance)
		values (new.visitor_id, 1)
		on conflict (visitor_id) do update
		set points_balance = public.loyalty_accounts.points_balance + 1, updated_at = now();
	end if;
	return new;
end;
$$;

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
		new.city := null;
		new.country_code := upper(nullif(btrim(new.country_code), ''));
		if new.country_code is not null and not exists (
			select 1 from public.supported_countries country
			where country.country_code = new.country_code and country.is_enabled
		) then
			raise exception 'Select a currently supported country.' using errcode = '22023';
		end if;
	else
		select city.* into selected_city
		from public.supported_cities city
		join public.supported_countries country on country.country_code = city.country_code
		where city.city_id = new.city_id and country.is_enabled;
		if not found then
			raise exception 'Select a currently supported city.' using errcode = '22023';
		end if;
		new.city := selected_city.city_name;
		new.country_code := selected_city.country_code;
	end if;

	if tg_op = 'UPDATE'
		and not (select public.is_admin())
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

	if tg_op = 'UPDATE' and not (select public.is_admin())
		and (new.city is distinct from old.city or new.country_code is distinct from old.country_code)
		and new.city_id is not distinct from old.city_id then
		raise exception 'Choose a supported location from the list.' using errcode = '22023';
	end if;
	return new;
end;
$$;

create or replace function public.validate_seller_shop_city()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.shop_city_id is not null and not exists (
		select 1
		from public.supported_cities city
		join public.supported_countries country on country.country_code = city.country_code
		where city.city_id = new.shop_city_id and country.is_enabled
	) then
		raise exception 'Choose a currently supported United Kingdom city.' using errcode = '22023';
	end if;
	return new;
end;
$$;

create trigger validate_seller_shop_city
	before insert or update of shop_city_id on public.seller_profiles
	for each row execute function public.validate_seller_shop_city();

create or replace function public.admin_count_loyalty_offer_eligible(p_offer_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	offer public.loyalty_offers%rowtype;
	eligible_count bigint;
begin
	if not (select public.is_admin()) then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
	select * into offer from public.loyalty_offers where id = p_offer_id;
	if not found then raise exception 'Offer not found.' using errcode = 'P0002'; end if;
	select count(*) into eligible_count
	from public.loyalty_accounts account
	join public.profiles profile on profile.id = account.visitor_id
	where account.points_balance >= greatest(offer.minimum_points, offer.points_cost)
		and public.is_supported_loyalty_visitor(account.visitor_id)
		and (not exists (select 1 from public.loyalty_offer_city_quotas quota where quota.offer_id = offer.id)
			or exists (select 1 from public.loyalty_offer_city_quotas quota where quota.offer_id = offer.id and quota.city_id = profile.city_id))
		and not exists (select 1 from public.loyalty_offer_claims claim where claim.offer_id = offer.id and claim.visitor_id = account.visitor_id);
	return eligible_count;
end;
$$;

create or replace function public.admin_get_loyalty_offer_metrics()
returns table (offer_id uuid, eligible_count bigint, claim_count bigint, winner_count bigint, database_now timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
	select offer.id,
		(select count(*) from public.loyalty_accounts account join public.profiles profile on profile.id = account.visitor_id
		 where account.points_balance >= greatest(offer.minimum_points, offer.points_cost)
			and public.is_supported_loyalty_visitor(account.visitor_id)
			and (not exists (select 1 from public.loyalty_offer_city_quotas quota where quota.offer_id = offer.id)
				or exists (select 1 from public.loyalty_offer_city_quotas quota where quota.offer_id = offer.id and quota.city_id = profile.city_id))
			and not exists (select 1 from public.loyalty_offer_claims claim where claim.offer_id = offer.id and claim.visitor_id = account.visitor_id))::bigint,
		(select count(*) from public.loyalty_offer_claims claim where claim.offer_id = offer.id)::bigint,
		(select count(*) from public.loyalty_offer_claims claim where claim.offer_id = offer.id and claim.status in ('won', 'redeemed'))::bigint,
		now()
	from public.loyalty_offers offer
	where (select public.is_admin())
	order by offer.created_at desc;
$$;

revoke all on function public.validate_seller_shop_city() from public, anon, authenticated;
revoke all on function public.admin_count_loyalty_offer_eligible(uuid) from public, anon;
revoke all on function public.admin_get_loyalty_offer_metrics() from public, anon;
grant execute on function public.admin_count_loyalty_offer_eligible(uuid) to authenticated;
grant execute on function public.admin_get_loyalty_offer_metrics() to authenticated;