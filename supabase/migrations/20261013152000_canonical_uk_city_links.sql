alter table public.supported_cities
	drop constraint supported_cities_city_id_check,
	drop constraint supported_cities_country_code_check,
	add constraint supported_cities_city_id_country_prefix_check
		check (city_id ~ '^[A-Z]{2}-.+' and split_part(city_id, '-', 1) = country_code);

alter table public.profiles
	add column city_id text references public.supported_cities (city_id) on delete restrict;
alter table public.seller_profiles
	add column shop_city_id text references public.supported_cities (city_id) on delete restrict;
alter table public.loyalty_offer_city_quotas
	add column city_id text references public.supported_cities (city_id) on delete restrict;
alter table public.loyalty_offer_claims
	add column city_id text references public.supported_cities (city_id) on delete set null;

update public.profiles profile
set city_id = (
	select city.city_id
	from public.supported_cities city
	where city.country_code = 'GB'
		and lower(btrim(city.city_name)) = lower(btrim(profile.city))
	order by city.population desc, city.admin_name, city.city_id
	limit 1
)
where upper(profile.country_code) = 'GB'
	and nullif(btrim(profile.city), '') is not null;

update public.seller_profiles seller
set shop_city_id = null
where shop_city_id is not null;

update public.loyalty_offer_city_quotas quota
set city_id = (
	select city.city_id
	from public.supported_cities city
	where city.country_code = 'GB'
		and city.country_code = quota.country_code
		and lower(btrim(city.city_name)) = lower(btrim(quota.city))
	order by city.population desc, city.admin_name, city.city_id
	limit 1
)
where upper(quota.country_code) = 'GB';

update public.loyalty_offer_claims claim
set city_id = (
	select city.city_id
	from public.supported_cities city
	where city.country_code = 'GB'
		and city.country_code = claim.country_code
		and lower(btrim(city.city_name)) = lower(btrim(claim.city))
	order by city.population desc, city.admin_name, city.city_id
	limit 1
)
where upper(claim.country_code) = 'GB'
	and nullif(btrim(claim.city), '') is not null;

update public.loyalty_offers offer
set status = 'paused', updated_at = now()
where offer.status = 'published'
	and exists (
		select 1 from public.loyalty_offer_city_quotas quota
		where quota.offer_id = offer.id and quota.city_id is null
	);

create unique index loyalty_offer_city_quotas_unique_city_id_idx
	on public.loyalty_offer_city_quotas (offer_id, city_id)
	where city_id is not null;
create index profiles_city_id_idx on public.profiles (city_id) where city_id is not null;
create index seller_profiles_shop_city_id_idx on public.seller_profiles (shop_city_id) where shop_city_id is not null;
create index loyalty_offer_claims_offer_city_idx on public.loyalty_offer_claims (offer_id, city_id, status);

revoke update (city, country_code) on public.profiles from authenticated;
grant update (city_id) on public.profiles to authenticated;

drop trigger normalize_and_lock_profile_city on public.profiles;
drop function public.normalize_and_lock_profile_city();

create function public.normalize_and_lock_profile_city()
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

		if tg_op = 'UPDATE' and not (select public.is_admin())
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

create trigger normalize_and_lock_profile_city
	before insert or update of city_id, city, country_code on public.profiles
	for each row execute function public.normalize_and_lock_profile_city();

create or replace function public.is_visitor_city_locked()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select (select public.is_eligible_visitor()) and exists (
		select 1
		from public.loyalty_offer_city_quotas quota
		join public.loyalty_offers offer on offer.id = quota.offer_id
		join public.profiles visitor on visitor.id = (select auth.uid())
		where visitor.city_id = quota.city_id
			and offer.status = 'published'
			and offer.starts_at <= now()
			and offer.ends_at > now()
	);
$$;

drop function public.admin_get_loyalty_offer_city_metrics();

