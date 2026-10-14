create table public.seller_offer_requests (
	id uuid primary key default gen_random_uuid(),
	seller_profile_id uuid not null references public.seller_profiles (id) on delete restrict,
	status text not null default 'draft'
		check (status in ('draft', 'submitted', 'changes_requested', 'approved', 'rejected')),
	offer_kind text not null check (offer_kind in ('discount', 'meal', 'free_item', 'other')),
	title text not null check (length(btrim(title)) between 3 and 120),
	description text not null check (length(btrim(description)) between 10 and 2000),
	benefit_details text not null check (length(btrim(benefit_details)) between 3 and 1000),
	discount_percent numeric(5, 2) check (discount_percent is null or discount_percent between 0.01 and 100),
	media_url text check (media_url is null or media_url ~* '^https://'),
	media_type text check (media_type is null or media_type in ('image', 'video')),
	valid_from date not null,
	valid_until date not null,
	capacity_acknowledged boolean not null default false,
	seller_terms_accepted_at timestamptz,
	review_note text check (review_note is null or length(review_note) <= 2000),
	reviewed_by uuid references auth.users (id) on delete set null,
	reviewed_at timestamptz,
	submitted_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	check (valid_until >= valid_from),
	check ((media_url is null) = (media_type is null)),
	check ((reviewed_by is null) = (reviewed_at is null))
);

create index seller_offer_requests_seller_created_idx
	on public.seller_offer_requests (seller_profile_id, created_at desc);
create index seller_offer_requests_review_idx
	on public.seller_offer_requests (status, submitted_at desc)
	where status in ('submitted', 'changes_requested');

create table public.seller_offer_request_locations (
	id uuid primary key default gen_random_uuid(),
	request_id uuid not null references public.seller_offer_requests (id) on delete cascade,
	city_id text not null references public.supported_cities (city_id) on delete restrict,
	branch_name text not null check (length(btrim(branch_name)) between 2 and 100),
	branch_address text check (branch_address is null or length(btrim(branch_address)) <= 300),
	created_at timestamptz not null default now(),
	unique (request_id, city_id, branch_name)
);

create index seller_offer_request_locations_city_idx
	on public.seller_offer_request_locations (city_id, request_id);

create table public.seller_offer_request_schedules (
	id uuid primary key default gen_random_uuid(),
	location_id uuid not null references public.seller_offer_request_locations (id) on delete cascade,
	weekday smallint not null check (weekday between 0 and 6),
	starts_at time not null,
	ends_at time not null,
	requested_daily_capacity integer not null check (requested_daily_capacity between 1 and 1000),
	check (ends_at > starts_at),
	unique (location_id, weekday, starts_at)
);

alter table public.seller_offer_requests enable row level security;
alter table public.seller_offer_request_locations enable row level security;
alter table public.seller_offer_request_schedules enable row level security;

grant select on public.seller_offer_requests to authenticated;
grant insert (
	seller_profile_id, offer_kind, title, description, benefit_details, discount_percent,
	media_url, media_type, valid_from, valid_until, capacity_acknowledged, seller_terms_accepted_at
) on public.seller_offer_requests to authenticated;
grant update (
	offer_kind, title, description, benefit_details, discount_percent, media_url, media_type,
	valid_from, valid_until, capacity_acknowledged, seller_terms_accepted_at
) on public.seller_offer_requests to authenticated;

create policy "Sellers and admins read offer requests"
	on public.seller_offer_requests for select to authenticated
	using ((select public.is_seller_owner(seller_profile_id)) or (select public.is_admin()));

create policy "Active sellers create offer request drafts"
	on public.seller_offer_requests for insert to authenticated
	with check ((select public.is_active_seller_owner(seller_profile_id)) and status = 'draft');

create policy "Active sellers edit offer request drafts"
	on public.seller_offer_requests for update to authenticated
	using (
		(select public.is_active_seller_owner(seller_profile_id))
		and status in ('draft', 'changes_requested')
	)
	with check (
		(select public.is_active_seller_owner(seller_profile_id))
		and status in ('draft', 'changes_requested')
	);

grant select, insert, update, delete on public.seller_offer_request_locations to authenticated;
create policy "Sellers and admins read offer request locations"
	on public.seller_offer_request_locations for select to authenticated
	using (
		(select public.is_admin())
		or exists (
			select 1 from public.seller_offer_requests request
			where request.id = request_id and public.is_seller_owner(request.seller_profile_id)
		)
	);
create policy "Active sellers manage draft offer request locations"
	on public.seller_offer_request_locations for all to authenticated
	using (
		exists (
			select 1 from public.seller_offer_requests request
			where request.id = request_id
				and public.is_active_seller_owner(request.seller_profile_id)
				and request.status in ('draft', 'changes_requested')
		)
	)
	with check (
		exists (
			select 1 from public.seller_offer_requests request
			where request.id = request_id
				and public.is_active_seller_owner(request.seller_profile_id)
				and request.status in ('draft', 'changes_requested')
		)
	);

grant select, insert, update, delete on public.seller_offer_request_schedules to authenticated;
create policy "Sellers and admins read offer request schedules"
	on public.seller_offer_request_schedules for select to authenticated
	using (
		(select public.is_admin())
		or exists (
			select 1
			from public.seller_offer_request_locations location
			join public.seller_offer_requests request on request.id = location.request_id
			where location.id = location_id and public.is_seller_owner(request.seller_profile_id)
		)
	);
create policy "Active sellers manage draft offer request schedules"
	on public.seller_offer_request_schedules for all to authenticated
	using (
		exists (
			select 1
			from public.seller_offer_request_locations location
			join public.seller_offer_requests request on request.id = location.request_id
			where location.id = location_id
				and public.is_active_seller_owner(request.seller_profile_id)
				and request.status in ('draft', 'changes_requested')
		)
	)
	with check (
		exists (
			select 1
			from public.seller_offer_request_locations location
			join public.seller_offer_requests request on request.id = location.request_id
			where location.id = location_id
				and public.is_active_seller_owner(request.seller_profile_id)
				and request.status in ('draft', 'changes_requested')
		)
	);

create trigger set_seller_offer_requests_updated_at
	before update on public.seller_offer_requests
	for each row execute function public.set_updated_at();