do $$
declare
	admin_user uuid := gen_random_uuid();
	seller_user uuid := gen_random_uuid();
	visitor_user uuid := gen_random_uuid();
	seller_id uuid;
	category_id uuid := gen_random_uuid();
	target_product_id uuid := gen_random_uuid();
	test_city_id text;
	remaining_clicks bigint;
	welcome_clicks bigint;
	click_count bigint;
	event_count bigint;
	points_balance bigint;
begin
	begin
	insert into auth.users (
		id, aud, role, email, encrypted_password, email_confirmed_at,
		raw_app_meta_data, raw_user_meta_data, created_at, updated_at
	)
	values
		(admin_user, 'authenticated', 'authenticated', admin_user::text || '@click-smoke.invalid', '', now(), '{"role":"admin"}', '{}', now(), now()),
		(seller_user, 'authenticated', 'authenticated', seller_user::text || '@click-smoke.invalid', '', now(), '{}', jsonb_build_object('account_type', 'seller', 'shop_name', 'Click smoke seller', 'shop_slug', 'click-smoke-' || seller_user::text), now(), now()),
		(visitor_user, 'authenticated', 'authenticated', visitor_user::text || '@click-smoke.invalid', '', now(), '{}', '{"account_type":"visitor"}', now(), now());

	perform set_config('request.jwt.claim.sub', admin_user::text, true);
	perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_user::text, 'role', 'authenticated', 'app_metadata', '{"role":"admin"}'::jsonb)::text, true);
	select city_id into test_city_id from public.supported_cities
	where country_code = 'GB' and is_enabled order by city_name limit 1;
	if test_city_id is null then
		raise exception 'An enabled UK city fixture is required.';
	end if;
	update public.profiles
	set email_verified_at = now(), city_id = test_city_id
	where id in (admin_user, seller_user, visitor_user);
	select id into seller_id from public.seller_profiles where user_id = seller_user;
	if seller_id is null then
		raise exception 'Seller signup should create a seller profile.';
	end if;
	perform public.admin_set_seller_status(seller_id, 'active', true);

	insert into public.categories (id, slug, name, is_active)
	values (category_id, 'click-smoke-' || replace(category_id::text, '-', ''), 'Click smoke test', true);
	insert into public.products (id, seller_profile_id, category_id, slug, name, description, external_url)
	values (target_product_id, seller_id, category_id, 'click-smoke-' || replace(target_product_id::text, '-', ''), 'Click smoke product', 'Rollback-only click accounting fixture.', 'https://example.invalid/click-smoke');
	perform public.admin_review_product(target_product_id, 'approved');

	if not public.record_product_shop_click(target_product_id, visitor_user) then
		raise exception 'The first eligible visitor click should be accepted.';
	end if;
	select clicks_remaining, welcome_clicks_remaining
	into remaining_clicks, welcome_clicks
	from public.seller_ad_accounts where seller_profile_id = seller_id;
	select product.click_count into click_count from public.products product where product.id = target_product_id;
	if remaining_clicks <> 9999 or welcome_clicks <> 9999 or click_count <> 1 then
		raise exception 'The first eligible click must consume one welcome credit and increment the product count once.';
	end if;

	if not public.record_product_shop_click(target_product_id, visitor_user) then
		raise exception 'A repeat visit to the same product should remain available.';
	end if;
	select clicks_remaining, welcome_clicks_remaining
	into remaining_clicks, welcome_clicks
	from public.seller_ad_accounts where seller_profile_id = seller_id;
	select product.click_count into click_count from public.products product where product.id = target_product_id;
	select count(*) into event_count from public.product_shop_click_events event
	where event.product_id = target_product_id and event.visitor_id = visitor_user;
	select account.points_balance into points_balance from public.loyalty_accounts account where account.visitor_id = visitor_user;
	if remaining_clicks <> 9999 or welcome_clicks <> 9999 or click_count <> 1
		or event_count <> 1 or points_balance <> 1 then
		raise exception 'Repeat visit state mismatch: balance %, welcome %, clicks %, events %, points %.',
			remaining_clicks, welcome_clicks, click_count, event_count, points_balance;
	end if;

	insert into public.visitor_product_points (visitor_id, product_id)
	values (seller_user, target_product_id), (admin_user, target_product_id);
	if public.is_supported_loyalty_visitor(seller_user)
		or public.is_supported_loyalty_visitor(admin_user)
		or exists (
			select 1 from public.loyalty_point_transactions
			where visitor_id in (seller_user, admin_user) and transaction_type = 'visit_earned'
		) then
		raise exception 'Seller and administrator click events must not award visitor loyalty points.';
	end if;

		raise exception using errcode = 'P0001', message = '__ROLLBACK_SELLER_CLICK_SMOKE__';
	exception when sqlstate 'P0001' then
		if sqlerrm <> '__ROLLBACK_SELLER_CLICK_SMOKE__' then
			raise;
		end if;
	end;
end;
$$;