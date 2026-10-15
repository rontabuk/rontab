alter table public.creator_profiles
	add column referral_code text;

update public.creator_profiles
set referral_code = 'RT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
where is_public and referral_code is null;

create unique index creator_profiles_referral_code_unique_idx
	on public.creator_profiles (referral_code)
	where referral_code is not null;

create function public.assign_creator_referral_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	if new.is_public and new.referral_code is null then
		loop
			new.referral_code := 'RT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
			exit when not exists (
				select 1 from public.creator_profiles profile
				where profile.referral_code = new.referral_code
			);
		end loop;
	end if;
	return new;
end;
$$;

create trigger assign_creator_referral_code_before_publish
	before insert or update of is_public on public.creator_profiles
	for each row execute function public.assign_creator_referral_code();

grant select (referral_code) on public.creator_profiles to anon, authenticated;

create table public.creator_fans (
	visitor_id uuid not null references public.profiles (id) on delete cascade,
	creator_profile_id uuid not null references public.creator_profiles (id) on delete cascade,
	first_code text not null,
	followed_at timestamptz not null default now(),
	primary key (visitor_id, creator_profile_id)
);
create index creator_fans_creator_history_idx
	on public.creator_fans (creator_profile_id, followed_at desc);

create table public.creator_first_referrals (
	visitor_id uuid primary key references public.profiles (id) on delete cascade,
	creator_profile_id uuid not null references public.creator_profiles (id) on delete restrict,
	referral_code text not null,
	attributed_at timestamptz not null default now()
);
create index creator_first_referrals_creator_idx
	on public.creator_first_referrals (creator_profile_id, attributed_at desc);

alter table public.creator_fans enable row level security;
alter table public.creator_first_referrals enable row level security;
revoke all on public.creator_fans, public.creator_first_referrals from public, anon, authenticated;

create function public.creator_follow_by_code(p_code text)
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
		or exists (select 1 from public.seller_profiles where user_id = current_user_id) then
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

create function public.creator_unfollow(p_creator_profile_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
	current_user_id uuid := (select auth.uid());
begin
	if current_user_id is null then
		raise exception 'Sign in to update your creator list.' using errcode = '42501';
	end if;
	delete from public.creator_fans
	where visitor_id = current_user_id and creator_profile_id = p_creator_profile_id;
	return found;
end;
$$;

create function public.creator_get_my_follows()
returns table (
	creator_profile_id uuid,
	slug text,
	display_name text,
	specialties text[],
	referral_code text,
	followed_at timestamptz,
	audience_city_name text,
	country_code text
)
language sql
stable
security definer
set search_path = ''
as $$
	select profile.id, profile.slug, profile.published_display_name, profile.published_specialties,
		profile.referral_code, fan.followed_at, city.city_name, city.country_code
	from public.creator_fans fan
	join public.creator_profiles profile on profile.id = fan.creator_profile_id and profile.is_public
	left join public.supported_cities city on city.city_id = profile.published_audience_city_id
	where fan.visitor_id = (select auth.uid())
	order by fan.followed_at desc, profile.published_display_name;
$$;

create function public.creator_get_my_fan_stats()
returns table (fan_count bigint, first_referral_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
	select
		(select count(*) from public.creator_fans fan where fan.creator_profile_id = profile.id),
		(select count(*) from public.creator_first_referrals referral where referral.creator_profile_id = profile.id)
	from public.creator_profiles profile
	where profile.owner_id = (select auth.uid());
$$;

create function public.creator_get_public_fan_count(p_creator_profile_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
	select case when profile.is_public then (
		select count(*) from public.creator_fans fan where fan.creator_profile_id = profile.id
	) else null end
	from public.creator_profiles profile
	where profile.id = p_creator_profile_id;
$$;

revoke all on function public.creator_follow_by_code(text) from public, anon;
revoke all on function public.creator_unfollow(uuid) from public, anon;
revoke all on function public.creator_get_my_follows() from public, anon;
revoke all on function public.creator_get_my_fan_stats() from public, anon;
revoke all on function public.creator_get_public_fan_count(uuid) from public;
grant execute on function public.creator_follow_by_code(text) to authenticated;
grant execute on function public.creator_unfollow(uuid) to authenticated;
grant execute on function public.creator_get_my_follows() to authenticated;
grant execute on function public.creator_get_my_fan_stats() to authenticated;
grant execute on function public.creator_get_public_fan_count(uuid) to anon, authenticated;