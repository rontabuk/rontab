begin;
select plan(1);

do $$
declare
	member_user uuid := gen_random_uuid();
	seller_user uuid := gen_random_uuid();
	creator_user uuid := gen_random_uuid();
	other_user uuid := gen_random_uuid();
	seller_id uuid := gen_random_uuid();
	creator_id uuid := gen_random_uuid();
	visible_count bigint;
	visible_phone text;
	visible_email text;
	visible_social_count bigint;
	follower_summary record;
begin
	begin
		insert into auth.users (
			id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		) values
			(member_user, 'authenticated', 'authenticated', member_user::text || '@member-contact.invalid', '', now(), '{}', '{}', now(), now()),
			(seller_user, 'authenticated', 'authenticated', seller_user::text || '@member-contact.invalid', '', now(), '{}', '{}', now(), now()),
			(creator_user, 'authenticated', 'authenticated', creator_user::text || '@member-contact.invalid', '', now(), '{}', '{}', now(), now()),
			(other_user, 'authenticated', 'authenticated', other_user::text || '@member-contact.invalid', '', now(), '{}', '{}', now(), now());
		insert into public.seller_profiles (id, user_id, shop_name, slug, status, is_public)
		values (seller_id, seller_user, 'Contact smoke seller', 'contact-smoke-' || replace(seller_id::text, '-', ''), 'active', true);
		insert into public.creator_profiles (
			id, owner_id, slug, display_name, bio, specialties, status, is_public,
			published_display_name, published_bio, published_specialties
		) values (
			creator_id, creator_user, 'contact-smoke-' || replace(creator_id::text, '-', ''), 'Contact Smoke Creator',
			'A creator profile for contact visibility smoke tests only.', array['food'], 'approved', true,
			'Contact Smoke Creator', 'A creator profile for contact visibility smoke tests only.', array['food']
		);

		perform set_config('request.jwt.claim.sub', member_user::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', member_user::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
		perform public.save_my_member_contact_profile(
			'+441234567890', 'sellers',
			'[{"platform":"instagram","profile_url":"https://instagram.com/member"},{"platform":"youtube","profile_url":"https://youtube.com/@member"}]'::jsonb
		);
		select count(*), max(profile.phone), max(profile.contact_email), count(profile.social_platform)
		into visible_count, visible_phone, visible_email, visible_social_count
		from public.get_member_contact_profile(member_user) profile;
		if visible_count <> 2 or visible_phone <> '+441234567890'
			or visible_email <> member_user::text || '@member-contact.invalid' or visible_social_count <> 2 then
			raise exception 'The owner should see their saved contact details and two social links.';
		end if;

		perform set_config('request.jwt.claim.sub', seller_user::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', seller_user::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
		select count(*), max(profile.phone) into visible_count, visible_phone
		from public.get_member_contact_profile(member_user) profile;
		if visible_count <> 2 or visible_phone <> '+441234567890' then
			raise exception 'An active seller should see details shared with sellers.';
		end if;
		if not public.follow_member_profile(member_user) then raise exception 'A permitted seller should be able to follow the member profile.'; end if;
		select * into follower_summary from public.get_member_profile_follower_summary(member_user);
		if follower_summary.follower_count <> 1 or not follower_summary.is_following then
			raise exception 'The permitted viewer should see their follow state and the public follower count.';
		end if;

		perform set_config('request.jwt.claim.sub', creator_user::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', creator_user::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
		if exists (select 1 from public.get_member_contact_profile(member_user)) then
			raise exception 'A creator should not see details shared only with sellers.';
		end if;
		begin
			perform public.follow_member_profile(member_user);
			raise exception 'A creator outside the selected audience must not follow the profile.';
		exception when insufficient_privilege then
			null;
		end;

		perform set_config('request.jwt.claim.sub', member_user::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', member_user::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
		perform public.save_my_member_contact_profile('+441234567890', 'creators', '[]'::jsonb);
		perform set_config('request.jwt.claim.sub', creator_user::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', creator_user::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
		if not exists (select 1 from public.get_member_contact_profile(member_user) where phone = '+441234567890') then
			raise exception 'An approved public creator should see details shared with creators.';
		end if;
		if not public.follow_member_profile(member_user) then raise exception 'An approved creator should be able to follow the public profile.'; end if;

		perform set_config('request.jwt.claim.sub', member_user::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', member_user::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
		perform public.save_my_member_contact_profile(null, 'public', '[]'::jsonb);
		perform set_config('request.jwt.claim.sub', other_user::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', other_user::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
		if not exists (select 1 from public.get_member_contact_profile(member_user) where contact_email = member_user::text || '@member-contact.invalid') then
			raise exception 'Anyone should see the confirmed contact email when the profile is public.';
		end if;
		if not public.follow_member_profile(member_user) then raise exception 'A permitted member should be able to follow a public profile.'; end if;
		select * into follower_summary from public.get_member_profile_follower_summary(member_user);
		if follower_summary.follower_count <> 3 or not follower_summary.is_following then
			raise exception 'Follower counts and follow state should reflect permitted account types.';
		end if;
		if not public.unfollow_member_profile(member_user) then raise exception 'A member should be able to unfollow a profile.'; end if;
		if has_table_privilege('anon', 'public.member_contact_preferences', 'SELECT')
			or has_table_privilege('authenticated', 'public.member_social_links', 'INSERT') then
			raise exception 'Direct table access must not bypass contact visibility controls.';
		end if;

		begin
			perform set_config('request.jwt.claim.sub', member_user::text, true);
			perform set_config('request.jwt.claims', jsonb_build_object('sub', member_user::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
			perform public.save_my_member_contact_profile(null, 'public', '[{"platform":"x","profile_url":"https://x.com/1"},{"platform":"instagram","profile_url":"https://instagram.com/1"},{"platform":"youtube","profile_url":"https://youtube.com/1"},{"platform":"facebook","profile_url":"https://facebook.com/1"}]'::jsonb);
			raise exception 'More than three social links must be rejected.';
		exception when sqlstate '22023' then
			null;
		end;

		raise exception using errcode = 'P0001', message = '__ROLLBACK_MEMBER_CONTACT_VISIBILITY_SMOKE__';
	exception when sqlstate 'P0001' then
		if sqlerrm <> '__ROLLBACK_MEMBER_CONTACT_VISIBILITY_SMOKE__' then raise; end if;
	end;
end;
$$;

select pass('member contact data is optional, limited to three links, and returned only to the selected audience');
select * from finish();
rollback;