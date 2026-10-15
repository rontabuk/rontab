create table public.creator_profiles (
	id uuid primary key default gen_random_uuid(),
	owner_id uuid not null unique references public.profiles (id) on delete cascade,
	slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	display_name text not null check (length(btrim(display_name)) between 2 and 100),
	bio text not null check (length(btrim(bio)) between 30 and 2000),
	specialties text[] not null check (cardinality(specialties) between 1 and 5),
	status text not null default 'submitted'
		check (status in ('draft', 'submitted', 'changes_requested', 'approved', 'rejected', 'suspended')),
	is_public boolean not null default false,
	submitted_at timestamptz not null default now(),
	reviewed_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	check (is_public = (status = 'approved'))
);

create index creator_profiles_review_queue_idx
	on public.creator_profiles (submitted_at asc)
	where status = 'submitted';
create index creator_profiles_public_directory_idx
	on public.creator_profiles (updated_at desc)
	where is_public;

create table public.creator_platform_accounts (
	id uuid primary key default gen_random_uuid(),
	creator_profile_id uuid not null references public.creator_profiles (id) on delete cascade,
	platform text not null check (platform in ('instagram', 'tiktok', 'youtube', 'facebook', 'x')),
	handle text not null check (length(btrim(handle)) between 1 and 100),
	profile_url text not null check (profile_url ~* '^https://'),
	follower_count integer not null check (follower_count between 0 and 1000000000),
	followers_updated_at timestamptz not null default now(),
	created_at timestamptz not null default now(),
	unique (creator_profile_id, platform)
);

create table public.creator_profile_reviews (
	id bigint generated always as identity primary key,
	creator_profile_id uuid not null references public.creator_profiles (id) on delete cascade,
	decision text not null check (decision in ('approved', 'changes_requested', 'rejected', 'suspended')),
	review_note text check (review_note is null or length(review_note) <= 2000),
	admin_id uuid not null references auth.users (id) on delete restrict,
	created_at timestamptz not null default now()
);
create index creator_profile_reviews_latest_idx
	on public.creator_profile_reviews (creator_profile_id, created_at desc);

create table public.creator_point_accounts (
	creator_profile_id uuid primary key references public.creator_profiles (id) on delete cascade,
	points_balance integer not null default 0 check (points_balance >= 0),
	updated_at timestamptz not null default now()
);

create table public.creator_point_transactions (
	id bigint generated always as identity primary key,
	creator_profile_id uuid not null references public.creator_profiles (id) on delete restrict,
	points_delta integer not null check (points_delta > 0),
	reason text not null check (length(btrim(reason)) between 5 and 500),
	idempotency_key uuid not null unique,
	admin_id uuid not null references auth.users (id) on delete restrict,
	created_at timestamptz not null default now()
);
create index creator_point_transactions_history_idx
	on public.creator_point_transactions (creator_profile_id, created_at desc);

create function public.is_creator_profile_owner(p_creator_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1 from public.creator_profiles
		where id = p_creator_profile_id and owner_id = (select auth.uid())
	);
$$;

alter table public.creator_profiles enable row level security;
alter table public.creator_platform_accounts enable row level security;
alter table public.creator_profile_reviews enable row level security;
alter table public.creator_point_accounts enable row level security;
alter table public.creator_point_transactions enable row level security;

revoke all on public.creator_profiles, public.creator_platform_accounts, public.creator_profile_reviews,
	public.creator_point_accounts, public.creator_point_transactions from public, anon, authenticated;
grant select (id, slug, display_name, bio, specialties, status, is_public, submitted_at, created_at, updated_at)
	on public.creator_profiles to anon, authenticated;
grant select (id, creator_profile_id, platform, handle, profile_url, follower_count, followers_updated_at)
	on public.creator_platform_accounts to anon, authenticated;
grant select on public.creator_profile_reviews to authenticated;
grant select on public.creator_point_accounts, public.creator_point_transactions to authenticated;
revoke all on function public.is_creator_profile_owner(uuid) from public;
grant execute on function public.is_creator_profile_owner(uuid) to anon, authenticated;

create policy "Public reads approved creators; owners and admins read all"
	on public.creator_profiles for select to anon, authenticated
	using (is_public or (select public.is_creator_profile_owner(id)) or (select public.is_admin()));