create function public.admin_get_loyalty_offer_city_metrics()
returns table (
	offer_id uuid,
	city_id text,
	city text,
	country_code text,
	admin_name text,
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
		select offer.id as current_offer_id, city.city_id as current_city_id,
			city.city_name as current_city, city.country_code as current_country_code,
			city.admin_name as current_admin_name, quota.capacity as current_capacity
		from public.loyalty_offers offer
		join public.loyalty_offer_city_quotas quota on quota.offer_id = offer.id
		join public.supported_cities city on city.city_id = quota.city_id
		union all
		select offer.id, null::text, null::text, null::text, null::text, offer.capacity
		from public.loyalty_offers offer
		where not exists (select 1 from public.loyalty_offer_city_quotas quota where quota.offer_id = offer.id)
	)
	select
		location.current_offer_id,
		location.current_city_id,
		location.current_city,
		location.current_country_code,
		location.current_admin_name,
		location.current_capacity,
		(
			select count(*)
			from public.loyalty_accounts account
			join public.profiles profile on profile.id = account.visitor_id
			join auth.users account_user on account_user.id = account.visitor_id
			join public.loyalty_offers offer on offer.id = location.current_offer_id
			where account.points_balance >= greatest(offer.minimum_points, offer.points_cost)
				and account_user.email_confirmed_at is not null
				and not coalesce((account_user.raw_app_meta_data ->> 'role') = 'admin', false)
				and not exists (select 1 from public.seller_profiles seller where seller.user_id = account.visitor_id)
				and not exists (select 1 from public.loyalty_offer_claims claim where claim.offer_id = offer.id and claim.visitor_id = account.visitor_id)
				and (location.current_city_id is null or profile.city_id = location.current_city_id)
		)::bigint,
		(
			select count(*)
			from public.loyalty_offer_claims claim
			where claim.offer_id = location.current_offer_id
				and (location.current_city_id is null or claim.city_id = location.current_city_id)
		)::bigint
	from offer_locations location
	where (select public.is_admin())
	order by location.current_offer_id, location.current_city;
$$;

