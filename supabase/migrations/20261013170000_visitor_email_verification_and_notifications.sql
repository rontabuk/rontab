-- Visitors can use their account straight after registering; email ownership is tracked separately
-- and is still required before loyalty points and reward offers apply.
alter table public.profiles add column email_verified_at timestamptz;

update public.profiles profile
set email_verified_at = account_user.email_confirmed_at
from auth.users account_user
where account_user.id = profile.id
	and account_user.email_confirmed_at is not null;

create or replace function public.visitor_mark_email_verified()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
	current_user_id uuid := (select auth.uid());
begin
	if current_user_id is null then
		raise exception 'Sign in to confirm your email.' using errcode = '42501';
	end if;

	-- Only a session that was just opened from an emailed link proves inbox ownership.
	if not exists (
		select 1
		from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) entry
		where entry ->> 'method' in ('otp', 'magiclink', 'email/signup', 'email_change', 'invite')
			and (entry ->> 'timestamp')::bigint >= extract(epoch from now())::bigint - 900
	) then
		raise exception 'Open the confirmation link from your email to confirm it.' using errcode = '42501';
	end if;

	update public.profiles
	set email_verified_at = coalesce(email_verified_at, now())
	where id = current_user_id;

	return found;
end;
$$;

revoke all on function public.visitor_mark_email_verified() from public, anon;
grant execute on function public.visitor_mark_email_verified() to authenticated;

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
			and profile.email_verified_at is not null
			and country.is_enabled
			and not coalesce((account_user.raw_app_meta_data ->> 'role') = 'admin', false)
	)
	and not exists (
		select 1 from public.seller_profiles seller where seller.user_id = p_visitor_id
	);
$$;

revoke all on function public.is_supported_loyalty_visitor(uuid) from public, anon, authenticated;

create or replace function public.admin_get_loyalty_offer_city_metrics()
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
				and profile.email_verified_at is not null
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

revoke all on function public.admin_get_loyalty_offer_city_metrics() from public, anon;
grant execute on function public.admin_get_loyalty_offer_city_metrics() to authenticated;

-- Site notifications: admin announcements plus a per-user "last opened" marker for unread counts.
create table public.site_announcements (
	id uuid primary key default gen_random_uuid(),
	title text not null check (char_length(title) between 1 and 120),
	body text not null check (char_length(body) between 1 and 500),
	link_url text check (link_url is null or link_url ~ '^(https://|/)'),
	audience text not null default 'everyone' check (audience in ('everyone', 'visitors', 'sellers')),
	is_active boolean not null default true,
	created_by uuid references auth.users (id) on delete set null,
	created_at timestamptz not null default now()
);

create index site_announcements_created_at_idx on public.site_announcements (created_at desc) where is_active;

alter table public.site_announcements enable row level security;
revoke all on public.site_announcements from anon, authenticated;
grant select on public.site_announcements to anon, authenticated;

create policy "Readers see announcements meant for them"
	on public.site_announcements for select to anon, authenticated
	using (
		(select public.is_admin())
		or (
			is_active
			and (
				audience = 'everyone'
				or (
					audience = 'sellers'
					and exists (select 1 from public.seller_profiles seller where seller.user_id = (select auth.uid()))
				)
				or (
					audience = 'visitors'
					and (select auth.uid()) is not null
					and not exists (select 1 from public.seller_profiles seller where seller.user_id = (select auth.uid()))
				)
			)
		)
	);

create table public.notification_reads (
	user_id uuid primary key references auth.users (id) on delete cascade,
	last_seen_at timestamptz not null default now()
);

alter table public.notification_reads enable row level security;
revoke all on public.notification_reads from anon, authenticated;
grant select on public.notification_reads to authenticated;

create policy "Users read their own notification marker"
	on public.notification_reads for select to authenticated
	using (user_id = (select auth.uid()));

create or replace function public.mark_notifications_seen()
returns void
language sql
security definer
set search_path = ''
as $$
	insert into public.notification_reads (user_id, last_seen_at)
	select (select auth.uid()), now()
	where (select auth.uid()) is not null
	on conflict (user_id) do update set last_seen_at = excluded.last_seen_at;
$$;

revoke all on function public.mark_notifications_seen() from public, anon;
grant execute on function public.mark_notifications_seen() to authenticated;

create or replace function public.admin_create_announcement(
	p_title text,
	p_body text,
	p_link_url text,
	p_audience text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	saved_id uuid;
begin
	if not public.is_admin() then
		raise exception 'Administrator access required.' using errcode = '42501';
	end if;

	insert into public.site_announcements (title, body, link_url, audience, created_by)
	values (p_title, p_body, p_link_url, p_audience, (select auth.uid()))
	returning id into saved_id;

	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values ((select auth.uid()), 'announcement_created', 'site_announcement', saved_id, jsonb_build_object('title', p_title, 'audience', p_audience));

	return saved_id;
end;
$$;

create or replace function public.admin_set_announcement_active(p_announcement_id uuid, p_is_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not public.is_admin() then
		raise exception 'Administrator access required.' using errcode = '42501';
	end if;

	update public.site_announcements set is_active = p_is_active where id = p_announcement_id;
	if not found then
		raise exception 'Announcement not found.' using errcode = 'P0002';
	end if;

	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values ((select auth.uid()), 'announcement_updated', 'site_announcement', p_announcement_id, jsonb_build_object('is_active', p_is_active));
end;
$$;

revoke all on function public.admin_create_announcement(text, text, text, text) from public, anon;
revoke all on function public.admin_set_announcement_active(uuid, boolean) from public, anon;
grant execute on function public.admin_create_announcement(text, text, text, text) to authenticated;
grant execute on function public.admin_set_announcement_active(uuid, boolean) to authenticated;
