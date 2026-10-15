alter table public.creator_profiles
	add column audience_city_id text references public.supported_cities (city_id) on delete set null,
	add column published_display_name text,
	add column published_bio text,
	add column published_specialties text[],
	add column published_audience_city_id text references public.supported_cities (city_id) on delete set null,
	add column public_profile_consent_at timestamptz;

update public.creator_profiles
set published_display_name = display_name,
	published_bio = bio,
	published_specialties = specialties,
	published_audience_city_id = audience_city_id
where is_public;

alter table public.creator_profiles drop constraint creator_profiles_check;
alter table public.creator_profiles
	add constraint creator_profiles_publication_check
	check (
		not is_public
		or (published_display_name is not null and published_bio is not null and published_specialties is not null)
	);

alter table public.creator_platform_accounts
	add column is_published boolean not null default false;
update public.creator_platform_accounts account
set is_published = profile.is_public
from public.creator_profiles profile
where profile.id = account.creator_profile_id;

create table public.creator_portfolio_items (
	id uuid primary key default gen_random_uuid(),
	creator_profile_id uuid not null references public.creator_profiles (id) on delete cascade,
	title text not null check (length(btrim(title)) between 3 and 120),
	url text not null check (url ~* '^https://'),
	position smallint not null check (position between 1 and 3),
	is_published boolean not null default false,
	created_at timestamptz not null default now(),
	unique (creator_profile_id, position, is_published)
);
create index creator_portfolio_public_order_idx
	on public.creator_portfolio_items (creator_profile_id, position)
	where is_published;
alter table public.creator_portfolio_items enable row level security;
revoke all on public.creator_portfolio_items from public, anon, authenticated;
grant select (id, creator_profile_id, title, url, position, is_published, created_at)
	on public.creator_portfolio_items to anon, authenticated;
create policy "Public reads creator portfolio; owners and admins read all"
	on public.creator_portfolio_items for select to anon, authenticated
	using (
		(is_published and exists (
			select 1 from public.creator_profiles profile
			where profile.id = creator_profile_id and profile.is_public
		))
		or (select public.is_creator_profile_owner(creator_profile_id))
		or (select public.is_admin())
	);

create table public.creator_collaboration_requests (
	id uuid primary key default gen_random_uuid(),
	creator_profile_id uuid not null references public.creator_profiles (id) on delete restrict,
	seller_profile_id uuid not null references public.seller_profiles (id) on delete restrict,
	title text not null check (length(btrim(title)) between 3 and 120),
	brief text not null check (length(btrim(brief)) between 30 and 2000),
	proposed_compensation text check (proposed_compensation is null or length(btrim(proposed_compensation)) <= 500),
	status text not null default 'pending'
		check (status in ('pending', 'accepted', 'declined', 'withdrawn')),
	creator_response text check (creator_response is null or length(btrim(creator_response)) <= 2000),
	responded_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	check ((status = 'pending') = (responded_at is null))
);
create index creator_collaboration_creator_queue_idx
	on public.creator_collaboration_requests (creator_profile_id, status, created_at desc);
create index creator_collaboration_seller_history_idx
	on public.creator_collaboration_requests (seller_profile_id, created_at desc);
create unique index creator_collaboration_one_pending_pair_idx
	on public.creator_collaboration_requests (creator_profile_id, seller_profile_id)
	where status = 'pending';

alter table public.creator_collaboration_requests enable row level security;
revoke all on public.creator_collaboration_requests from public, anon, authenticated;
grant select on public.creator_collaboration_requests to authenticated;
create policy "Collaboration parties and admins read requests"
	on public.creator_collaboration_requests for select to authenticated
	using (
		(select public.is_creator_profile_owner(creator_profile_id))
		or (select public.is_seller_owner(seller_profile_id))
		or (select public.is_admin())
	);
create trigger set_creator_collaboration_requests_updated_at
	before update on public.creator_collaboration_requests
	for each row execute function public.set_updated_at();

