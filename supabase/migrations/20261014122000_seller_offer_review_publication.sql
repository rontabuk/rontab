create table public.seller_offers (
	id uuid primary key default gen_random_uuid(),
	request_id uuid not null unique references public.seller_offer_requests (id) on delete restrict,
	seller_profile_id uuid not null references public.seller_profiles (id) on delete restrict,
	status text not null default 'approved' check (status in ('approved', 'published', 'paused', 'ended')),
	offer_kind text not null check (offer_kind in ('discount', 'meal', 'free_item', 'other')),
	title text not null check (length(btrim(title)) between 3 and 120),
	description text not null check (length(btrim(description)) between 10 and 2000),
	benefit_details text not null check (length(btrim(benefit_details)) between 3 and 1000),
	discount_percent numeric(5, 2) check (discount_percent is null or discount_percent between 0.01 and 100),
	media_url text not null check (media_url ~* '^https://'),
	media_type text not null check (media_type in ('image', 'video')),
	points_cost integer not null check (points_cost between 1 and 1000000),
	terms text not null check (length(btrim(terms)) between 10 and 5000),
	valid_from date not null,
	valid_until date not null,
	approved_by uuid not null references auth.users (id) on delete restrict,
	approved_at timestamptz not null default now(),
	published_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	check (valid_until >= valid_from),
	check (status <> 'published' or published_at is not null)
);

create index seller_offers_public_window_idx
	on public.seller_offers (status, valid_from, valid_until);
create index seller_offers_seller_created_idx
	on public.seller_offers (seller_profile_id, created_at desc);

create table public.seller_offer_locations (
	id uuid primary key default gen_random_uuid(),
	offer_id uuid not null references public.seller_offers (id) on delete restrict,
	city_id text not null references public.supported_cities (city_id) on delete restrict,
	branch_name text not null check (length(btrim(branch_name)) between 2 and 100),
	branch_address text check (branch_address is null or length(btrim(branch_address)) <= 300),
	unique (offer_id, city_id, branch_name)
);

create table public.seller_offer_schedules (
	id uuid primary key default gen_random_uuid(),
	location_id uuid not null references public.seller_offer_locations (id) on delete restrict,
	weekday smallint not null check (weekday between 0 and 6),
	starts_at time not null,
	ends_at time not null,
	daily_capacity integer not null check (daily_capacity between 1 and 1000),
	check (ends_at > starts_at),
	unique (location_id, weekday, starts_at)
);

create table public.seller_offer_daily_quotas (
	location_id uuid not null references public.seller_offer_locations (id) on delete restrict,
	offer_date date not null,
	starts_at time not null,
	ends_at time not null,
	capacity integer not null check (capacity between 1 and 1000),
	reserved_count integer not null default 0 check (reserved_count between 0 and capacity),
	primary key (location_id, offer_date, starts_at),
	check (ends_at > starts_at)
);

create index seller_offer_daily_quotas_date_idx
	on public.seller_offer_daily_quotas (offer_date, starts_at);

alter table public.seller_offers enable row level security;
alter table public.seller_offer_locations enable row level security;
alter table public.seller_offer_schedules enable row level security;
alter table public.seller_offer_daily_quotas enable row level security;

revoke all on public.seller_offers, public.seller_offer_locations,
	public.seller_offer_schedules, public.seller_offer_daily_quotas from public, anon, authenticated;
grant select on public.seller_offers, public.seller_offer_locations, public.seller_offer_schedules to anon, authenticated;
grant select on public.seller_offers, public.seller_offer_locations, public.seller_offer_schedules, public.seller_offer_daily_quotas to authenticated;

create policy "Visitors read published seller offers"
	on public.seller_offers for select to anon, authenticated
	using (status = 'published' or (select public.is_admin()) or (select public.is_seller_owner(seller_profile_id)));

create policy "Visitors read locations for published seller offers"
	on public.seller_offer_locations for select to anon, authenticated
	using (
		exists (
			select 1 from public.seller_offers offer
			where offer.id = offer_id
				and (offer.status = 'published' or (select public.is_admin()) or (select public.is_seller_owner(offer.seller_profile_id)))
		)
	);

