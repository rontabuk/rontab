create table public.loyalty_offer_city_quotas (
	offer_id uuid not null references public.loyalty_offers (id) on delete restrict,
	city text not null check (length(btrim(city)) between 1 and 80),
	country_code text not null check (country_code ~ '^[A-Z]{2}$'),
	capacity integer not null check (capacity between 1 and 100000),
	created_at timestamptz not null default now()
);

create unique index loyalty_offer_city_quotas_unique_location_idx
	on public.loyalty_offer_city_quotas (offer_id, lower(btrim(city)), country_code);
create index loyalty_offer_city_quotas_location_idx
	on public.loyalty_offer_city_quotas (lower(btrim(city)), country_code);

insert into public.loyalty_offer_city_quotas (offer_id, city, country_code, capacity)
select offer.id, btrim(offer.city), offer.country_code, offer.capacity
from public.loyalty_offers offer
where nullif(btrim(offer.city), '') is not null
on conflict do nothing;

update public.loyalty_offers
set city = null, country_code = null
where city is not null;

alter table public.loyalty_offer_city_quotas enable row level security;
grant select on public.loyalty_offer_city_quotas to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.loyalty_offer_city_quotas from anon, authenticated;
create policy "Admins read offer city quotas"
	on public.loyalty_offer_city_quotas for select to authenticated
	using ((select public.is_admin()));

create or replace function public.normalize_and_lock_profile_city()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	new.city := nullif(btrim(new.city), '');
	new.country_code := upper(nullif(btrim(new.country_code), ''));
	if new.city is null then
		new.country_code := null;
	end if;

	if tg_op = 'UPDATE'
		and not (select public.is_admin())
		and (new.city is distinct from old.city or new.country_code is distinct from old.country_code)
		and exists (
			select 1
			from public.loyalty_offer_city_quotas quota
			join public.loyalty_offers offer on offer.id = quota.offer_id
			where offer.status = 'published'
				and offer.starts_at <= now()
				and offer.ends_at > now()
				and (
					(lower(btrim(quota.city)) = lower(btrim(old.city)) and quota.country_code = old.country_code)
					or (lower(btrim(quota.city)) = lower(btrim(new.city)) and quota.country_code = new.country_code)
				)
		) then
		raise exception 'Your city cannot be changed while an offer for that city is active.' using errcode = '55000';
	end if;
	return new;
end;
$$;

create or replace function public.is_visitor_city_locked()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select (select public.is_eligible_visitor()) and exists (
		select 1
		from public.profiles visitor
		join public.loyalty_offer_city_quotas quota
			on lower(btrim(quota.city)) = lower(btrim(visitor.city))
			and quota.country_code = visitor.country_code
		join public.loyalty_offers offer on offer.id = quota.offer_id
		where visitor.id = (select auth.uid())
			and offer.status = 'published'
			and offer.starts_at <= now()
			and offer.ends_at > now()
	);
$$;

drop function public.get_visitor_loyalty_offers();

