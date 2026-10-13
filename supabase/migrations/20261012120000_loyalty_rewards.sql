alter table public.profiles
	add column city text,
	add column country_code text,
	add constraint profiles_city_country_pair check (
		(city is null and country_code is null)
			or (nullif(btrim(city), '') is not null and country_code is not null and country_code ~ '^[A-Z]{2}$')
	);

alter table public.marketplace_settings
	add column loyalty_random_draws_enabled boolean not null default false;

create table public.loyalty_offers (
	id uuid primary key default gen_random_uuid(),
	title text not null check (length(btrim(title)) between 3 and 120),
	summary text not null check (length(btrim(summary)) between 3 and 240),
	description text not null default '',
	image_url text not null check (image_url ~* '^https://'),
	terms text not null,
	offer_type text not null check (offer_type in ('participation', 'redemption')),
	selection_method text not null default 'random' check (selection_method in ('random', 'first_come')),
	status text not null default 'draft' check (status in ('draft', 'published', 'paused', 'completed', 'cancelled')),
	minimum_points integer not null check (minimum_points >= 0),
	points_cost integer not null check (points_cost > 0),
	capacity integer not null check (capacity > 0),
	city text,
	country_code text,
	starts_at timestamptz not null,
	ends_at timestamptz not null,
	created_by uuid not null references auth.users (id),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	check (ends_at > starts_at),
	check (
		(city is null and country_code is null)
		or (nullif(btrim(city), '') is not null and country_code is not null and country_code ~ '^[A-Z]{2}$')
	),
	check (offer_type = 'participation' or selection_method = 'first_come')
);

create index loyalty_offers_public_window_idx
	on public.loyalty_offers (status, starts_at, ends_at);
create index loyalty_offers_location_idx
	on public.loyalty_offers (lower(city), country_code)
	where city is not null;

create table public.loyalty_offer_claims (
	id uuid primary key default gen_random_uuid(),
	offer_id uuid not null references public.loyalty_offers (id) on delete restrict,
	visitor_id uuid not null references auth.users (id) on delete cascade,
	claim_type text not null check (claim_type in ('participation', 'redemption')),
	status text not null check (status in ('entered', 'won', 'lost', 'redeemed')),
	points_spent integer not null check (points_spent > 0),
	city text,
	country_code text,
	created_at timestamptz not null default now(),
	unique (offer_id, visitor_id)
);

create index loyalty_offer_claims_offer_status_idx
	on public.loyalty_offer_claims (offer_id, status);
create index loyalty_offer_claims_visitor_created_idx
	on public.loyalty_offer_claims (visitor_id, created_at desc);

create table public.loyalty_accounts (
	visitor_id uuid primary key references auth.users (id) on delete cascade,
	points_balance bigint not null default 0 check (points_balance >= 0),
	updated_at timestamptz not null default now()
);

create table public.loyalty_point_transactions (
	id bigint generated always as identity primary key,
	visitor_id uuid not null references auth.users (id) on delete cascade,
	points_delta integer not null check (points_delta <> 0),
	transaction_type text not null check (
		transaction_type in ('visit_earned', 'participation_spent', 'redemption_spent')
	),
	source_product_id uuid,
	source_product_name text not null default 'Product visit',
	offer_claim_id uuid references public.loyalty_offer_claims (id) on delete cascade,
	idempotency_key text not null,
	created_at timestamptz not null default now(),
	unique (visitor_id, idempotency_key),
	check (
		(transaction_type = 'visit_earned' and points_delta > 0 and source_product_id is not null and length(btrim(source_product_name)) > 0 and offer_claim_id is null)
		or (transaction_type <> 'visit_earned' and points_delta < 0 and source_product_id is null and offer_claim_id is not null)
	)
);

create index loyalty_point_transactions_visitor_created_idx
	on public.loyalty_point_transactions (visitor_id, created_at desc);
create unique index loyalty_point_transactions_one_product_point
	on public.loyalty_point_transactions (visitor_id, source_product_id)
	where transaction_type = 'visit_earned' and source_product_id is not null;
