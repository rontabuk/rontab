-- Creator accounts are standalone accounts (like seller accounts), separate from visitor accounts.
-- The trusted marker is app_metadata.account_type = 'creator', which only the service role can set.

create function public.is_creator_account(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (select 1 from public.creator_profiles profile where profile.owner_id = p_user_id)
		or exists (
			select 1 from auth.users account
			where account.id = p_user_id and account.raw_app_meta_data ->> 'account_type' = 'creator'
		);
$$;

revoke all on function public.is_creator_account(uuid) from public, anon, authenticated;

-- Existing creator profiles become creator accounts and stop using visitor features.
update auth.users account
set raw_app_meta_data = coalesce(account.raw_app_meta_data, '{}'::jsonb) || '{"account_type": "creator"}'::jsonb
where exists (select 1 from public.creator_profiles profile where profile.owner_id = account.id);

delete from public.creator_fans fan where public.is_creator_account(fan.visitor_id);
delete from public.creator_first_referrals referral where public.is_creator_account(referral.visitor_id);

create or replace function public.is_point_earning_visitor(p_visitor_id uuid)
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
	)
	and not public.is_creator_account(p_visitor_id);
$$;

revoke all on function public.is_point_earning_visitor(uuid) from public, anon, authenticated;

create or replace function public.creator_follow_by_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	current_user_id uuid := (select auth.uid());
	creator public.creator_profiles%rowtype;
	new_fan boolean := false;
	first_referral boolean := false;
	inserted_count integer;
begin
	if current_user_id is null
		or not exists (select 1 from auth.users where id = current_user_id and email_confirmed_at is not null)
		or (select public.is_admin())
		or exists (select 1 from public.seller_profiles where user_id = current_user_id)
		or public.is_creator_account(current_user_id) then
		raise exception 'A confirmed visitor account is required to follow a creator.' using errcode = '42501';
	end if;
	if p_code is null or length(btrim(p_code)) not between 3 and 20 then
		raise exception 'Enter a valid creator code.' using errcode = '22023';
	end if;

	select * into creator
	from public.creator_profiles
	where referral_code = upper(btrim(p_code)) and is_public
	for share;
	if not found then
		raise exception 'This creator code is invalid or no longer active.' using errcode = 'P0002';
	end if;

	insert into public.creator_fans (visitor_id, creator_profile_id, first_code)
	values (current_user_id, creator.id, creator.referral_code)
	on conflict (visitor_id, creator_profile_id) do nothing;
	get diagnostics inserted_count = row_count;
	new_fan := inserted_count > 0;

	insert into public.creator_first_referrals (visitor_id, creator_profile_id, referral_code)
	values (current_user_id, creator.id, creator.referral_code)
	on conflict (visitor_id) do nothing;
	get diagnostics inserted_count = row_count;
	first_referral := inserted_count > 0;

	return jsonb_build_object(
		'creator_profile_id', creator.id,
		'creator_slug', creator.slug,
		'creator_name', creator.published_display_name,
		'already_following', not new_fan,
		'first_referral', first_referral
	);
end;
$$;

create or replace function public.can_read_notification_event(p_event public.notification_events)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1 from auth.users account
		where account.id = (select auth.uid())
			and p_event.created_at <= now()
			and (
				p_event.recipient_id = account.id
				or (p_event.recipient_id is null and p_event.created_at >= account.created_at
					and (p_event.audience = 'everyone'
						or public.is_admin()
						or (p_event.audience = 'sellers' and exists (select 1 from public.seller_profiles seller where seller.user_id = account.id))
						or (p_event.audience = 'visitors'
							and not exists (select 1 from public.seller_profiles seller where seller.user_id = account.id)
							and not public.is_creator_account(account.id))))
			)
			and (p_event.kind <> 'loyalty-offer' or (
				public.is_point_earning_visitor(account.id)
				and (p_event.city_ids is null or exists (select 1 from public.profiles profile where profile.id = account.id and profile.city_id::text = any(p_event.city_ids)))
				and (not p_event.random_draw or exists (select 1 from public.marketplace_settings where singleton and loyalty_random_draws_enabled))
			))
	);
$$;

-- Creators keep only their influence balance; admin-granted creator points are retired.
drop function public.admin_grant_creator_points(uuid, integer, text, uuid);
drop table public.creator_point_transactions;
drop table public.creator_point_accounts;

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
		or not exists (select 1 from auth.users where id = current_user_id and email_confirmed_at is not null)
		or not public.is_creator_account(current_user_id) then
		raise exception 'A creator account is required. Register a separate creator account first.' using errcode = '42501';
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
	if (
		select coalesce(sum((entry.value ->> 'follower_count')::bigint), 0)
		from jsonb_array_elements(p_platform_accounts) entry
	) < 3000 then
		raise exception 'Creator accounts need at least 3,000 followers across their social platforms.' using errcode = '22023';
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

-- The creator workspace moved from /visitor/creator to /creator. Rewrite every notification
-- function that builds those links (keeping grants, which CREATE OR REPLACE preserves) and stored links.
do $$
declare
	function_oid oid;
begin
	for function_oid in
		select procedure.oid
		from pg_proc procedure
		join pg_namespace namespace on namespace.oid = procedure.pronamespace
		where namespace.nspname = 'public'
			and procedure.prokind = 'f'
			and pg_get_functiondef(procedure.oid) like '%/visitor/creator%'
	loop
		execute replace(pg_get_functiondef(function_oid), '/visitor/creator', '/creator');
	end loop;
end;
$$;

update public.creator_notification_events
set href = replace(href, '/visitor/creator', '/creator')
where href like '/visitor/creator%';

update public.notification_events
set href = replace(href, '/visitor/creator', '/creator')
where href like '/visitor/creator%';

-- Creator accounts are usable at once, but only a creator who has proved inbox ownership can be approved or reinstated publicly.
create function public.require_verified_creator_email_for_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.status = 'approved' and new.is_public
		and (old.status is distinct from new.status or not old.is_public)
		and not exists (
			select 1 from public.profiles profile
			where profile.id = new.owner_id and profile.email_verified_at is not null
		) then
		raise exception 'This creator must confirm their email address before the profile can be approved.' using errcode = '55000';
	end if;
	return new;
end;
$$;

revoke all on function public.require_verified_creator_email_for_approval() from public, anon, authenticated;

create trigger require_verified_creator_email_for_approval
	before update of status, is_public on public.creator_profiles
	for each row execute function public.require_verified_creator_email_for_approval();