create function public.get_visitor_loyalty_offers()
returns table (
	id uuid,
	title text,
	summary text,
	description text,
	image_url text,
	terms text,
	offer_type text,
	selection_method text,
	minimum_points integer,
	points_cost integer,
	capacity integer,
	claim_count bigint,
	remaining_count bigint,
	locations text[],
	starts_at timestamptz,
	ends_at timestamptz,
	already_joined boolean
)
language sql
stable
security definer
set search_path = ''
as $$
	select
		offer.id,
		offer.title,
		offer.summary,
		offer.description,
		offer.image_url,
		offer.terms,
		offer.offer_type,
		offer.selection_method,
		offer.minimum_points,
		offer.points_cost,
		coalesce(visitor_quota.capacity, offer.capacity),
		count(claim.id)::bigint,
		case
			when offer.offer_type = 'participation' and offer.selection_method = 'random' then coalesce(visitor_quota.capacity, offer.capacity)::bigint
			else greatest(coalesce(visitor_quota.capacity, offer.capacity) - count(claim.id), 0)::bigint
		end,
		coalesce((
			select array_agg(quota.city || ', ' || quota.country_code order by lower(quota.city), quota.country_code)
			from public.loyalty_offer_city_quotas quota
			where quota.offer_id = offer.id
		), array['All locations']::text[]),
		offer.starts_at,
		offer.ends_at,
		coalesce(bool_or(claim.visitor_id = (select auth.uid())), false)
	from public.loyalty_offers offer
	join public.profiles visitor on visitor.id = (select auth.uid())
	left join public.loyalty_offer_city_quotas visitor_quota
		on visitor_quota.offer_id = offer.id
		and lower(btrim(visitor_quota.city)) = lower(btrim(visitor.city))
		and visitor_quota.country_code = visitor.country_code
	left join public.loyalty_offer_claims claim
		on claim.offer_id = offer.id
		and (
			(not exists (select 1 from public.loyalty_offer_city_quotas quota where quota.offer_id = offer.id))
			or (lower(btrim(claim.city)) = lower(btrim(visitor_quota.city)) and claim.country_code = visitor_quota.country_code)
		)
	where (select public.is_eligible_visitor())
		and offer.status = 'published'
		and offer.starts_at <= now()
		and offer.ends_at > now()
		and (
			not exists (select 1 from public.loyalty_offer_city_quotas quota where quota.offer_id = offer.id)
			or visitor_quota.offer_id is not null
		)
		and (
			offer.selection_method <> 'random'
			or exists (
				select 1 from public.marketplace_settings
				where singleton = true and loyalty_random_draws_enabled
			)
		)
	group by offer.id, visitor_quota.capacity
	order by offer.ends_at asc, offer.created_at desc;
$$;

drop function public.admin_save_loyalty_offer(uuid, text, text, text, text, text, text, text, integer, integer, integer, text, text, timestamptz, timestamptz);