create or replace function public.admin_save_loyalty_offer(
	p_offer_id uuid,
	p_title text,
	p_summary text,
	p_description text,
	p_image_url text,
	p_terms text,
	p_offer_type text,
	p_selection_method text,
	p_minimum_points integer,
	p_points_cost integer,
	p_global_capacity integer,
	p_city_quotas jsonb,
	p_starts_at timestamptz,
	p_ends_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	saved_offer_id uuid;
	current_status text;
	assigned_capacity integer;
begin
	if not (select public.is_admin()) then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
	if length(btrim(p_title)) not between 3 and 120
		or length(btrim(p_summary)) not between 3 and 240
		or length(p_terms) not between 1 and 5000
		or p_image_url !~* '^https://'
		or p_offer_type not in ('participation', 'redemption')
		or p_selection_method not in ('random', 'first_come')
		or (p_offer_type = 'redemption' and p_selection_method <> 'first_come')
		or p_minimum_points < 0 or p_points_cost < 1
		or jsonb_typeof(p_city_quotas) is distinct from 'array'
		or p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
		raise exception 'Offer details, dates, points, locations, or image are invalid.' using errcode = '22023';
	end if;
	if exists (
		select 1 from jsonb_to_recordset(p_city_quotas) as quota(city_id text, capacity integer)
		left join public.supported_cities city on city.city_id = quota.city_id
		left join public.supported_countries country on country.country_code = city.country_code and country.is_enabled
		where city.city_id is null or country.country_code is null
			or quota.capacity is null or quota.capacity not between 1 and 100000
	) then raise exception 'Each city quota needs a supported city and a capacity from 1 to 100,000.' using errcode = '22023'; end if;
	if exists (
		select 1 from jsonb_to_recordset(p_city_quotas) as quota(city_id text, capacity integer)
		group by quota.city_id having count(*) > 1
	) then raise exception 'A city can only be allocated once per offer.' using errcode = '22023'; end if;

	select coalesce(sum(quota.capacity), 0)::integer into assigned_capacity
	from jsonb_to_recordset(p_city_quotas) as quota(city_id text, capacity integer);
	if assigned_capacity > 100000 then raise exception 'The sum of city allocations cannot exceed 100,000.' using errcode = '22023'; end if;
	if assigned_capacity = 0 then
		if p_global_capacity not between 1 and 100000 then raise exception 'Global capacity must be between 1 and 100,000.' using errcode = '22023'; end if;
		assigned_capacity := p_global_capacity;
	end if;

	if p_offer_id is null then
		insert into public.loyalty_offers (title,summary,description,image_url,terms,offer_type,selection_method,status,minimum_points,points_cost,capacity,city,country_code,starts_at,ends_at,created_by)
		values (btrim(p_title),btrim(p_summary),btrim(p_description),btrim(p_image_url),btrim(p_terms),p_offer_type,p_selection_method,'draft',p_minimum_points,p_points_cost,assigned_capacity,null,null,p_starts_at,p_ends_at,(select auth.uid()))
		returning id into saved_offer_id;
	else
		select offer.status into current_status from public.loyalty_offers offer where offer.id=p_offer_id for update;
		if current_status is distinct from 'draft' then raise exception 'Only draft offers can be edited.' using errcode = '55000'; end if;
		update public.loyalty_offers offer set title=btrim(p_title),summary=btrim(p_summary),description=btrim(p_description),image_url=btrim(p_image_url),terms=btrim(p_terms),offer_type=p_offer_type,selection_method=p_selection_method,minimum_points=p_minimum_points,points_cost=p_points_cost,capacity=assigned_capacity,city=null,country_code=null,starts_at=p_starts_at,ends_at=p_ends_at,updated_at=now() where offer.id=p_offer_id returning id into saved_offer_id;
		delete from public.loyalty_offer_city_quotas quota where quota.offer_id=saved_offer_id;
	end if;

	insert into public.loyalty_offer_city_quotas (offer_id,city_id,city,country_code,capacity)
	select saved_offer_id,city.city_id,city.city_name,city.country_code,requested.capacity
	from jsonb_to_recordset(p_city_quotas) as requested(city_id text,capacity integer)
	join public.supported_cities city on city.city_id=requested.city_id;

	insert into public.admin_audit_logs (actor_id,action,entity_type,entity_id,details)
	values ((select auth.uid()),case when p_offer_id is null then 'loyalty_offer_created' else 'loyalty_offer_updated' end,'loyalty_offer',saved_offer_id,
		jsonb_build_object('offer_type',p_offer_type,'title',btrim(p_title),'capacity',assigned_capacity,'city_allocations',p_city_quotas));
	return saved_offer_id;
end;
$$;

create or replace function public.admin_set_loyalty_offer_status(p_offer_id uuid,p_next_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare offer public.loyalty_offers%rowtype;
begin
	if not (select public.is_admin()) then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
	if p_next_status not in ('published','paused') then raise exception 'Unsupported offer status change.' using errcode = '22023'; end if;
	select * into offer from public.loyalty_offers where id=p_offer_id for update;
	if not found then raise exception 'Offer not found.' using errcode = 'P0002'; end if;
	if p_next_status='published' then
		if offer.status not in ('draft','paused') or offer.ends_at<=now() then raise exception 'Only current draft or paused offers can be published.' using errcode = '55000'; end if;
		if exists (select 1 from public.loyalty_offer_city_quotas quota left join public.supported_cities city on city.city_id=quota.city_id left join public.supported_countries country on country.country_code=city.country_code and country.is_enabled where quota.offer_id=offer.id and (city.city_id is null or country.country_code is null)) then raise exception 'Every city allocation must use a currently supported city.' using errcode = '55000'; end if;
		if offer.selection_method='random' and not exists (select 1 from public.marketplace_settings where singleton=true and loyalty_random_draws_enabled) then raise exception 'An administrator must enable random draws before publishing this offer.' using errcode = '55000'; end if;
	elsif offer.status <> 'published' then raise exception 'Only published offers can be paused.' using errcode = '55000';
	end if;
	update public.loyalty_offers set status=p_next_status,updated_at=now() where id=p_offer_id;
	insert into public.admin_audit_logs (actor_id,action,entity_type,entity_id,details) values ((select auth.uid()),case when p_next_status='published' then 'loyalty_offer_published' else 'loyalty_offer_paused' end,'loyalty_offer',p_offer_id,jsonb_build_object('offer_type',offer.offer_type,'selection_method',offer.selection_method));
end;
$$;

create or replace function public.admin_run_loyalty_offer_draw(p_offer_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare offer public.loyalty_offers%rowtype; winner_count integer;
begin
	if not (select public.is_admin()) then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
	select * into offer from public.loyalty_offers where id=p_offer_id for update;
	if not found or offer.offer_type<>'participation' or offer.selection_method<>'random' or offer.status not in ('published','paused') or offer.ends_at>now() then raise exception 'This offer is not ready for a draw.' using errcode = '55000'; end if;
	if not exists (select 1 from public.marketplace_settings where singleton=true and loyalty_random_draws_enabled) then raise exception 'Random draws are disabled.' using errcode = '55000'; end if;
	with ranked as (
		select claim.id,claim.city_id,row_number() over(partition by coalesce(claim.city_id,'__all_locations__') order by gen_random_uuid()) as position
		from public.loyalty_offer_claims claim where claim.offer_id=p_offer_id and claim.status='entered'
	), chosen as materialized (
		select ranked.id from ranked left join public.loyalty_offer_city_quotas quota on quota.offer_id=p_offer_id and quota.city_id=ranked.city_id
		where ranked.position<=coalesce(quota.capacity,offer.capacity)
	), updated as (
		update public.loyalty_offer_claims claim set status=case when chosen.id is null then 'lost' else 'won' end
		from ranked entrant left join chosen on chosen.id=entrant.id where claim.id=entrant.id returning claim.status
	)
	select count(*) filter(where status='won')::integer into winner_count from updated;
	update public.loyalty_offers set status='completed',updated_at=now() where id=p_offer_id;
	insert into public.admin_audit_logs(actor_id,action,entity_type,entity_id,details) values((select auth.uid()),'loyalty_offer_draw_completed','loyalty_offer',p_offer_id,jsonb_build_object('winner_count',winner_count,'capacity',offer.capacity));
	return winner_count;
end;
$$;

create or replace function public.get_visitor_loyalty_offers()
returns table (id uuid,title text,summary text,description text,image_url text,terms text,offer_type text,selection_method text,minimum_points integer,points_cost integer,capacity integer,claim_count bigint,remaining_count bigint,locations text[],starts_at timestamptz,ends_at timestamptz,already_joined boolean)
language sql
stable
security definer
set search_path = ''
as $$
	select offer.id,offer.title,offer.summary,offer.description,offer.image_url,offer.terms,offer.offer_type,offer.selection_method,offer.minimum_points,offer.points_cost,
		coalesce(visitor_quota.capacity,offer.capacity),count(claim.id)::bigint,
		case when offer.offer_type='participation' and offer.selection_method='random' then coalesce(visitor_quota.capacity,offer.capacity)::bigint else greatest(coalesce(visitor_quota.capacity,offer.capacity)-count(claim.id),0)::bigint end,
		coalesce((select array_agg(city.city_name || ', ' || city.country_code order by lower(city.city_name),city.admin_name) from public.loyalty_offer_city_quotas quota join public.supported_cities city on city.city_id=quota.city_id where quota.offer_id=offer.id),array['All locations']::text[]),
		offer.starts_at,offer.ends_at,coalesce(bool_or(claim.visitor_id=(select auth.uid())),false)
	from public.loyalty_offers offer join public.profiles visitor on visitor.id=(select auth.uid())
	left join public.loyalty_offer_city_quotas visitor_quota on visitor_quota.offer_id=offer.id and visitor_quota.city_id=visitor.city_id
	left join public.loyalty_offer_claims claim on claim.offer_id=offer.id and (not exists(select 1 from public.loyalty_offer_city_quotas quota where quota.offer_id=offer.id) or claim.city_id=visitor_quota.city_id)
	where (select public.is_eligible_visitor()) and offer.status='published' and offer.starts_at<=now() and offer.ends_at>now()
		and (not exists(select 1 from public.loyalty_offer_city_quotas quota where quota.offer_id=offer.id) or visitor_quota.offer_id is not null)
		and (offer.selection_method<>'random' or exists(select 1 from public.marketplace_settings where singleton=true and loyalty_random_draws_enabled))
	group by offer.id,visitor_quota.capacity order by offer.ends_at asc,offer.created_at desc;
$$;

revoke all on function public.admin_save_loyalty_offer(uuid,text,text,text,text,text,text,text,integer,integer,integer,jsonb,timestamptz,timestamptz) from public,anon;
revoke all on function public.admin_count_loyalty_offer_eligible(uuid) from public,anon;
revoke all on function public.admin_get_loyalty_offer_metrics() from public,anon;
revoke all on function public.admin_get_loyalty_offer_city_metrics() from public,anon;
revoke all on function public.join_loyalty_offer(uuid) from public,anon;
revoke all on function public.admin_run_loyalty_offer_draw(uuid) from public,anon;
revoke all on function public.get_visitor_loyalty_offers() from public,anon;

grant execute on function public.admin_save_loyalty_offer(uuid,text,text,text,text,text,text,text,integer,integer,integer,jsonb,timestamptz,timestamptz) to authenticated;
grant execute on function public.admin_count_loyalty_offer_eligible(uuid) to authenticated;
grant execute on function public.admin_get_loyalty_offer_metrics() to authenticated;
grant execute on function public.admin_get_loyalty_offer_city_metrics() to authenticated;
grant execute on function public.join_loyalty_offer(uuid) to authenticated;
grant execute on function public.admin_run_loyalty_offer_draw(uuid) to authenticated;
grant execute on function public.get_visitor_loyalty_offers() to authenticated;