create unique index loyalty_point_transactions_one_offer_charge
	on public.loyalty_point_transactions (offer_claim_id)
	where offer_claim_id is not null;

insert into public.loyalty_point_transactions (
	visitor_id,
	points_delta,
	transaction_type,
	source_product_id,
	source_product_name,
	idempotency_key
)
select
	point.visitor_id,
	1,
	'visit_earned',
	point.product_id,
	product.name,
	'visit:' || point.product_id::text
from public.visitor_product_points point
join public.products product on product.id = point.product_id
join auth.users account_user
	on account_user.id = point.visitor_id
where account_user.email_confirmed_at is not null
	and not coalesce((account_user.raw_app_meta_data ->> 'role') = 'admin', false)
	and not exists (
		select 1 from public.seller_profiles seller
		where seller.user_id = point.visitor_id
	)
on conflict (visitor_id, idempotency_key) do nothing;

insert into public.loyalty_accounts (visitor_id, points_balance)
select account_user.id, coalesce(sum(transaction.points_delta), 0)::bigint
from auth.users account_user
left join public.loyalty_point_transactions transaction
	on transaction.visitor_id = account_user.id
group by account_user.id
on conflict (visitor_id) do nothing;

create or replace function public.ensure_loyalty_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	insert into public.loyalty_accounts (visitor_id)
	values (new.id)
	on conflict (visitor_id) do nothing;
	return new;
end;
$$;

create trigger create_loyalty_account_for_profile
	after insert on public.profiles
	for each row execute function public.ensure_loyalty_account();

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
	if not exists (
		select 1 from auth.users account_user
		where account_user.id = new.visitor_id
			and account_user.email_confirmed_at is not null
	) or exists (
		select 1 from auth.users account_user
		where account_user.id = new.visitor_id
			and coalesce((account_user.raw_app_meta_data ->> 'role') = 'admin', false)
	) or exists (
		select 1 from public.seller_profiles seller
		where seller.user_id = new.visitor_id
	) then
		return new;
	end if;
	select product.name into product_name
	from public.products product
	where product.id = new.product_id;

	insert into public.loyalty_point_transactions (
		visitor_id,
		points_delta,
		transaction_type,
		source_product_id,
		source_product_name,
		idempotency_key
	)
	values (
		new.visitor_id,
		1,
		'visit_earned',
		new.product_id,
		coalesce(product_name, 'Product visit'),
		'visit:' || new.product_id::text
	)
	on conflict (visitor_id, idempotency_key) do nothing
	returning id into new_transaction_id;

	if new_transaction_id is not null then
		insert into public.loyalty_accounts (visitor_id, points_balance)
		values (new.visitor_id, 1)
		on conflict (visitor_id) do update
		set points_balance = public.loyalty_accounts.points_balance + 1,
			updated_at = now();
	end if;

	return new;
end;
$$;

create trigger award_loyalty_point_for_visitor_product
	after insert on public.visitor_product_points
	for each row execute function public.record_visitor_loyalty_point();

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
			from public.loyalty_offers offer
			where offer.city is not null
				and offer.status = 'published'
				and offer.starts_at <= now()
				and offer.ends_at > now()
				and (
					(lower(btrim(offer.city)) = lower(btrim(old.city)) and offer.country_code = old.country_code)
					or (lower(btrim(offer.city)) = lower(btrim(new.city)) and offer.country_code = new.country_code)
				)
		) then
		raise exception 'Your city cannot be changed while a location-specific rewards offer is active.'
			using errcode = '55000';
	end if;

	return new;
end;
$$;

create trigger normalize_and_lock_profile_city
	before insert or update of city, country_code on public.profiles
	for each row execute function public.normalize_and_lock_profile_city();

create or replace function public.is_eligible_visitor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		from auth.users account_user
		where account_user.id = (select auth.uid())
			and account_user.email_confirmed_at is not null
			and not coalesce((account_user.raw_app_meta_data ->> 'role') = 'admin', false)
	)
	and not (select public.is_admin())
	and not exists (
		select 1
		from public.seller_profiles seller
		where seller.user_id = (select auth.uid())
	);