create function public.admin_save_loyalty_offer(
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
	if not (select public.is_admin()) then
		raise exception 'Administrator access is required.' using errcode = '42501';
	end if;
	if length(btrim(p_title)) not between 3 and 120
		or length(btrim(p_summary)) not between 3 and 240
		or length(p_terms) not between 1 and 5000
		or p_image_url !~* '^https://'
		or p_offer_type not in ('participation', 'redemption')
		or p_selection_method not in ('random', 'first_come')
		or (p_offer_type = 'redemption' and p_selection_method <> 'first_come')
		or p_minimum_points < 0
		or p_points_cost < 1
		or jsonb_typeof(p_city_quotas) is distinct from 'array'
		or p_starts_at is null
		or p_ends_at is null
		or p_ends_at <= p_starts_at then
		raise exception 'Offer details, dates, points, locations, or image are invalid.' using errcode = '22023';
	end if;

	if exists (
		select 1
		from jsonb_to_recordset(p_city_quotas) as quota(city text, country_code text, capacity integer)
		where nullif(btrim(quota.city), '') is null
			or length(btrim(quota.city)) > 80
			or quota.country_code is null
			or upper(btrim(quota.country_code)) !~ '^[A-Z]{2}$'
			or quota.capacity is null
			or quota.capacity not between 1 and 100000
	) then
		raise exception 'Each city allocation needs a city, country, and capacity from 1 to 100,000.' using errcode = '22023';
	end if;
	if exists (
		select 1
		from jsonb_to_recordset(p_city_quotas) as quota(city text, country_code text, capacity integer)
		group by lower(btrim(quota.city)), upper(btrim(quota.country_code))
		having count(*) > 1
	) then
		raise exception 'A city can only be allocated once per offer.' using errcode = '22023';
	end if;

	select coalesce(sum(quota.capacity), 0)::integer into assigned_capacity
	from jsonb_to_recordset(p_city_quotas) as quota(city text, country_code text, capacity integer);
	if assigned_capacity > 100000 then
		raise exception 'The sum of city allocations cannot exceed 100,000.' using errcode = '22023';
	end if;
	if assigned_capacity = 0 then
		if p_global_capacity not between 1 and 100000 then
			raise exception 'Global capacity must be between 1 and 100,000.' using errcode = '22023';
		end if;
		assigned_capacity := p_global_capacity;
	end if;

	if p_offer_id is null then
		insert into public.loyalty_offers (
			title, summary, description, image_url, terms, offer_type,
			selection_method, status, minimum_points, points_cost, capacity,
			city, country_code, starts_at, ends_at, created_by
		)
		values (
			btrim(p_title), btrim(p_summary), btrim(p_description), btrim(p_image_url), btrim(p_terms), p_offer_type,
			p_selection_method, 'draft', p_minimum_points, p_points_cost, assigned_capacity,
			null, null, p_starts_at, p_ends_at, (select auth.uid())
		)
		returning id into saved_offer_id;
	else
		select offer.status into current_status
		from public.loyalty_offers offer
		where offer.id = p_offer_id
		for update;
		if current_status is distinct from 'draft' then
			raise exception 'Only draft offers can be edited.' using errcode = '55000';
		end if;

		update public.loyalty_offers offer
		set title = btrim(p_title),
			summary = btrim(p_summary),
			description = btrim(p_description),
			image_url = btrim(p_image_url),
			terms = btrim(p_terms),
			offer_type = p_offer_type,
			selection_method = p_selection_method,
			minimum_points = p_minimum_points,
			points_cost = p_points_cost,
			capacity = assigned_capacity,
			city = null,
			country_code = null,
			starts_at = p_starts_at,
			ends_at = p_ends_at,
			updated_at = now()
		where offer.id = p_offer_id
		returning id into saved_offer_id;
		delete from public.loyalty_offer_city_quotas quota where quota.offer_id = saved_offer_id;
	end if;

	if jsonb_array_length(p_city_quotas) > 0 then
		insert into public.loyalty_offer_city_quotas (offer_id, city, country_code, capacity)
		select saved_offer_id, btrim(quota.city), upper(btrim(quota.country_code)), quota.capacity
		from jsonb_to_recordset(p_city_quotas) as quota(city text, country_code text, capacity integer);
	end if;

	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values (
		(select auth.uid()),
		case when p_offer_id is null then 'loyalty_offer_created' else 'loyalty_offer_updated' end,
		'loyalty_offer',
		saved_offer_id,
		jsonb_build_object('offer_type', p_offer_type, 'title', btrim(p_title), 'capacity', assigned_capacity, 'city_allocations', p_city_quotas)
	);
	return saved_offer_id;
end;
$$;

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
	if not (select public.is_admin()) then
		raise exception 'Administrator access is required.' using errcode = '42501';
	end if;
	select * into offer from public.loyalty_offers where id = p_offer_id;
	if not found then
		raise exception 'Offer not found.' using errcode = 'P0002';
	end if;

	select count(*) into eligible_count
	from public.loyalty_accounts account
	join public.profiles profile on profile.id = account.visitor_id
	join auth.users account_user on account_user.id = account.visitor_id
	where account.points_balance >= greatest(offer.minimum_points, offer.points_cost)
		and account_user.email_confirmed_at is not null
		and not coalesce((account_user.raw_app_meta_data ->> 'role') = 'admin', false)
		and not exists (select 1 from public.seller_profiles seller where seller.user_id = account.visitor_id)
		and not exists (select 1 from public.loyalty_offer_claims claim where claim.offer_id = offer.id and claim.visitor_id = account.visitor_id)
		and (
			not exists (select 1 from public.loyalty_offer_city_quotas quota where quota.offer_id = offer.id)
			or exists (
				select 1 from public.loyalty_offer_city_quotas quota
				where quota.offer_id = offer.id
					and lower(btrim(quota.city)) = lower(btrim(profile.city))
					and quota.country_code = profile.country_code
			)
		);
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
	select
		offer.id,
		(
			select count(*)
			from public.loyalty_accounts account
			join public.profiles profile on profile.id = account.visitor_id
			join auth.users account_user on account_user.id = account.visitor_id
			where account.points_balance >= greatest(offer.minimum_points, offer.points_cost)
				and account_user.email_confirmed_at is not null
				and not coalesce((account_user.raw_app_meta_data ->> 'role') = 'admin', false)
				and not exists (select 1 from public.seller_profiles seller where seller.user_id = account.visitor_id)
				and not exists (select 1 from public.loyalty_offer_claims claim where claim.offer_id = offer.id and claim.visitor_id = account.visitor_id)
				and (
					not exists (select 1 from public.loyalty_offer_city_quotas quota where quota.offer_id = offer.id)
					or exists (
						select 1 from public.loyalty_offer_city_quotas quota
						where quota.offer_id = offer.id
							and lower(btrim(quota.city)) = lower(btrim(profile.city))
							and quota.country_code = profile.country_code
					)
				)
		)::bigint,
		(select count(*) from public.loyalty_offer_claims claim where claim.offer_id = offer.id)::bigint,
		(select count(*) from public.loyalty_offer_claims claim where claim.offer_id = offer.id and claim.status in ('won', 'redeemed'))::bigint,
		now()
	from public.loyalty_offers offer
	where (select public.is_admin())
	order by offer.created_at desc;
$$;

create or replace function public.join_loyalty_offer(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	current_visitor_id uuid := (select auth.uid());
	offer public.loyalty_offers%rowtype;
	account_balance bigint;
	visitor_city text;
	visitor_country text;
	claim_status text;
	claim_id uuid;
	claim_count bigint;
	city_capacity integer;
begin
	if not (select public.is_eligible_visitor()) then
		raise exception 'A confirmed visitor account is required.' using errcode = '42501';
	end if;
	select * into offer from public.loyalty_offers where id = p_offer_id for update;
	if not found or offer.status <> 'published' or offer.starts_at > now() or offer.ends_at <= now() then
		raise exception 'This offer is not available.' using errcode = '55000';
	end if;
	if offer.selection_method = 'random' and not exists (
		select 1 from public.marketplace_settings where singleton = true and loyalty_random_draws_enabled
	) then
		raise exception 'This offer is not available.' using errcode = '55000';
	end if;

	select profile.city, profile.country_code into visitor_city, visitor_country
	from public.profiles profile where profile.id = current_visitor_id;
	select quota.capacity into city_capacity
	from public.loyalty_offer_city_quotas quota
	where quota.offer_id = offer.id
		and lower(btrim(quota.city)) = lower(btrim(visitor_city))
		and quota.country_code = visitor_country;
	if exists (select 1 from public.loyalty_offer_city_quotas quota where quota.offer_id = offer.id)
		and city_capacity is null then
		raise exception 'This offer is only available in its listed cities.' using errcode = '42501';
	end if;

	select claim.id, claim.status into claim_id, claim_status
	from public.loyalty_offer_claims claim
	where claim.offer_id = offer.id and claim.visitor_id = current_visitor_id;
	if claim_id is not null then
		select account.points_balance into account_balance from public.loyalty_accounts account where account.visitor_id = current_visitor_id;
		return jsonb_build_object('alreadyJoined', true, 'claimId', claim_id, 'status', claim_status, 'pointsBalance', account_balance);
	end if;

	select account.points_balance into account_balance
	from public.loyalty_accounts account where account.visitor_id = current_visitor_id for update;
	if account_balance is null or account_balance < offer.minimum_points or account_balance < offer.points_cost then
		raise exception 'You do not have enough points for this offer.' using errcode = '23514';
	end if;
	city_capacity := coalesce(city_capacity, offer.capacity);

	if offer.offer_type = 'redemption' or offer.selection_method = 'first_come' then
		select count(*) into claim_count
		from public.loyalty_offer_claims claim
		where claim.offer_id = offer.id
			and claim.claim_type = offer.offer_type
			and (city_capacity = offer.capacity and not exists (select 1 from public.loyalty_offer_city_quotas quota where quota.offer_id = offer.id)
				or (lower(btrim(claim.city)) = lower(btrim(visitor_city)) and claim.country_code = visitor_country));
		if claim_count >= city_capacity then
			raise exception 'This offer has been fully claimed in your city.' using errcode = '55000';
		end if;
		claim_status := case when offer.offer_type = 'redemption' then 'redeemed' else 'won' end;
	else
		claim_status := 'entered';
	end if;

	insert into public.loyalty_offer_claims (offer_id, visitor_id, claim_type, status, points_spent, city, country_code)
	values (offer.id, current_visitor_id, offer.offer_type, claim_status, offer.points_cost, visitor_city, visitor_country)
	on conflict (offer_id, visitor_id) do nothing
	returning id into claim_id;
	if claim_id is null then
		return jsonb_build_object('alreadyJoined', true, 'pointsBalance', account_balance);
	end if;

	update public.loyalty_accounts
	set points_balance = points_balance - offer.points_cost, updated_at = now()
	where loyalty_accounts.visitor_id = current_visitor_id;
	insert into public.loyalty_point_transactions (visitor_id, points_delta, transaction_type, offer_claim_id, idempotency_key)
	values (current_visitor_id, -offer.points_cost,
		case when offer.offer_type = 'participation' then 'participation_spent' else 'redemption_spent' end,
		claim_id, 'offer:' || claim_id::text);
	return jsonb_build_object('alreadyJoined', false, 'claimId', claim_id, 'status', claim_status, 'pointsBalance', account_balance - offer.points_cost);
end;
$$;

create or replace function public.admin_run_loyalty_offer_draw(p_offer_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
	offer public.loyalty_offers%rowtype;
	winner_count integer;
begin
	if not (select public.is_admin()) then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
	select * into offer from public.loyalty_offers where id = p_offer_id for update;
	if not found or offer.offer_type <> 'participation' or offer.selection_method <> 'random'
		or offer.status not in ('published', 'paused') or offer.ends_at > now() then
		raise exception 'This offer is not ready for a draw.' using errcode = '55000';
	end if;
	if not exists (select 1 from public.marketplace_settings where singleton = true and loyalty_random_draws_enabled) then
		raise exception 'Random draws are disabled.' using errcode = '55000';
	end if;

	with ranked as (
		select claim.id,
			claim.city,
			claim.country_code,
			row_number() over (
				partition by case
					when exists (select 1 from public.loyalty_offer_city_quotas quota where quota.offer_id = offer.id)
					then lower(btrim(claim.city)) || ':' || claim.country_code
					else '__all_locations__'
				end
			order by gen_random_uuid()
			) as position
		from public.loyalty_offer_claims claim
		where claim.offer_id = p_offer_id and claim.status = 'entered'
	), chosen as materialized (
		select ranked.id
		from ranked
		left join public.loyalty_offer_city_quotas quota
			on quota.offer_id = p_offer_id
			and lower(btrim(quota.city)) = lower(btrim(ranked.city))
			and quota.country_code = ranked.country_code
		where ranked.position <= coalesce(quota.capacity, offer.capacity)
	), updated as (
		update public.loyalty_offer_claims claim
		set status = case when chosen.id is null then 'lost' else 'won' end
		from ranked entrants left join chosen on chosen.id = entrants.id
		where claim.id = entrants.id
		returning claim.status
	)
	select count(*) filter (where status = 'won')::integer into winner_count from updated;

	update public.loyalty_offers set status = 'completed', updated_at = now() where id = p_offer_id;
	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values ((select auth.uid()), 'loyalty_offer_draw_completed', 'loyalty_offer', p_offer_id,
		jsonb_build_object('winner_count', winner_count, 'capacity', offer.capacity));
	return winner_count;
end;
$$;

create or replace function public.get_visitor_loyalty_offers()
returns table (
	id uuid, title text, summary text, description text, image_url text, terms text,
	offer_type text, selection_method text, minimum_points integer, points_cost integer,
	capacity integer, claim_count bigint, remaining_count bigint, locations text[],
	starts_at timestamptz, ends_at timestamptz, already_joined boolean
)
language sql
stable
security definer
set search_path = ''
as $$
	select offer.id, offer.title, offer.summary, offer.description, offer.image_url, offer.terms,
		offer.offer_type, offer.selection_method, offer.minimum_points, offer.points_cost,
		coalesce(visitor_quota.capacity, offer.capacity),
		count(claim.id)::bigint,
		case when offer.offer_type = 'participation' and offer.selection_method = 'random'
			then coalesce(visitor_quota.capacity, offer.capacity)::bigint
			else greatest(coalesce(visitor_quota.capacity, offer.capacity) - count(claim.id), 0)::bigint end,
		coalesce((select array_agg(quota.city || ', ' || quota.country_code order by lower(quota.city), quota.country_code)
			from public.loyalty_offer_city_quotas quota where quota.offer_id = offer.id), array['All locations']::text[]),
		offer.starts_at, offer.ends_at, coalesce(bool_or(claim.visitor_id = (select auth.uid())), false)
	from public.loyalty_offers offer
	join public.profiles visitor on visitor.id = (select auth.uid())
	left join public.loyalty_offer_city_quotas visitor_quota on visitor_quota.offer_id = offer.id
		and lower(btrim(visitor_quota.city)) = lower(btrim(visitor.city))
		and visitor_quota.country_code = visitor.country_code
	left join public.loyalty_offer_claims claim on claim.offer_id = offer.id
		and (not exists (select 1 from public.loyalty_offer_city_quotas quota where quota.offer_id = offer.id)
			or (lower(btrim(claim.city)) = lower(btrim(visitor_quota.city)) and claim.country_code = visitor_quota.country_code))
	where (select public.is_eligible_visitor()) and offer.status = 'published'
		and offer.starts_at <= now() and offer.ends_at > now()
		and (not exists (select 1 from public.loyalty_offer_city_quotas quota where quota.offer_id = offer.id)
			or visitor_quota.offer_id is not null)
		and (offer.selection_method <> 'random' or exists (
			select 1 from public.marketplace_settings where singleton = true and loyalty_random_draws_enabled))
	group by offer.id, visitor_quota.capacity
	order by offer.ends_at asc, offer.created_at desc;
$$;

revoke all on function public.admin_save_loyalty_offer(uuid, text, text, text, text, text, text, text, integer, integer, integer, jsonb, timestamptz, timestamptz) from public, anon;
revoke all on function public.admin_count_loyalty_offer_eligible(uuid) from public, anon;
revoke all on function public.admin_get_loyalty_offer_metrics() from public, anon;
revoke all on function public.join_loyalty_offer(uuid) from public, anon;
revoke all on function public.admin_run_loyalty_offer_draw(uuid) from public, anon;
revoke all on function public.get_visitor_loyalty_offers() from public, anon;

grant execute on function public.admin_save_loyalty_offer(uuid, text, text, text, text, text, text, text, integer, integer, integer, jsonb, timestamptz, timestamptz) to authenticated;
grant execute on function public.admin_count_loyalty_offer_eligible(uuid) to authenticated;
grant execute on function public.admin_get_loyalty_offer_metrics() to authenticated;
grant execute on function public.join_loyalty_offer(uuid) to authenticated;
grant execute on function public.admin_run_loyalty_offer_draw(uuid) to authenticated;
grant execute on function public.get_visitor_loyalty_offers() to authenticated;