create policy "Visitors read schedules for published seller offers"
	on public.seller_offer_schedules for select to anon, authenticated
	using (
		exists (
			select 1
			from public.seller_offer_locations location
			join public.seller_offers offer on offer.id = location.offer_id
			where location.id = location_id
				and (offer.status = 'published' or (select public.is_admin()) or (select public.is_seller_owner(offer.seller_profile_id)))
		)
	);

create policy "Sellers and admins read their daily offer quotas"
	on public.seller_offer_daily_quotas for select to authenticated
	using (
		exists (
			select 1
			from public.seller_offer_locations location
			join public.seller_offers offer on offer.id = location.offer_id
			where location.id = location_id
				and ((select public.is_admin()) or (select public.is_seller_owner(offer.seller_profile_id)))
		)
	);

create function public.admin_decide_seller_offer_request(
	p_request_id uuid,
	p_decision text,
	p_review_note text,
	p_points_cost integer,
	p_final_terms text,
	p_daily_capacity integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	request public.seller_offer_requests%rowtype;
	new_offer_id uuid;
	request_location record;
	new_location_id uuid;
	admin_id uuid := (select auth.uid());
	review_note text := nullif(btrim(p_review_note), '');
begin
	if not (select public.is_admin()) then
		raise exception 'Administrator access is required.' using errcode = '42501';
	end if;
	if p_request_id is null or p_decision not in ('approve', 'changes_requested', 'reject')
		or length(coalesce(p_review_note, '')) > 2000 then
		raise exception 'Offer review decision is invalid.' using errcode = '22023';
	end if;
	if p_decision <> 'approve' and review_note is null then
		raise exception 'Add a review note when requesting changes or rejecting an offer.' using errcode = '22023';
	end if;
	if p_decision = 'approve' and (
		p_points_cost is null or p_points_cost not between 1 and 1000000
		or nullif(btrim(p_final_terms), '') is null or length(btrim(p_final_terms)) > 5000
		or p_daily_capacity is null or p_daily_capacity not between 1 and 1000
	) then
		raise exception 'Approved offers need valid points, final terms, and a daily capacity.' using errcode = '22023';
	end if;

	select * into request
	from public.seller_offer_requests
	where id = p_request_id
	for update;
	if not found then
		raise exception 'Offer request not found.' using errcode = 'P0002';
	end if;
	if request.status <> 'submitted' then
		raise exception 'Only submitted offer requests can be reviewed.' using errcode = '55000';
	end if;
	if p_decision = 'approve' and exists (
		select 1 from public.seller_offer_requests request_row
		join public.seller_offer_request_locations location on location.request_id = request_row.id
		join public.seller_offer_request_schedules schedule on schedule.location_id = location.id
		where request_row.id = p_request_id
			and not exists (
				select 1 from generate_series(request_row.valid_from, request_row.valid_until, interval '1 day') offer_day
				where extract(dow from offer_day)::smallint = schedule.weekday
			)
	) then
		raise exception 'The requested schedule has no matching date in the validity period.' using errcode = '22023';
	end if;

	if p_decision = 'approve' then
		insert into public.seller_offers (
			request_id, seller_profile_id, offer_kind, title, description, benefit_details,
			discount_percent, media_url, media_type, points_cost, terms, valid_from, valid_until, approved_by
		)
		values (
			request.id, request.seller_profile_id, request.offer_kind, request.title, request.description,
			request.benefit_details, request.discount_percent, request.media_url, request.media_type,
			p_points_cost, btrim(p_final_terms), request.valid_from, request.valid_until, admin_id
		)
		returning id into new_offer_id;

		for request_location in
			select * from public.seller_offer_request_locations where request_id = p_request_id order by id
		loop
			insert into public.seller_offer_locations (offer_id, city_id, branch_name, branch_address)
			values (new_offer_id, request_location.city_id, request_location.branch_name, request_location.branch_address)
			returning id into new_location_id;
			insert into public.seller_offer_schedules (location_id, weekday, starts_at, ends_at, daily_capacity)
			select new_location_id, schedule.weekday, schedule.starts_at, schedule.ends_at, p_daily_capacity
			from public.seller_offer_request_schedules schedule
			where schedule.location_id = request_location.id;
		end loop;
	else
		new_offer_id := null;
	end if;

	update public.seller_offer_requests
	set status = case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' else 'changes_requested' end,
		review_note = review_note,
		reviewed_by = admin_id,
		reviewed_at = now()
	where id = p_request_id;

	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values (
		admin_id,
		'seller_offer_request_' || p_decision,
		'seller_offer_request',
		p_request_id,
		jsonb_build_object(
			'decision', p_decision,
			'review_note', review_note,
			'offer_id', new_offer_id,
			'points_cost', case when p_decision = 'approve' then p_points_cost else null end,
			'daily_capacity', case when p_decision = 'approve' then p_daily_capacity else null end
		)
	);
	return new_offer_id;
end;
$$;

create function public.admin_set_seller_offer_status(p_offer_id uuid, p_next_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	offer public.seller_offers%rowtype;
	current_date_uk date := timezone('Europe/London', now())::date;
begin
	if not (select public.is_admin()) then
		raise exception 'Administrator access is required.' using errcode = '42501';
	end if;
	if p_offer_id is null or p_next_status not in ('published', 'paused', 'ended') then
		raise exception 'Seller offer status change is invalid.' using errcode = '22023';
	end if;
	select * into offer from public.seller_offers where id = p_offer_id for update;
	if not found then raise exception 'Seller offer not found.' using errcode = 'P0002'; end if;
	if p_next_status = 'published' and offer.status not in ('approved', 'paused') then
		raise exception 'Only approved or paused seller offers can be published.' using errcode = '55000';
	end if;
	if p_next_status = 'published' and offer.valid_until < current_date_uk then
		raise exception 'An expired seller offer cannot be published.' using errcode = '55000';
	end if;
	if p_next_status = 'paused' and offer.status <> 'published' then
		raise exception 'Only a published seller offer can be paused.' using errcode = '55000';
	end if;
	if p_next_status = 'ended' and offer.status not in ('approved', 'published', 'paused') then
		raise exception 'This seller offer cannot be ended in its current state.' using errcode = '55000';
	end if;

	if p_next_status = 'published' then
		insert into public.seller_offer_daily_quotas (location_id, offer_date, starts_at, ends_at, capacity)
		select schedule.location_id, offer_day::date, schedule.starts_at, schedule.ends_at, schedule.daily_capacity
		from public.seller_offer_schedules schedule
		join public.seller_offer_locations location on location.id = schedule.location_id
		join generate_series(greatest(offer.valid_from, current_date_uk), offer.valid_until, interval '1 day') offer_day
			on extract(dow from offer_day)::smallint = schedule.weekday
		where location.offer_id = offer.id
		on conflict (location_id, offer_date, starts_at) do nothing;
		if not found and offer.status = 'approved' then
			raise exception 'The offer has no scheduled days left to publish.' using errcode = '55000';
		end if;
	end if;

	update public.seller_offers
	set status = p_next_status,
		published_at = case when p_next_status = 'published' then coalesce(published_at, now()) else published_at end,
		updated_at = now()
	where id = p_offer_id;
	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values ((select auth.uid()), 'seller_offer_' || p_next_status, 'seller_offer', p_offer_id, jsonb_build_object('previous_status', offer.status));
end;
$$;

revoke all on function public.admin_decide_seller_offer_request(uuid, text, text, integer, text, integer) from public, anon;
revoke all on function public.admin_set_seller_offer_status(uuid, text) from public, anon;
grant execute on function public.admin_decide_seller_offer_request(uuid, text, text, integer, text, integer) to authenticated;
grant execute on function public.admin_set_seller_offer_status(uuid, text) to authenticated;

create trigger set_seller_offers_updated_at
	before update on public.seller_offers
	for each row execute function public.set_updated_at();