$$;

create or replace function public.get_visitor_loyalty_points()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(account.points_balance, 0)
	from public.loyalty_accounts account
	where account.visitor_id = (select auth.uid())
		and (select public.is_eligible_visitor());
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
		from public.loyalty_offers offer
		join public.profiles visitor on visitor.id = (select auth.uid())
		where offer.city is not null
			and offer.status = 'published'
			and offer.starts_at <= now()
			and offer.ends_at > now()
			and lower(btrim(visitor.city)) = lower(btrim(offer.city))
			and visitor.country_code = offer.country_code
	);
$$;

create or replace function public.get_visitor_loyalty_summary()
returns table (points_balance bigint, points_earned bigint, points_spent bigint)
language sql
stable
security definer
set search_path = ''
as $$
	select
		account.points_balance,
		coalesce(sum(transaction.points_delta) filter (where transaction.points_delta > 0), 0)::bigint,
		coalesce(-sum(transaction.points_delta) filter (where transaction.points_delta < 0), 0)::bigint
	from public.loyalty_accounts account
	left join public.loyalty_point_transactions transaction
		on transaction.visitor_id = account.visitor_id
	where account.visitor_id = (select auth.uid())
		and (select public.is_eligible_visitor())
	group by account.points_balance;
$$;

create or replace function public.get_visitor_loyalty_activity()
returns table (
	id bigint,
	created_at timestamptz,
	points_delta integer,
	transaction_type text,
	product_name text,
	offer_title text
)
language sql
stable
security definer
set search_path = ''
as $$
	select
		transaction.id,
		transaction.created_at,
		transaction.points_delta,
		transaction.transaction_type,
		transaction.source_product_name,
		offer.title
	from public.loyalty_point_transactions transaction
	left join public.loyalty_offer_claims claim on claim.id = transaction.offer_claim_id
	left join public.loyalty_offers offer on offer.id = claim.offer_id
	where transaction.visitor_id = (select auth.uid())
		and (select public.is_eligible_visitor())
	order by transaction.created_at desc
	limit 25;
$$;

create or replace function public.get_visitor_loyalty_offers()
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
	city text,
	country_code text,
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
		offer.capacity,
		count(claim.id)::bigint,
		case
			when offer.offer_type = 'participation' and offer.selection_method = 'random' then offer.capacity::bigint
			else greatest(offer.capacity - count(claim.id), 0)::bigint
		end,
		offer.city,
		offer.country_code,
		offer.starts_at,
		offer.ends_at,
		coalesce(bool_or(claim.visitor_id = (select auth.uid())), false)
	from public.loyalty_offers offer
	join public.profiles visitor on visitor.id = (select auth.uid())
	left join public.loyalty_offer_claims claim on claim.offer_id = offer.id
	where (select public.is_eligible_visitor())
		and offer.status = 'published'
		and offer.starts_at <= now()
		and offer.ends_at > now()
		and (
			offer.city is null
			or (
				lower(btrim(visitor.city)) = lower(btrim(offer.city))
				and visitor.country_code = offer.country_code
			)
		)
		and (
			offer.selection_method <> 'random'
			or exists (
				select 1 from public.marketplace_settings
				where singleton = true and loyalty_random_draws_enabled
			)
		)
	group by offer.id
	order by offer.ends_at asc, offer.created_at desc;
$$;

