create table public.member_profile_follows (
	follower_user_id uuid not null references auth.users (id) on delete cascade,
	followed_user_id uuid not null references public.profiles (id) on delete cascade,
	followed_at timestamptz not null default now(),
	primary key (follower_user_id, followed_user_id),
	check (follower_user_id <> followed_user_id)
);
create index member_profile_follows_followed_idx
	on public.member_profile_follows (followed_user_id, followed_at desc);

alter table public.member_profile_follows enable row level security;
revoke all on public.member_profile_follows from public, anon, authenticated;

create function public.member_can_view_contact_profile(p_member_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		from public.profiles profile
		left join public.member_contact_preferences preferences on preferences.user_id = profile.id
		where profile.id = p_member_user_id
			and (
				profile.id = (select auth.uid())
				or (select public.is_admin())
				or coalesce(preferences.contact_visibility, 'private') = 'public'
				or (
					coalesce(preferences.contact_visibility, 'private') = 'sellers'
					and exists (
						select 1 from public.seller_profiles seller
						where seller.user_id = (select auth.uid()) and seller.status = 'active'
					)
				)
				or (
					coalesce(preferences.contact_visibility, 'private') = 'creators'
					and exists (
						select 1 from public.creator_profiles creator
						where creator.owner_id = (select auth.uid()) and creator.status = 'approved' and creator.is_public
					)
				)
			)
	);
$$;

create or replace function public.get_member_contact_profile(p_member_user_id uuid)
returns table (
	profile_user_id uuid,
	display_name text,
	city_name text,
	country_code text,
	phone text,
	contact_email text,
	contact_visibility text,
	social_platform text,
	social_profile_url text
)
language sql
stable
security definer
set search_path = ''
as $$
	select profile.id,
		profile.display_name,
		city.city_name,
		profile.country_code,
		preferences.phone,
		case when account.email_confirmed_at is not null then account.email::text else null::text end,
		coalesce(preferences.contact_visibility, 'private'),
		social.platform,
		social.profile_url
	from public.profiles profile
	join auth.users account on account.id = profile.id
	left join public.supported_cities city on city.city_id = profile.city_id
	left join public.member_contact_preferences preferences on preferences.user_id = profile.id
	left join public.member_social_links social on social.user_id = profile.id
	where profile.id = p_member_user_id
		and (select public.member_can_view_contact_profile(profile.id))
	order by social.position nulls first;
$$;

create function public.get_member_profile_follower_summary(p_member_user_id uuid)
returns table (follower_count bigint, is_following boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not (select public.member_can_view_contact_profile(p_member_user_id)) then return; end if;
	return query
	select count(*)::bigint,
		exists (
			select 1 from public.member_profile_follows follow
			where follow.follower_user_id = (select auth.uid())
				and follow.followed_user_id = p_member_user_id
		)
	from public.member_profile_follows follow
	where follow.followed_user_id = p_member_user_id;
end;
$$;

create function public.follow_member_profile(p_member_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
	follower_id uuid := (select auth.uid());
	inserted_count integer;
begin
	if follower_id is null
		or (select public.is_admin())
		or not exists (
			select 1 from auth.users account
			where account.id = follower_id and account.email_confirmed_at is not null
		) then
		raise exception 'Sign in with a confirmed account to follow this member.' using errcode = '42501';
	end if;
	if p_member_user_id is null or p_member_user_id = follower_id then
		raise exception 'You cannot follow this profile.' using errcode = '22023';
	end if;
	if not (select public.member_can_view_contact_profile(p_member_user_id)) then
		raise exception 'This member profile is not available to your account.' using errcode = '42501';
	end if;

	insert into public.member_profile_follows (follower_user_id, followed_user_id)
	values (follower_id, p_member_user_id)
	on conflict do nothing;
	get diagnostics inserted_count = row_count;
	return inserted_count = 1;
end;
$$;

create function public.unfollow_member_profile(p_member_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
	if (select auth.uid()) is null or p_member_user_id is null then
		raise exception 'Sign in to update your followed members.' using errcode = '42501';
	end if;
	delete from public.member_profile_follows
	where follower_user_id = (select auth.uid()) and followed_user_id = p_member_user_id;
	return found;
end;
$$;

revoke all on function public.member_can_view_contact_profile(uuid) from public, anon, authenticated;
revoke all on function public.get_member_contact_profile(uuid) from public;
revoke all on function public.get_member_profile_follower_summary(uuid) from public;
revoke all on function public.follow_member_profile(uuid) from public, anon;
revoke all on function public.unfollow_member_profile(uuid) from public, anon;
grant execute on function public.get_member_contact_profile(uuid) to anon, authenticated;
grant execute on function public.get_member_profile_follower_summary(uuid) to anon, authenticated;
grant execute on function public.follow_member_profile(uuid) to authenticated;
grant execute on function public.unfollow_member_profile(uuid) to authenticated;