revoke select (display_name, bio, specialties, status, submitted_at, updated_at, audience_city_id, public_profile_consent_at)
	on public.creator_profiles from anon;
grant select (id, slug, is_public, published_display_name, published_bio, published_specialties, published_audience_city_id, created_at)
	on public.creator_profiles to anon, authenticated;
grant select (audience_city_id, public_profile_consent_at)
	on public.creator_profiles to authenticated;
grant select (is_published)
	on public.creator_platform_accounts to anon, authenticated;

drop policy "Public reads creator platforms; owners and admins read all"
	on public.creator_platform_accounts;
create policy "Public reads published creator platforms"
	on public.creator_platform_accounts for select to anon, authenticated
	using (
		(is_published and exists (
			select 1 from public.creator_profiles profile
			where profile.id = creator_profile_id and profile.is_public
		))
		or (select public.is_creator_profile_owner(creator_profile_id))
		or (select public.is_admin())
	);

create or replace function public.save_creator_application(
	p_display_name text,
	p_bio text,
	p_specialties text[],
	p_platform_accounts jsonb,
	p_audience_city_id text,
	p_portfolio_items jsonb,
	p_public_profile_consent boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	current_user_id uuid := (select auth.uid());
	v_creator_profile_id uuid;
	profile_slug text;
begin
	if current_user_id is null
		or (select public.is_admin())
		or exists (select 1 from public.seller_profiles where user_id = current_user_id)
		or not exists (select 1 from auth.users where id = current_user_id and email_confirmed_at is not null) then
		raise exception 'A confirmed visitor account is required.' using errcode = '42501';
	end if;
	if p_public_profile_consent is distinct from true then
		raise exception 'Consent to publish the profile is required.' using errcode = '22023';
	end if;
	if length(btrim(coalesce(p_display_name, ''))) not between 2 and 100
		or length(btrim(coalesce(p_bio, ''))) not between 30 and 2000
		or p_specialties is null or cardinality(p_specialties) not between 1 and 5
		or exists (select 1 from unnest(p_specialties) specialty where length(btrim(specialty)) not between 2 and 50)
		or exists (select 1 from unnest(p_specialties) specialty where lower(btrim(specialty)) not in (
			'food', 'beauty', 'fashion', 'technology', 'travel', 'home', 'fitness', 'family', 'local', 'other'
		))
		or (select count(distinct lower(btrim(specialty))) from unnest(p_specialties) specialty)
			is distinct from cardinality(p_specialties)
		or jsonb_typeof(p_platform_accounts) is distinct from 'array'
		or jsonb_array_length(case when jsonb_typeof(p_platform_accounts) = 'array' then p_platform_accounts else '[]'::jsonb end) not between 1 and 5
		or jsonb_typeof(p_portfolio_items) is distinct from 'array'
		or jsonb_array_length(case when jsonb_typeof(p_portfolio_items) = 'array' then p_portfolio_items else '[]'::jsonb end) not between 0 and 3 then
		raise exception 'Complete the profile, add one to five platform accounts, and no more than three work samples.' using errcode = '22023';
	end if;
	if p_audience_city_id is not null and not exists (
		select 1 from public.supported_cities city
		join public.supported_countries country on country.country_code = city.country_code
		where city.city_id = p_audience_city_id and city.is_enabled and country.is_enabled
	) then
		raise exception 'Choose a currently supported audience city.' using errcode = '22023';
	end if;
	if exists (
		select 1 from jsonb_array_elements(p_platform_accounts) entry
		where jsonb_typeof(entry.value) is distinct from 'object'
			or coalesce(entry.value ->> 'platform', '') not in ('instagram', 'tiktok', 'youtube', 'facebook', 'x')
			or length(btrim(coalesce(entry.value ->> 'handle', ''))) not between 1 and 100
			or length(coalesce(entry.value ->> 'profile_url', '')) > 500
			or split_part(split_part(split_part(coalesce(entry.value ->> 'profile_url', ''), '/', 4), '?', 1), '#', 1) = ''
			or jsonb_typeof(entry.value -> 'follower_count') is distinct from 'number'
			or coalesce(entry.value ->> 'follower_count', '') !~ '^[0-9]{1,10}$'
			or case when coalesce(entry.value ->> 'follower_count', '') ~ '^[0-9]{1,10}$'
				then (entry.value ->> 'follower_count')::numeric > 1000000000 else true end
			or case entry.value ->> 'platform'
				when 'instagram' then lower(coalesce(entry.value ->> 'profile_url', '')) !~ '^https://(www\.)?instagram\.com/'
				when 'tiktok' then lower(coalesce(entry.value ->> 'profile_url', '')) !~ '^https://(www\.)?tiktok\.com/'
				when 'youtube' then lower(coalesce(entry.value ->> 'profile_url', '')) !~ '^https://(www\.)?youtube\.com/'
				when 'facebook' then lower(coalesce(entry.value ->> 'profile_url', '')) !~ '^https://(www\.)?(facebook\.com|fb\.com)/'
				when 'x' then lower(coalesce(entry.value ->> 'profile_url', '')) !~ '^https://(www\.)?(x\.com|twitter\.com)/'
				else true end
	) or (
		select count(distinct entry.value ->> 'platform') from jsonb_array_elements(p_platform_accounts) entry
	) is distinct from jsonb_array_length(p_platform_accounts) then
		raise exception 'Platform links, follower counts, or handles are invalid.' using errcode = '22023';
	end if;
	if exists (
		select 1 from jsonb_array_elements(p_portfolio_items) entry
		where jsonb_typeof(entry.value) is distinct from 'object'
			or length(btrim(coalesce(entry.value ->> 'title', ''))) not between 3 and 120
			or length(coalesce(entry.value ->> 'url', '')) > 500
			or coalesce(entry.value ->> 'url', '') !~* '^https://'
			or split_part(split_part(split_part(coalesce(entry.value ->> 'url', ''), '/', 4), '?', 1), '#', 1) = ''
	) then
		raise exception 'Work sample titles and HTTPS links must be valid.' using errcode = '22023';
	end if;

	select id into v_creator_profile_id
	from public.creator_profiles
	where owner_id = current_user_id
	for update;

	if v_creator_profile_id is not null then
		if exists (select 1 from public.creator_profiles where id = v_creator_profile_id and status = 'suspended') then
			raise exception 'This creator profile is suspended.' using errcode = '55000';
		end if;
		update public.creator_profiles
		set display_name = btrim(p_display_name), bio = btrim(p_bio), specialties = p_specialties,
			audience_city_id = p_audience_city_id, public_profile_consent_at = now(),
			status = 'submitted', submitted_at = now(), reviewed_at = null
		where id = v_creator_profile_id;
	else
		v_creator_profile_id := gen_random_uuid();
		profile_slug := trim(both '-' from regexp_replace(lower(btrim(p_display_name)), '[^a-z0-9]+', '-', 'g'));
		if profile_slug = '' then profile_slug := 'creator'; end if;
		profile_slug := left(profile_slug, 70) || '-' || left(v_creator_profile_id::text, 8);
		insert into public.creator_profiles (
			id, owner_id, slug, display_name, bio, specialties, audience_city_id, public_profile_consent_at
		) values (
			v_creator_profile_id, current_user_id, profile_slug, btrim(p_display_name), btrim(p_bio), p_specialties,
			p_audience_city_id, now()
		);
		insert into public.creator_point_accounts (creator_profile_id) values (v_creator_profile_id);
	end if;

	delete from public.creator_platform_accounts
	where creator_profile_id = v_creator_profile_id and not is_published;
	insert into public.creator_platform_accounts (creator_profile_id, platform, handle, profile_url, follower_count)
	select v_creator_profile_id, account.platform, btrim(account.handle), account.profile_url, account.follower_count
	from jsonb_to_recordset(p_platform_accounts) as account(platform text, handle text, profile_url text, follower_count integer);

	delete from public.creator_portfolio_items
	where creator_profile_id = v_creator_profile_id and not is_published;
	insert into public.creator_portfolio_items (creator_profile_id, title, url, position)
	select v_creator_profile_id, btrim(item.title), item.url, item.position::smallint
	from jsonb_to_recordset(
		(select jsonb_agg(jsonb_build_object('title', entry.value ->> 'title', 'url', entry.value ->> 'url', 'position', entry.ordinality))
		 from jsonb_array_elements(p_portfolio_items) with ordinality as entry(value, ordinality))
	) as item(title text, url text, position integer);

	return v_creator_profile_id;
end;
$$;

create or replace function public.admin_review_creator_profile(
	p_creator_profile_id uuid,
	p_decision text,
	p_review_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	creator_profile public.creator_profiles%rowtype;
	admin_id uuid := (select auth.uid());
	review_note text := nullif(btrim(p_review_note), '');
	new_status text;
begin
	if not (select public.is_admin()) then
		raise exception 'Administrator access is required.' using errcode = '42501';
	end if;
	if p_creator_profile_id is null or p_decision not in ('approve', 'changes_requested', 'reject', 'suspend')
		or length(coalesce(p_review_note, '')) > 2000
		or (p_decision in ('changes_requested', 'reject', 'suspend') and review_note is null) then
		raise exception 'Provide a valid creator review decision and a note when needed.' using errcode = '22023';
	end if;

	select * into creator_profile
	from public.creator_profiles
	where id = p_creator_profile_id
	for update;
	if not found then
		raise exception 'Creator profile not found.' using errcode = 'P0002';
	end if;
	if p_decision = 'suspend' then
		if not creator_profile.is_public then
			raise exception 'Only public creator profiles can be suspended.' using errcode = '55000';
		end if;
		new_status := 'suspended';
	else
		if creator_profile.status <> 'submitted' then
			raise exception 'Only submitted creator profiles can be reviewed.' using errcode = '55000';
		end if;
		new_status := case p_decision
			when 'approve' then 'approved'
			when 'changes_requested' then 'changes_requested'
			else 'rejected'
		end;
	end if;

	if p_decision = 'approve' then
		update public.creator_profiles
		set published_display_name = display_name,
			published_bio = bio,
			published_specialties = specialties,
			published_audience_city_id = audience_city_id,
			status = 'approved', is_public = true, reviewed_at = now()
		where id = p_creator_profile_id;
		delete from public.creator_platform_accounts
		where creator_profile_id = p_creator_profile_id and is_published;
		update public.creator_platform_accounts
		set is_published = true
		where creator_profile_id = p_creator_profile_id and not is_published;
		delete from public.creator_portfolio_items
		where creator_profile_id = p_creator_profile_id and is_published;
		update public.creator_portfolio_items
		set is_published = true
		where creator_profile_id = p_creator_profile_id and not is_published;
	else
		update public.creator_profiles
		set status = new_status,
			is_public = case when p_decision = 'suspend' then false else creator_profile.is_public end,
			reviewed_at = now()
		where id = p_creator_profile_id;
	end if;

	insert into public.creator_profile_reviews (creator_profile_id, decision, review_note, admin_id)
	values (p_creator_profile_id, new_status, review_note, admin_id);
	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values (admin_id, 'creator_profile_' || new_status, 'creator_profile', p_creator_profile_id,
		jsonb_build_object('decision', new_status, 'review_note', review_note));
end;
$$;

create or replace function public.admin_grant_creator_points(
	p_creator_profile_id uuid,
	p_points integer,
	p_reason text,
	p_idempotency_key uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
	admin_id uuid := (select auth.uid());
	transaction_id bigint;
begin
	if not (select public.is_admin()) then
		raise exception 'Administrator access is required.' using errcode = '42501';
	end if;
	if p_creator_profile_id is null or p_points is null or p_points not between 1 and 100000
		or length(btrim(coalesce(p_reason, ''))) not between 5 and 500 or p_idempotency_key is null then
		raise exception 'Enter a valid creator points grant and reason.' using errcode = '22023';
	end if;
	if not exists (
		select 1 from public.creator_profiles where id = p_creator_profile_id and is_public
	) then
		raise exception 'Points can only be granted to a public creator.' using errcode = '55000';
	end if;

	insert into public.creator_point_transactions (
		creator_profile_id, points_delta, reason, idempotency_key, admin_id
	) values (
		p_creator_profile_id, p_points, btrim(p_reason), p_idempotency_key, admin_id
	) on conflict (idempotency_key) do nothing
	returning id into transaction_id;

	if transaction_id is null then return false; end if;
	update public.creator_point_accounts
	set points_balance = points_balance + p_points
	where creator_profile_id = p_creator_profile_id;
	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values (admin_id, 'creator_points_granted', 'creator_profile', p_creator_profile_id,
		jsonb_build_object('points', p_points, 'reason', btrim(p_reason), 'transaction_id', transaction_id));
	return true;
end;
$$;

create function public.seller_create_creator_collaboration_request(
	p_creator_profile_id uuid,
	p_seller_profile_id uuid,
	p_title text,
	p_brief text,
	p_proposed_compensation text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	request_id uuid;
begin
	if not (select public.is_active_seller_owner(p_seller_profile_id)) then
		raise exception 'An active seller account is required.' using errcode = '42501';
	end if;
	if p_creator_profile_id is null
		or length(btrim(coalesce(p_title, ''))) not between 3 and 120
		or length(btrim(coalesce(p_brief, ''))) not between 30 and 2000
		or length(coalesce(p_proposed_compensation, '')) > 500 then
		raise exception 'Enter a title, collaboration brief, and optional compensation under 500 characters.' using errcode = '22023';
	end if;
	if not exists (select 1 from public.creator_profiles where id = p_creator_profile_id and is_public) then
		raise exception 'This creator profile is not accepting requests.' using errcode = '55000';
	end if;
	insert into public.creator_collaboration_requests (
		creator_profile_id, seller_profile_id, title, brief, proposed_compensation
	) values (
		p_creator_profile_id, p_seller_profile_id, btrim(p_title), btrim(p_brief), nullif(btrim(p_proposed_compensation), '')
	) returning id into request_id;
	return request_id;
exception
	when unique_violation then
		raise exception 'You already have a pending request with this creator.' using errcode = '55000';
end;
$$;

create function public.creator_decide_collaboration_request(
	p_request_id uuid,
	p_decision text,
	p_response text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	request public.creator_collaboration_requests%rowtype;
	new_status text;
begin
	if p_request_id is null or p_decision not in ('accept', 'decline')
		or length(coalesce(p_response, '')) > 2000 then
		raise exception 'Invalid collaboration response.' using errcode = '22023';
	end if;
	select * into request
	from public.creator_collaboration_requests
	where id = p_request_id
	for update;
	if not found or not (select public.is_creator_profile_owner(request.creator_profile_id)) then
		raise exception 'Collaboration request not found.' using errcode = '42501';
	end if;
	if request.status <> 'pending' then
		raise exception 'This collaboration request has already been answered.' using errcode = '55000';
	end if;
	new_status := case p_decision when 'accept' then 'accepted' else 'declined' end;
	update public.creator_collaboration_requests
	set status = new_status, creator_response = nullif(btrim(p_response), ''), responded_at = now()
	where id = p_request_id;
end;
$$;

revoke all on function public.save_creator_application(text, text, text[], jsonb, text, jsonb, boolean) from public, anon;
revoke all on function public.seller_create_creator_collaboration_request(uuid, uuid, text, text, text) from public, anon;
revoke all on function public.creator_decide_collaboration_request(uuid, text, text) from public, anon;
grant execute on function public.save_creator_application(text, text, text[], jsonb, text, jsonb, boolean) to authenticated;
grant execute on function public.seller_create_creator_collaboration_request(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.creator_decide_collaboration_request(uuid, text, text) to authenticated;