create or replace function public.get_visitor_offer_history()
returns table (
	offer_id uuid,
	title text,
	claim_type text,
	status text,
	points_spent integer,
	created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
	select claim.offer_id, offer.title, claim.claim_type, claim.status, claim.points_spent, claim.created_at
	from public.loyalty_offer_claims claim
	join public.loyalty_offers offer on offer.id = claim.offer_id
	where claim.visitor_id = (select auth.uid())
		and (select public.is_eligible_visitor())
	order by claim.created_at desc
	limit 50;
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
	p_capacity integer,
	p_city text,
	p_country_code text,
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
	clean_city text := nullif(btrim(p_city), '');
	clean_country text := upper(nullif(btrim(p_country_code), ''));
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
		or p_capacity < 1
		or p_starts_at is null
		or p_ends_at is null
		or p_ends_at <= p_starts_at
		or ((clean_city is null) is distinct from (clean_country is null))
		or (clean_country is not null and clean_country !~ '^[A-Z]{2}$') then
		raise exception 'Offer details, dates, points, location, or image are invalid.' using errcode = '22023';
	end if;

	if p_offer_id is null then
		insert into public.loyalty_offers (
			title, summary, description, image_url, terms, offer_type,
			selection_method, minimum_points, points_cost, capacity, city,
			country_code, starts_at, ends_at, created_by
		)
		values (
			btrim(p_title), btrim(p_summary), btrim(p_description), btrim(p_image_url), btrim(p_terms), p_offer_type,
			p_selection_method, p_minimum_points, p_points_cost, p_capacity, clean_city,
			clean_country, p_starts_at, p_ends_at, (select auth.uid())
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
			capacity = p_capacity,
			city = clean_city,
			country_code = clean_country,
			starts_at = p_starts_at,
			ends_at = p_ends_at,
			updated_at = now()
		where offer.id = p_offer_id
		returning id into saved_offer_id;
	end if;

	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values (
		(select auth.uid()),
		case when p_offer_id is null then 'loyalty_offer_created' else 'loyalty_offer_updated' end,
		'loyalty_offer',
		saved_offer_id,
		jsonb_build_object('offer_type', p_offer_type, 'title', btrim(p_title), 'city', clean_city, 'country_code', clean_country)
	);
	return saved_offer_id;
end;
$$;

create or replace function public.admin_set_loyalty_random_draws_enabled(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not (select public.is_admin()) then
		raise exception 'Administrator access is required.' using errcode = '42501';
	end if;
	if not p_enabled and exists (
		select 1 from public.loyalty_offers offer
		where offer.offer_type = 'participation'
			and offer.selection_method = 'random'
			and offer.status in ('published', 'paused')
	) then
		raise exception 'Complete or cancel active random offers before disabling random draws.' using errcode = '55000';
	end if;

	update public.marketplace_settings
	set loyalty_random_draws_enabled = p_enabled,
		updated_at = now()
	where singleton = true;

	insert into public.admin_audit_logs (actor_id, action, entity_type, details)
	values (
		(select auth.uid()),
		case when p_enabled then 'loyalty_random_draws_enabled' else 'loyalty_random_draws_disabled' end,
		'loyalty_settings',
		jsonb_build_object('random_draws_enabled', p_enabled)
	);
end;
$$;

create or replace function public.admin_set_loyalty_offer_status(p_offer_id uuid, p_next_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	offer public.loyalty_offers%rowtype;
begin
	if not (select public.is_admin()) then
		raise exception 'Administrator access is required.' using errcode = '42501';
	end if;
	if p_next_status not in ('published', 'paused') then
		raise exception 'Unsupported offer status change.' using errcode = '22023';
	end if;

	select * into offer
	from public.loyalty_offers
	where id = p_offer_id
	for update;
	if not found then
		raise exception 'Offer not found.' using errcode = 'P0002';
	end if;
	if p_next_status = 'published' then
		if offer.status not in ('draft', 'paused') then
			raise exception 'Only draft or paused offers can be published.' using errcode = '55000';
		end if;
		if offer.ends_at <= now() then
			raise exception 'Expired offers cannot be published.' using errcode = '55000';
		end if;
		if offer.selection_method = 'random'
			and not exists (
				select 1 from public.marketplace_settings
				where singleton = true and loyalty_random_draws_enabled
			) then
			raise exception 'An administrator must enable random draws before publishing this offer.' using errcode = '55000';
		end if;
	elsif offer.status <> 'published' then
		raise exception 'Only published offers can be paused.' using errcode = '55000';
	end if;

	update public.loyalty_offers
	set status = p_next_status, updated_at = now()
	where id = p_offer_id;

	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values (
		(select auth.uid()),
		case when p_next_status = 'published' then 'loyalty_offer_published' else 'loyalty_offer_paused' end,
		'loyalty_offer',
		p_offer_id,
		jsonb_build_object('offer_type', offer.offer_type, 'selection_method', offer.selection_method)
	);
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
		and not exists (
			select 1 from public.seller_profiles seller
			where seller.user_id = account.visitor_id
		)
		and not exists (
			select 1 from public.loyalty_offer_claims claim
			where claim.offer_id = offer.id and claim.visitor_id = account.visitor_id
		)
		and (
			offer.city is null
			or (
				lower(btrim(profile.city)) = lower(btrim(offer.city))
				and profile.country_code = offer.country_code
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
				and not exists (
					select 1 from public.seller_profiles seller
					where seller.user_id = account.visitor_id
				)
				and not exists (
					select 1 from public.loyalty_offer_claims claim
					where claim.offer_id = offer.id and claim.visitor_id = account.visitor_id
				)
				and (
					offer.city is null
					or (
						lower(btrim(profile.city)) = lower(btrim(offer.city))
						and profile.country_code = offer.country_code
					)
				)
		)::bigint,
		(
			select count(*) from public.loyalty_offer_claims claim
			where claim.offer_id = offer.id
		)::bigint,
		(
			select count(*) from public.loyalty_offer_claims claim
			where claim.offer_id = offer.id and claim.status in ('won', 'redeemed')
		)::bigint,
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
begin
	if not (select public.is_eligible_visitor()) then
		raise exception 'A confirmed visitor account is required.' using errcode = '42501';
	end if;

	select * into offer
	from public.loyalty_offers
	where id = p_offer_id
	for update;
	if not found
		or offer.status <> 'published'
		or offer.starts_at > now()
		or offer.ends_at <= now() then
		raise exception 'This offer is not available.' using errcode = '55000';
	end if;
	if offer.selection_method = 'random'
		and not exists (
			select 1 from public.marketplace_settings
			where singleton = true and loyalty_random_draws_enabled
		) then
		raise exception 'This offer is not available.' using errcode = '55000';
	end if;

	select profile.city, profile.country_code into visitor_city, visitor_country
	from public.profiles profile where profile.id = current_visitor_id;
	if offer.city is not null and (
		lower(btrim(visitor_city)) is distinct from lower(btrim(offer.city))
		or visitor_country is distinct from offer.country_code
	) then
		raise exception 'This offer is only available in its listed location.' using errcode = '42501';
	end if;

	select claim.id, claim.status into claim_id, claim_status
	from public.loyalty_offer_claims claim
	where claim.offer_id = offer.id and claim.visitor_id = current_visitor_id;
	if claim_id is not null then
		select account.points_balance into account_balance
		from public.loyalty_accounts account
		where account.visitor_id = current_visitor_id;
		return jsonb_build_object(
			'alreadyJoined', true,
			'claimId', claim_id,
			'status', claim_status,
			'pointsBalance', account_balance
		);
	end if;

	select account.points_balance into account_balance
	from public.loyalty_accounts account
	where account.visitor_id = current_visitor_id
	for update;
	if account_balance is null or account_balance < offer.minimum_points or account_balance < offer.points_cost then
		raise exception 'You do not have enough points for this offer.' using errcode = '23514';
	end if;

	if offer.offer_type = 'redemption' then
		select count(*) into claim_count
		from public.loyalty_offer_claims claim
		where claim.offer_id = offer.id and claim.claim_type = 'redemption';
		if claim_count >= offer.capacity then
			raise exception 'This offer has been fully claimed.' using errcode = '55000';
		end if;
		claim_status := 'redeemed';
	else
		if offer.selection_method = 'first_come' then
			select count(*) into claim_count
			from public.loyalty_offer_claims claim
			where claim.offer_id = offer.id and claim.status = 'won';
			if claim_count >= offer.capacity then
				raise exception 'This offer has been fully claimed.' using errcode = '55000';
			end if;
			claim_status := 'won';
		else
			claim_status := 'entered';
		end if;
	end if;

	insert into public.loyalty_offer_claims (
		offer_id, visitor_id, claim_type, status, points_spent, city, country_code
	)
	values (
		offer.id, current_visitor_id, offer.offer_type, claim_status, offer.points_cost, visitor_city, visitor_country
	)
	on conflict (offer_id, visitor_id) do nothing
	returning id into claim_id;

	if claim_id is null then
		return jsonb_build_object('alreadyJoined', true, 'pointsBalance', account_balance);
	end if;

	update public.loyalty_accounts
	set points_balance = points_balance - offer.points_cost,
		updated_at = now()
	where loyalty_accounts.visitor_id = current_visitor_id;

	insert into public.loyalty_point_transactions (
		visitor_id, points_delta, transaction_type, offer_claim_id, idempotency_key
	)
	values (
		current_visitor_id,
		-offer.points_cost,
		case when offer.offer_type = 'participation' then 'participation_spent' else 'redemption_spent' end,
		claim_id,
		'offer:' || claim_id::text
	);

	return jsonb_build_object(
		'alreadyJoined', false,
		'claimId', claim_id,
		'status', claim_status,
		'pointsBalance', account_balance - offer.points_cost
	);
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
	if not (select public.is_admin()) then
		raise exception 'Administrator access is required.' using errcode = '42501';
	end if;
	select * into offer
	from public.loyalty_offers
	where id = p_offer_id
	for update;
	if not found
		or offer.offer_type <> 'participation'
		or offer.selection_method <> 'random'
		or offer.status not in ('published', 'paused')
		or offer.ends_at > now() then
		raise exception 'This offer is not ready for a draw.' using errcode = '55000';
	end if;
	if not exists (
		select 1 from public.marketplace_settings
		where singleton = true and loyalty_random_draws_enabled
	) then
		raise exception 'Random draws are disabled.' using errcode = '55000';
	end if;

	with chosen as materialized (
		select claim.id
		from public.loyalty_offer_claims claim
		where claim.offer_id = p_offer_id and claim.status = 'entered'
		order by gen_random_uuid()
		limit offer.capacity
	), updated as (
		update public.loyalty_offer_claims claim
		set status = case when chosen.id is null then 'lost' else 'won' end
		from (
			select claim.id as entry_id
			from public.loyalty_offer_claims claim
			where claim.offer_id = p_offer_id and claim.status = 'entered'
		) entrants
		left join chosen on chosen.id = entrants.entry_id
		where claim.id = entrants.entry_id
		returning claim.status
	)
	select count(*) filter (where status = 'won')::integer
	into winner_count
	from updated;

	update public.loyalty_offers
	set status = 'completed', updated_at = now()
	where id = p_offer_id;

	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values (
		(select auth.uid()),
		'loyalty_offer_draw_completed',
		'loyalty_offer',
		p_offer_id,
		jsonb_build_object('winner_count', winner_count, 'capacity', offer.capacity)
	);
	return winner_count;
end;
$$;

create or replace function public.admin_get_loyalty_offer_recipients(p_offer_id uuid)
returns table (
	visitor_id uuid,
	email text,
	display_name text,
	status text,
	points_spent integer,
	city text,
	country_code text,
	created_at timestamptz
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
	select
		claim.visitor_id,
		account_user.email::text,
		coalesce(profile.display_name, account_user.raw_user_meta_data ->> 'display_name')::text,
		claim.status,
		claim.points_spent,
		claim.city,
		claim.country_code,
		claim.created_at
	from public.loyalty_offer_claims claim
	join auth.users account_user on account_user.id = claim.visitor_id
	left join public.profiles profile on profile.id = claim.visitor_id
	where claim.offer_id = p_offer_id
		and claim.status in ('won', 'redeemed')
	order by claim.created_at asc;
end;
$$;

alter table public.loyalty_offers enable row level security;
alter table public.loyalty_offer_claims enable row level security;
alter table public.loyalty_accounts enable row level security;
alter table public.loyalty_point_transactions enable row level security;

grant select on public.loyalty_offers, public.loyalty_offer_claims, public.loyalty_accounts, public.loyalty_point_transactions to authenticated;
grant update (city, country_code) on public.profiles to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.loyalty_offers from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.loyalty_offer_claims from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.loyalty_accounts from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.loyalty_point_transactions from anon, authenticated;

create policy "Eligible visitors read active loyalty offers"
	on public.loyalty_offers for select to authenticated
	using (
		(select public.is_eligible_visitor())
		and status = 'published'
		and starts_at <= now()
		and ends_at > now()
		and (
			selection_method <> 'random'
			or exists (
				select 1 from public.marketplace_settings
				where singleton = true and loyalty_random_draws_enabled
			)
		)
	);

create policy "Admins manage loyalty offers"
	on public.loyalty_offers for all to authenticated
	using ((select public.is_admin()))
	with check ((select public.is_admin()));

create policy "Users and admins read loyalty claims"
	on public.loyalty_offer_claims for select to authenticated
	using (visitor_id = (select auth.uid()) or (select public.is_admin()));

create policy "Users and admins read loyalty balances"
	on public.loyalty_accounts for select to authenticated
	using (visitor_id = (select auth.uid()) or (select public.is_admin()));

create policy "Users and admins read loyalty transactions"
	on public.loyalty_point_transactions for select to authenticated
	using (visitor_id = (select auth.uid()) or (select public.is_admin()));

revoke all on function public.ensure_loyalty_account() from public, anon, authenticated;
revoke all on function public.record_visitor_loyalty_point() from public, anon, authenticated;
revoke all on function public.normalize_and_lock_profile_city() from public, anon, authenticated;
revoke all on function public.is_eligible_visitor() from public, anon;
revoke all on function public.get_visitor_loyalty_points() from public, anon;
revoke all on function public.is_visitor_city_locked() from public, anon;
revoke all on function public.get_visitor_loyalty_summary() from public, anon;
revoke all on function public.get_visitor_loyalty_activity() from public, anon;
revoke all on function public.get_visitor_loyalty_offers() from public, anon;
revoke all on function public.get_visitor_offer_history() from public, anon;
revoke all on function public.admin_save_loyalty_offer(uuid, text, text, text, text, text, text, text, integer, integer, integer, text, text, timestamptz, timestamptz) from public, anon;
revoke all on function public.admin_set_loyalty_random_draws_enabled(boolean) from public, anon;
revoke all on function public.admin_set_loyalty_offer_status(uuid, text) from public, anon;
revoke all on function public.admin_count_loyalty_offer_eligible(uuid) from public, anon;
revoke all on function public.admin_get_loyalty_offer_metrics() from public, anon;
revoke all on function public.join_loyalty_offer(uuid) from public, anon;
revoke all on function public.admin_run_loyalty_offer_draw(uuid) from public, anon;
revoke all on function public.admin_get_loyalty_offer_recipients(uuid) from public, anon;

grant execute on function public.is_eligible_visitor() to authenticated;
grant execute on function public.get_visitor_loyalty_points() to authenticated;
grant execute on function public.is_visitor_city_locked() to authenticated;
grant execute on function public.get_visitor_loyalty_summary() to authenticated;
grant execute on function public.get_visitor_loyalty_activity() to authenticated;
grant execute on function public.get_visitor_loyalty_offers() to authenticated;
grant execute on function public.get_visitor_offer_history() to authenticated;
grant execute on function public.admin_save_loyalty_offer(uuid, text, text, text, text, text, text, text, integer, integer, integer, text, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.admin_set_loyalty_random_draws_enabled(boolean) to authenticated;
grant execute on function public.admin_set_loyalty_offer_status(uuid, text) to authenticated;
grant execute on function public.admin_count_loyalty_offer_eligible(uuid) to authenticated;
grant execute on function public.admin_get_loyalty_offer_metrics() to authenticated;
grant execute on function public.join_loyalty_offer(uuid) to authenticated;
grant execute on function public.admin_run_loyalty_offer_draw(uuid) to authenticated;
grant execute on function public.admin_get_loyalty_offer_recipients(uuid) to authenticated;