create policy "Public reads creator platforms; owners and admins read all"
	on public.creator_platform_accounts for select to anon, authenticated
	using (
		exists (select 1 from public.creator_profiles profile where profile.id = creator_profile_id and profile.is_public)
		or (select public.is_creator_profile_owner(creator_profile_id))
		or (select public.is_admin())
	);
create policy "Owners and admins read creator review notes"
	on public.creator_profile_reviews for select to authenticated
	using ((select public.is_creator_profile_owner(creator_profile_id)) or (select public.is_admin()));
create policy "Owners and admins read creator point accounts"
	on public.creator_point_accounts for select to authenticated
	using ((select public.is_creator_profile_owner(creator_profile_id)) or (select public.is_admin()));
create policy "Owners and admins read creator point history"
	on public.creator_point_transactions for select to authenticated
	using ((select public.is_creator_profile_owner(creator_profile_id)) or (select public.is_admin()));

create trigger set_creator_profiles_updated_at
	before update on public.creator_profiles
	for each row execute function public.set_updated_at();
create trigger set_creator_point_accounts_updated_at
	before update on public.creator_point_accounts
	for each row execute function public.set_updated_at();

create function public.get_my_creator_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
	select id from public.creator_profiles where owner_id = (select auth.uid());
$$;

create function public.save_creator_application(
	p_display_name text,
	p_bio text,
	p_specialties text[],
	p_platform_accounts jsonb
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
		or jsonb_array_length(case when jsonb_typeof(p_platform_accounts) = 'array' then p_platform_accounts else '[]'::jsonb end) not between 1 and 5 then
		raise exception 'Complete the creator profile and add between one and five platform accounts.' using errcode = '22023';
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
			status = 'submitted', is_public = false, submitted_at = now(), reviewed_at = null
		where id = v_creator_profile_id;
	else
		v_creator_profile_id := gen_random_uuid();
		profile_slug := trim(both '-' from regexp_replace(lower(btrim(p_display_name)), '[^a-z0-9]+', '-', 'g'));
		if profile_slug = '' then profile_slug := 'creator'; end if;
		profile_slug := left(profile_slug, 70) || '-' || left(v_creator_profile_id::text, 8);
		insert into public.creator_profiles (id, owner_id, slug, display_name, bio, specialties)
		values (v_creator_profile_id, current_user_id, profile_slug, btrim(p_display_name), btrim(p_bio), p_specialties);
		insert into public.creator_point_accounts (creator_profile_id) values (v_creator_profile_id);
	end if;

	delete from public.creator_platform_accounts where creator_profile_id = v_creator_profile_id;
	insert into public.creator_platform_accounts (creator_profile_id, platform, handle, profile_url, follower_count)
	select v_creator_profile_id, account.platform, btrim(account.handle), account.profile_url, account.follower_count
	from jsonb_to_recordset(p_platform_accounts) as account(platform text, handle text, profile_url text, follower_count integer);

	return v_creator_profile_id;
end;
$$;

create function public.admin_review_creator_profile(
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
		if creator_profile.status <> 'approved' then
			raise exception 'Only approved creator profiles can be suspended.' using errcode = '55000';
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

	update public.creator_profiles
	set status = new_status, is_public = (new_status = 'approved'), reviewed_at = now()
	where id = p_creator_profile_id;
	insert into public.creator_profile_reviews (creator_profile_id, decision, review_note, admin_id)
	values (p_creator_profile_id, new_status, review_note, admin_id);
	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values (admin_id, 'creator_profile_' || new_status, 'creator_profile', p_creator_profile_id,
		jsonb_build_object('decision', new_status, 'review_note', review_note));
end;
$$;

create function public.admin_grant_creator_points(
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
		select 1 from public.creator_profiles where id = p_creator_profile_id and status = 'approved'
	) then
		raise exception 'Points can only be granted to an approved creator.' using errcode = '55000';
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

revoke all on function public.get_my_creator_profile_id() from public, anon;
revoke all on function public.save_creator_application(text, text, text[], jsonb) from public, anon;
revoke all on function public.admin_review_creator_profile(uuid, text, text) from public, anon;
revoke all on function public.admin_grant_creator_points(uuid, integer, text, uuid) from public, anon;
grant execute on function public.get_my_creator_profile_id() to authenticated;
grant execute on function public.save_creator_application(text, text, text[], jsonb) to authenticated;
grant execute on function public.admin_review_creator_profile(uuid, text, text) to authenticated;
grant execute on function public.admin_grant_creator_points(uuid, integer, text, uuid) to authenticated;