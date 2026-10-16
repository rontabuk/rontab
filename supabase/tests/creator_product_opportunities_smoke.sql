begin;
select plan(1);

do $$
declare
	admin_user uuid := gen_random_uuid();
	seller_user uuid := gen_random_uuid();
	creator_one_user uuid := gen_random_uuid();
	creator_two_user uuid := gen_random_uuid();
	creator_other_user uuid := gen_random_uuid();
	seller_id uuid := gen_random_uuid();
	category_id uuid := gen_random_uuid();
	product_id uuid := gen_random_uuid();
	creator_one_id uuid := gen_random_uuid();
	creator_two_id uuid := gen_random_uuid();
	creator_other_id uuid := gen_random_uuid();
	first_opportunity_id uuid;
	second_opportunity_id uuid;
	third_opportunity_id uuid;
	first_proposal_id uuid;
	second_proposal_id uuid;
	first_city_id text;
	second_city_id text;
	contact_email text;
	contact_phone text;
	public_phone text;
	opportunity_notification_id text;
	read_notification_ids text[];
	result_creator_id uuid;
	follow_result jsonb;
	followed_shop_count bigint;
begin
	begin
		select city.city_id into first_city_id
		from public.supported_cities city
		join public.supported_countries country on country.country_code = city.country_code
		where city.country_code = 'GB' and city.is_enabled and country.is_enabled
		order by city.city_id limit 1;
		select city.city_id into second_city_id
		from public.supported_cities city
		join public.supported_countries country on country.country_code = city.country_code
		where city.country_code = 'GB' and city.is_enabled and country.is_enabled
			and city.city_id <> first_city_id
		order by city.city_id limit 1;
		if first_city_id is null or second_city_id is null then
			raise exception 'Two enabled UK cities are required for this smoke test.';
		end if;

		insert into auth.users (
			id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		) values
			(admin_user, 'authenticated', 'authenticated', admin_user::text || '@creator-opportunity.invalid', '', now(), '{"role":"admin"}', '{}', now(), now()),
			(seller_user, 'authenticated', 'authenticated', seller_user::text || '@creator-opportunity.invalid', '', now(), '{}', '{}', now(), now()),
			(creator_one_user, 'authenticated', 'authenticated', creator_one_user::text || '@creator-opportunity.invalid', '', now(), '{}', '{}', now(), now()),
			(creator_two_user, 'authenticated', 'authenticated', creator_two_user::text || '@creator-opportunity.invalid', '', now(), '{}', '{}', now(), now()),
			(creator_other_user, 'authenticated', 'authenticated', creator_other_user::text || '@creator-opportunity.invalid', '', now(), '{}', '{}', now(), now());

		insert into public.seller_profiles (id, user_id, shop_name, slug, status, is_public)
		values (seller_id, seller_user, 'Opportunity smoke seller', 'opportunity-smoke-' || replace(seller_id::text, '-', ''), 'active', true);
		insert into public.seller_contact_details (
			seller_profile_id, registered_email, registered_email_confirmed_at, phone, phone_contact_confirmed_at
		) values (seller_id, seller_user::text || '@creator-opportunity.invalid', now(), '+441234567890', now());
		insert into public.categories (id, slug, name, is_active)
		values (category_id, 'creator-opportunity-' || replace(category_id::text, '-', ''), 'Creator opportunity smoke', true);
		insert into public.products (id, seller_profile_id, category_id, slug, name, description, external_url, status, published_at)
		values (product_id, seller_id, category_id, 'creator-opportunity-' || replace(product_id::text, '-', ''), 'Opportunity smoke product', 'A rollback-only creator opportunity fixture.', 'https://example.invalid/creator-opportunity', 'approved', now());

		insert into public.creator_profiles (
			id, owner_id, slug, display_name, bio, specialties, status, is_public,
			published_display_name, published_bio, published_specialties, published_audience_city_id
		) values
			(creator_one_id, creator_one_user, 'creator-one-' || replace(creator_one_id::text, '-', ''), 'Creator One', 'A rollback-only creator opportunity test profile.', array['food'], 'approved', true, 'Creator One', 'A rollback-only creator opportunity test profile.', array['food'], first_city_id),
			(creator_two_id, creator_two_user, 'creator-two-' || replace(creator_two_id::text, '-', ''), 'Creator Two', 'A rollback-only creator opportunity test profile.', array['food'], 'approved', true, 'Creator Two', 'A rollback-only creator opportunity test profile.', array['food'], second_city_id),
			(creator_other_id, creator_other_user, 'creator-other-' || replace(creator_other_id::text, '-', ''), 'Creator Other', 'A rollback-only creator opportunity test profile.', array['travel'], 'approved', true, 'Creator Other', 'A rollback-only creator opportunity test profile.', array['travel'], second_city_id);
		insert into public.creator_profile_audience_cities (creator_profile_id, city_id, is_published)
		values (creator_one_id, first_city_id, true), (creator_two_id, second_city_id, true), (creator_other_id, second_city_id, true);
		insert into public.creator_contact_details (creator_profile_id, phone, phone_visibility)
		values
			(creator_one_id, '+441111111111', 'collaborations'),
			(creator_two_id, '+442222222222', 'public'),
			(creator_other_id, '+443333333333', 'collaborations');
		if public.get_public_creator_contact_phone(creator_one_id) is not null
			or public.get_public_creator_contact_phone(creator_two_id) <> '+442222222222' then
			raise exception 'Only creators who opt in to public visibility should expose a phone.';
		end if;

		perform set_config('request.jwt.claim.sub', seller_user::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', seller_user::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
		if public.get_public_seller_contact_phone(seller_id) is not null
			or (select count(*) from public.get_public_seller_contact_phones(array[seller_id])) <> 0 then
			raise exception 'Seller phones should be hidden from product pages until the seller opts in.';
		end if;
		perform public.seller_set_phone_visibility('public');
		if public.get_public_seller_contact_phone(seller_id) <> '+441234567890'
			or (select count(*) from public.get_public_seller_contact_phones(array[seller_id])) <> 1 then
			raise exception 'An active seller opt-in should expose the confirmed phone on public products.';
		end if;
		perform public.seller_set_phone_visibility('collaborations');
		if public.get_public_seller_contact_phone(seller_id) is not null then
			raise exception 'Collaboration-only seller phones must not be returned to visitors.';
		end if;
		first_opportunity_id := public.seller_create_creator_product_opportunity(
			product_id, 100, array['food'], false, array[first_city_id, second_city_id],
			'Create one short product video and publish it on an approved social platform.', false, null, array['email']
		);
		perform set_config('request.jwt.claim.sub', creator_one_user::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', creator_one_user::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
		select notification.notification_id into opportunity_notification_id
		from public.get_creator_collaboration_notifications() notification
		where notification.title = 'New creator opportunity'
			and notification.body like '%Opportunity smoke product%'
			and notification.href = '/visitor/creator/opportunities'
		order by notification.created_at desc
		limit 1;
		if opportunity_notification_id is null then
			raise exception 'A matching creator should receive a new product opportunity notification.';
		end if;
		read_notification_ids := public.mark_notification_items_read(array[opportunity_notification_id]);
		if not opportunity_notification_id = any(read_notification_ids) then
			raise exception 'Creators should be able to mark opportunity notifications as read.';
		end if;
		follow_result := public.visitor_follow_seller_shop(seller_id);
		if coalesce((follow_result ->> 'already_following')::boolean, true)
			or not public.visitor_is_following_seller_shop(seller_id)
			or has_table_privilege('authenticated', 'public.seller_shop_follows', 'SELECT') then
			raise exception 'A visitor should follow a public shop without direct access to the private follow table.';
		end if;
		follow_result := public.visitor_follow_seller_shop(seller_id);
		if (follow_result ->> 'already_following')::boolean is distinct from true then
			raise exception 'Following the same shop twice must remain idempotent.';
		end if;
		select count(*) into followed_shop_count from public.visitor_get_my_followed_shops();
		if followed_shop_count <> 1 then raise exception 'The visitor should see the followed shop in their private list.'; end if;
		perform set_config('request.jwt.claim.sub', seller_user::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', seller_user::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
		if public.seller_get_shop_follower_count() <> 1 then raise exception 'The shop owner should see the aggregate follower count.'; end if;
		perform set_config('request.jwt.claim.sub', admin_user::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_user::text, 'role', 'authenticated', 'app_metadata', '{"role":"admin"}'::jsonb)::text, true);
		update public.seller_profiles set is_public = false where id = seller_id;
		perform set_config('request.jwt.claim.sub', creator_one_user::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', creator_one_user::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
		select count(*) into followed_shop_count from public.visitor_get_my_followed_shops();
		if public.visitor_is_following_seller_shop(seller_id) or followed_shop_count <> 0 then
			raise exception 'Hiding a shop should clear follows and remove it from visitor lists.';
		end if;
		if public.creator_can_view_product_opportunity(first_opportunity_id) then
			raise exception 'Campaigns must not be visible when the shop profile is hidden.';
		end if;
		perform set_config('request.jwt.claim.sub', admin_user::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_user::text, 'role', 'authenticated', 'app_metadata', '{"role":"admin"}'::jsonb)::text, true);
		update public.seller_profiles set is_public = true where id = seller_id;
		perform set_config('request.jwt.claim.sub', seller_user::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', seller_user::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
		begin
			perform public.seller_create_creator_product_opportunity(
				product_id, 100, array['food'], true, '{}'::text[],
				'Create one short product video and publish it on an approved social platform.', false, null, array['email']
			);
			raise exception 'A product must not have two open opportunities.';
		exception when unique_violation then
			null;
		end;

		perform set_config('request.jwt.claim.sub', creator_one_user::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', creator_one_user::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
		perform public.creator_save_contact_preferences('+441234000001', 'collaborations');
		if public.get_public_creator_contact_phone(creator_one_id) is not null then
			raise exception 'A creator contact number must remain hidden by default.';
		end if;
		perform public.creator_save_contact_preferences('+441234000001', 'public');
		if public.get_public_creator_contact_phone(creator_one_id) <> '+441234000001' then
			raise exception 'A creator should be able to explicitly publish a contact phone.';
		end if;
		perform public.creator_save_contact_preferences('+441234000001', 'collaborations');
		if public.get_public_creator_contact_phone(creator_one_id) is not null then
			raise exception 'Switching back to collaboration-only should hide the creator phone.';
		end if;
		if not public.creator_can_view_product_opportunity(first_opportunity_id) then
			raise exception 'A matching specialty and audience city should see the opportunity.';
		end if;
		first_proposal_id := public.creator_submit_product_opportunity_proposal(
			first_opportunity_id, 80, 'One edited product video, a caption, and publication on Instagram.', true, false, null
		);
		begin
			perform * from public.get_creator_product_opportunity_contact(first_proposal_id);
			raise exception 'Contact details must remain hidden before seller selection.';
		exception when insufficient_privilege then
			null;
		end;

		perform set_config('request.jwt.claim.sub', creator_two_user::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', creator_two_user::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
		second_proposal_id := public.creator_submit_product_opportunity_proposal(
			first_opportunity_id, 120, 'One edited product video, two story posts, and publication on TikTok.', true, false, null
		);
		perform set_config('request.jwt.claim.sub', creator_other_user::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', creator_other_user::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
		if exists (
			select 1 from public.get_creator_collaboration_notifications() notification
			where notification.title = 'New creator opportunity'
				and notification.body like '%Opportunity smoke product%'
		) then
			raise exception 'Creators outside the specialty and audience city must not receive the opportunity notification.';
		end if;
		if public.creator_can_view_product_opportunity(first_opportunity_id) then
			raise exception 'A creator outside the selected specialty must not see the opportunity.';
		end if;
		begin
			perform public.creator_submit_product_opportunity_proposal(
				first_opportunity_id, 100, 'One edited product video and publication on the creator social platform.', true, false, null
			);
			raise exception 'A creator outside the selected specialty must not submit an offer.';
		exception when insufficient_privilege then
			null;
		end;

		perform set_config('request.jwt.claim.sub', seller_user::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', seller_user::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
		if (select count(*) from public.creator_product_opportunity_proposals where opportunity_id = first_opportunity_id) <> 2 then
			raise exception 'The seller should receive both lower and higher creator offers.';
		end if;
		result_creator_id := public.seller_select_creator_product_opportunity_proposal(second_proposal_id);
		if result_creator_id <> creator_two_id
			or (select status from public.creator_product_opportunities where id = first_opportunity_id) <> 'awarded'
			or (select status from public.creator_product_opportunity_proposals where id = first_proposal_id) <> 'not_selected' then
			raise exception 'Selecting a creator should award the opportunity and close the other pending offer.';
		end if;
		select email, phone into contact_email, contact_phone
		from public.get_creator_product_opportunity_contact(second_proposal_id);
		if contact_email <> creator_two_user::text || contact_phone is not null then
			raise exception 'The seller should see only the selected creator contact methods.';
		end if;
		if has_table_privilege('authenticated', 'public.creator_product_opportunity_contacts', 'SELECT') then
			raise exception 'Private creator contact records must not be directly readable.';
		end if;

		perform set_config('request.jwt.claim.sub', creator_two_user::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', creator_two_user::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
		select email, phone into contact_email, contact_phone
		from public.get_creator_product_opportunity_contact(second_proposal_id);
		if contact_email <> seller_user::text || contact_phone is not null then
			raise exception 'The selected creator should see only the contact methods the seller chose.';
		end if;

		perform set_config('request.jwt.claim.sub', seller_user::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', seller_user::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
		second_opportunity_id := public.seller_create_creator_product_opportunity(
			product_id, 100, array['food'], true, '{}'::text[],
			'Create one short product video and publish it on an approved social platform.', false, null, array['email']
		);
		if second_opportunity_id = first_opportunity_id then
			raise exception 'A product can open another campaign after the prior campaign is awarded.';
		end if;
		perform public.seller_close_creator_product_opportunity(second_opportunity_id);
		third_opportunity_id := public.seller_create_creator_product_opportunity(
			product_id, 100, array['food'], true, '{}'::text[],
			'Create one short product video and publish it on an approved social platform.', false, null, array['email']
		);
		if third_opportunity_id = second_opportunity_id then
			raise exception 'A product can open another campaign after the prior campaign is closed.';
		end if;
		if not has_function_privilege('authenticated', 'public.creator_submit_product_opportunity_proposal(uuid,numeric,text,boolean,boolean,text)', 'EXECUTE')
			or has_function_privilege('anon', 'public.creator_submit_product_opportunity_proposal(uuid,numeric,text,boolean,boolean,text)', 'EXECUTE')
			or has_table_privilege('authenticated', 'public.creator_product_opportunity_proposals', 'INSERT') then
			raise exception 'Creator offer writes must remain behind authenticated RPC validation.';
		end if;

		raise exception using errcode = 'P0001', message = '__ROLLBACK_CREATOR_PRODUCT_OPPORTUNITIES_SMOKE__';
	exception when sqlstate 'P0001' then
		if sqlerrm <> '__ROLLBACK_CREATOR_PRODUCT_OPPORTUNITIES_SMOKE__' then raise; end if;
	end;
end;
$$;

select pass('creator product opportunities match audience and specialties, compare offers, and reveal chosen contacts only after selection');
select * from finish();
rollback;
