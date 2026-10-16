begin;
select plan(1);

do $$
declare
	admin_user uuid := gen_random_uuid();
	seller_user uuid := gen_random_uuid();
	seller_id uuid := gen_random_uuid();
	follower_id uuid;
	badge record;
begin
	begin
		insert into auth.users (
			id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		) values
			(admin_user, 'authenticated', 'authenticated', admin_user::text || '@seller-badge.invalid', '', now(), '{"role":"admin"}', '{}', now(), now()),
			(seller_user, 'authenticated', 'authenticated', seller_user::text || '@seller-badge.invalid', '', now(), '{}', '{}', now(), now());
		insert into public.seller_profiles (id, user_id, shop_name, slug, status, is_public)
		values (seller_id, seller_user, 'Badge smoke seller', 'badge-smoke-' || replace(seller_id::text, '-', ''), 'active', true);

		select * into badge from public.get_public_seller_verification_badges(array[seller_id]);
		if badge.is_verified is distinct from true or badge.is_blue is distinct from false then
			raise exception 'Public sellers should receive a grey badge automatically.';
		end if;

		insert into auth.users (
			id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		)
		select
			md5('seller-badge-follower-' || follower_number)::uuid,
			'authenticated', 'authenticated',
			'seller-badge-follower-' || follower_number || '@example.invalid', '', now(), '{}', '{}', now(), now()
		from generate_series(1, 1000) follower_number;

		insert into public.seller_shop_follows (visitor_id, seller_profile_id)
		select md5('seller-badge-follower-' || follower_number)::uuid, seller_id
		from generate_series(1, 999) follower_number;
		select * into badge from public.get_public_seller_verification_badges(array[seller_id]);
		if badge.is_blue then raise exception 'The blue badge must require 1,000 followers.'; end if;

		insert into public.seller_shop_follows (visitor_id, seller_profile_id)
		values (md5('seller-badge-follower-1000')::uuid, seller_id);
		select * into badge from public.get_public_seller_verification_badges(array[seller_id]);
		if not badge.is_blue then raise exception 'The automatic badge should turn blue at 1,000 followers.'; end if;

		perform set_config('request.jwt.claim.sub', admin_user::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_user::text, 'role', 'authenticated', 'app_metadata', '{"role":"admin"}'::jsonb)::text, true);
		perform public.admin_set_seller_verification_badge(seller_id, 'hidden');
		select * into badge from public.get_public_seller_verification_badges(array[seller_id]);
		if badge.is_verified or badge.is_blue then raise exception 'An admin-hidden badge must override the follower threshold.'; end if;

		delete from public.seller_shop_follows where seller_profile_id = seller_id;
		perform public.admin_set_seller_verification_badge(seller_id, 'granted');
		select * into badge from public.get_public_seller_verification_badges(array[seller_id]);
		if not badge.is_verified or not badge.is_blue then raise exception 'An admin-granted badge must override the follower threshold.'; end if;

		perform public.admin_set_seller_verification_badge(seller_id, 'automatic');
		select * into badge from public.admin_get_seller_verification_badges(array[seller_id]);
		if badge.follower_count <> 0 or badge.badge_mode <> 'automatic' then
			raise exception 'The admin badge controls should report follower count and automatic mode.';
		end if;

		raise exception using errcode = 'P0001', message = '__ROLLBACK_SELLER_VERIFICATION_BADGES_SMOKE__';
	exception when sqlstate 'P0001' then
		if sqlerrm <> '__ROLLBACK_SELLER_VERIFICATION_BADGES_SMOKE__' then raise; end if;
	end;
end;
$$;

select pass('seller verification badges respect the 1,000-follower threshold and admin overrides');
select * from finish();
rollback;