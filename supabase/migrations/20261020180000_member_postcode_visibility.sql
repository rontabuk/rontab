-- Members may add a UK postcode with its own audience, independent of the phone/email/social setting.
alter table public.member_contact_preferences
	add column postcode text check (
		postcode is null or postcode ~ '^(GIR 0AA|[A-PR-UWYZ]([0-9]{1,2}|[A-HK-Y][0-9]{1,2}|[0-9][A-HJKPSTUW]|[A-HK-Y][0-9][ABEHMNPRVWXY]) [0-9][ABD-HJLNP-UW-Z]{2})$'
	),
	add column postcode_visibility text not null default 'private'
		check (postcode_visibility in ('private', 'sellers', 'creators', 'public'));

create function public.member_visibility_allows(p_member_user_id uuid, p_visibility text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select p_member_user_id = (select auth.uid())
		or (select public.is_admin())
		or p_visibility = 'public'
		or (p_visibility = 'sellers' and exists (
			select 1 from public.seller_profiles seller
			where seller.user_id = (select auth.uid()) and seller.status = 'active'
		))
		or (p_visibility = 'creators' and exists (
			select 1 from public.creator_profiles creator
			where creator.owner_id = (select auth.uid()) and creator.status = 'approved' and creator.is_public
		));
$$;
revoke all on function public.member_visibility_allows(uuid, text) from public, anon, authenticated;

drop function public.save_my_member_contact_profile(text, text, jsonb);
create function public.save_my_member_contact_profile(
	p_phone text,
	p_contact_visibility text,
	p_social_links jsonb,
	p_postcode text default null,
	p_postcode_visibility text default 'private'
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
	clean_postcode text := nullif(upper(btrim(coalesce(p_postcode, ''))), '');
begin
	if current_user_id is null
		or (select public.is_admin())
		or exists (select 1 from public.seller_profiles seller where seller.user_id = current_user_id) then
		raise exception 'Sign in with a member account to update contact details.' using errcode = '42501';
	end if;
	if p_contact_visibility is null or p_contact_visibility not in ('private', 'sellers', 'creators', 'public') then
		raise exception 'Choose who can see your contact details.' using errcode = '22023';
	end if;
	if p_postcode_visibility is null or p_postcode_visibility not in ('private', 'sellers', 'creators', 'public') then
		raise exception 'Choose who can see your postcode.' using errcode = '22023';
	end if;
	if clean_phone is not null and clean_phone !~ '^\+?[0-9() -]{7,32}$' then
		raise exception 'Enter a valid phone number.' using errcode = '22023';
	end if;
	if clean_postcode is not null and clean_postcode !~ '^(GIR 0AA|[A-PR-UWYZ]([0-9]{1,2}|[A-HK-Y][0-9]{1,2}|[0-9][A-HJKPSTUW]|[A-HK-Y][0-9][ABEHMNPRVWXY]) [0-9][ABD-HJLNP-UW-Z]{2})$' then
		raise exception 'Enter a valid UK postcode.' using errcode = '22023';
	end if;
	if p_social_links is null or jsonb_typeof(p_social_links) <> 'array' then
		raise exception 'Social links must be a list.' using errcode = '22023';
	end if;
	if jsonb_array_length(p_social_links) > 3 then
		raise exception 'Add no more than three social links.' using errcode = '22023';
	end if;

	insert into public.member_contact_preferences (user_id, phone, contact_visibility, postcode, postcode_visibility)
	values (current_user_id, clean_phone, p_contact_visibility, clean_postcode, p_postcode_visibility)
	on conflict (user_id) do update
	set phone = excluded.phone,
		contact_visibility = excluded.contact_visibility,
		postcode = excluded.postcode,
		postcode_visibility = excluded.postcode_visibility,
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
revoke all on function public.save_my_member_contact_profile(text, text, jsonb, text, text) from public, anon;
grant execute on function public.save_my_member_contact_profile(text, text, jsonb, text, text) to authenticated;

drop function public.get_member_contact_profile(uuid);
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
	social_profile_url text,
	postcode text
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
		case when access.contact_allowed then preferences.phone end,
		case when access.contact_allowed and account.email_confirmed_at is not null then account.email::text else null::text end,
		coalesce(preferences.contact_visibility, 'private'),
		case when access.contact_allowed then social.platform end,
		case when access.contact_allowed then social.profile_url end,
		case when access.postcode_allowed then preferences.postcode end
	from public.profiles profile
	join auth.users account on account.id = profile.id
	left join public.supported_cities city on city.city_id = profile.city_id
	left join public.member_contact_preferences preferences on preferences.user_id = profile.id
	left join lateral (
		select (select public.member_can_view_contact_profile(profile.id)) as contact_allowed,
			preferences.postcode is not null
				and (select public.member_visibility_allows(profile.id, preferences.postcode_visibility)) as postcode_allowed
	) access on true
	left join public.member_social_links social on social.user_id = profile.id and access.contact_allowed
	where profile.id = p_member_user_id
		and (access.contact_allowed or access.postcode_allowed)
	order by social.position nulls first;
$$;
revoke all on function public.get_member_contact_profile(uuid) from public;
grant execute on function public.get_member_contact_profile(uuid) to anon, authenticated;
