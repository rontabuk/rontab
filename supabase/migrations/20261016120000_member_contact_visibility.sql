create table public.member_contact_preferences (
	user_id uuid primary key references auth.users (id) on delete cascade,
	phone text check (phone is null or phone ~ '^\+?[0-9() -]{7,32}$'),
	contact_visibility text not null default 'private'
		check (contact_visibility in ('private', 'sellers', 'creators', 'public')),
	updated_at timestamptz not null default now()
);

create table public.member_social_links (
	user_id uuid not null references public.member_contact_preferences (user_id) on delete cascade,
	position smallint not null check (position between 1 and 3),
	platform text not null check (platform in ('instagram', 'tiktok', 'youtube', 'facebook', 'x', 'other')),
	profile_url text not null check (profile_url ~* '^https://' and length(profile_url) <= 500),
	primary key (user_id, position),
	unique (user_id, platform)
);

alter table public.member_contact_preferences enable row level security;
alter table public.member_social_links enable row level security;
revoke all on public.member_contact_preferences, public.member_social_links from public, anon, authenticated;
grant select on public.member_contact_preferences, public.member_social_links to authenticated;

create policy "Members read their own contact preferences"
	on public.member_contact_preferences for select to authenticated
	using (user_id = (select auth.uid()));
create policy "Members read their own social links"
	on public.member_social_links for select to authenticated
	using (user_id = (select auth.uid()));

create function public.save_my_member_contact_profile(
	p_phone text,
	p_contact_visibility text,
	p_social_links jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	current_user_id uuid := (select auth.uid());
	social_link jsonb;
	position_number smallint := 0;
	platform_name text;
	profile_url text;
	clean_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
	if current_user_id is null
		or (select public.is_admin())
		or exists (select 1 from public.seller_profiles seller where seller.user_id = current_user_id) then
		raise exception 'Sign in with a member account to update contact details.' using errcode = '42501';
	end if;
	if p_contact_visibility is null or p_contact_visibility not in ('private', 'sellers', 'creators', 'public') then
		raise exception 'Choose who can see your contact details.' using errcode = '22023';
	end if;
	if clean_phone is not null and clean_phone !~ '^\+?[0-9() -]{7,32}$' then
		raise exception 'Enter a valid phone number.' using errcode = '22023';
	end if;
	if p_social_links is null or jsonb_typeof(p_social_links) <> 'array' then
		raise exception 'Social links must be a list.' using errcode = '22023';
	end if;
	if jsonb_array_length(p_social_links) > 3 then
		raise exception 'Add no more than three social links.' using errcode = '22023';
	end if;

	insert into public.member_contact_preferences (user_id, phone, contact_visibility)
	values (current_user_id, clean_phone, p_contact_visibility)
	on conflict (user_id) do update
	set phone = excluded.phone,
		contact_visibility = excluded.contact_visibility,
		updated_at = now();

	delete from public.member_social_links where user_id = current_user_id;
	for social_link in select value from jsonb_array_elements(p_social_links)
	loop
		position_number := position_number + 1;
		if jsonb_typeof(social_link) <> 'object' then
			raise exception 'Each social link needs a platform and profile URL.' using errcode = '22023';
		end if;
		platform_name := nullif(btrim(social_link ->> 'platform'), '');
		profile_url := nullif(btrim(social_link ->> 'profile_url'), '');
		if platform_name is null or platform_name not in ('instagram', 'tiktok', 'youtube', 'facebook', 'x', 'other')
			or profile_url is null or profile_url !~* '^https://' or length(profile_url) > 500 then
			raise exception 'Choose a social platform and enter a valid HTTPS profile URL.' using errcode = '22023';
		end if;
		insert into public.member_social_links (user_id, position, platform, profile_url)
		values (current_user_id, position_number, platform_name, profile_url);
	end loop;
end;
$$;

create function public.get_member_contact_profile(p_member_user_id uuid)
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
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	viewer_id uuid := (select auth.uid());
	v_visibility text;
	viewer_is_allowed boolean;
begin
	if p_member_user_id is null then return; end if;
	select coalesce(preferences.contact_visibility, 'private') into v_visibility
	from public.profiles profile
	left join public.member_contact_preferences preferences on preferences.user_id = profile.id
	where profile.id = p_member_user_id;
	if not found then return; end if;

	viewer_is_allowed := viewer_id = p_member_user_id
		or (select public.is_admin())
		or v_visibility = 'public'
		or (v_visibility = 'sellers' and exists (
			select 1 from public.seller_profiles seller
			where seller.user_id = viewer_id and seller.status = 'active'
		))
		or (v_visibility = 'creators' and exists (
			select 1 from public.creator_profiles creator
			where creator.owner_id = viewer_id and creator.status = 'approved' and creator.is_public
		));
	if not coalesce(viewer_is_allowed, false) then return; end if;

	return query
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
	order by social.position nulls first;
end;
$$;

revoke all on function public.save_my_member_contact_profile(text, text, jsonb) from public, anon;
revoke all on function public.get_member_contact_profile(uuid) from public;
grant execute on function public.save_my_member_contact_profile(text, text, jsonb) to authenticated;
grant execute on function public.get_member_contact_profile(uuid) to anon, authenticated;