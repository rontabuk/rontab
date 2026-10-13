do $$
declare
	visitor_one uuid := gen_random_uuid();
	visitor_two uuid := gen_random_uuid();
	visitor_three uuid := gen_random_uuid();
	visitor_four uuid := gen_random_uuid();
	admin_user uuid := gen_random_uuid();
	redemption_offer uuid := gen_random_uuid();
	multi_city_offer uuid := gen_random_uuid();
	random_offer uuid := gen_random_uuid();
	join_result jsonb;
	current_balance bigint;
	daily_cap integer;
	daily_earned bigint;
	test_product_id uuid;
	doncaster_id text;
	leeds_id text;
	city_capacity bigint;
	city_remaining bigint;
	city_locations text[];
	winner_count integer;
	won_count integer;
	lost_count integer;
begin
	begin
	select city_id into doncaster_id from public.supported_cities where city_name = 'Doncaster' and admin_name = 'Doncaster' limit 1;
	select city_id into leeds_id from public.supported_cities where city_name = 'Leeds' and admin_name = 'Leeds' limit 1;
	if doncaster_id is null or leeds_id is null then
		raise exception 'Required UK city fixtures are missing.';
	end if;

	insert into auth.users (
		id, aud, role, email, encrypted_password, email_confirmed_at,
		raw_app_meta_data, raw_user_meta_data, created_at, updated_at
	)
	values
		(visitor_one, 'authenticated', 'authenticated', visitor_one::text || '@rewards-test.invalid', '', now(), '{}', '{"account_type":"visitor"}', now(), now()),
		(visitor_two, 'authenticated', 'authenticated', visitor_two::text || '@rewards-test.invalid', '', now(), '{}', '{"account_type":"visitor"}', now(), now()),
		(visitor_three, 'authenticated', 'authenticated', visitor_three::text || '@rewards-test.invalid', '', now(), '{}', '{"account_type":"visitor"}', now(), now()),
		(visitor_four, 'authenticated', 'authenticated', visitor_four::text || '@rewards-test.invalid', '', now(), '{}', '{"account_type":"visitor"}', now(), now()),
		(admin_user, 'authenticated', 'authenticated', admin_user::text || '@rewards-test.invalid', '', now(), '{"role":"admin"}', '{}', now(), now());

	update public.profiles set city_id = doncaster_id where id = visitor_one;
	update public.profiles set city_id = leeds_id where id = visitor_two;
	update public.profiles set city_id = doncaster_id where id = visitor_three;
	if public.is_supported_loyalty_visitor(visitor_one) then
		raise exception 'An unverified visitor must not be eligible for loyalty rewards.';
	end if;
	update public.profiles set email_verified_at = now()
	where id in (visitor_one, visitor_two, visitor_three, visitor_four);

	begin
		update public.profiles set country_code = 'FR' where id = visitor_four;
		raise exception using errcode = 'P0001', message = 'An unsupported country must be rejected.';
	exception when sqlstate '22023' then
		null;
	end;

	perform set_config('request.jwt.claim.sub', visitor_four::text, true);
	perform set_config('request.jwt.claims', jsonb_build_object('sub', visitor_four::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
	if public.is_eligible_visitor() then
		raise exception 'An account without an enabled country must not be eligible for visitor rewards.';
	end if;

	insert into public.loyalty_point_transactions (
		visitor_id, points_delta, transaction_type, source_product_id,
		source_product_name, idempotency_key
	)
	select visitor_id, 1, 'visit_earned', gen_random_uuid(), 'Smoke test product ' || point_number,
		'smoke:' || point_number || ':' || visitor_id::text
	from unnest(array[visitor_one, visitor_two, visitor_three, visitor_four]) visitor_id
	cross join generate_series(1, 12) point_number;

	update public.loyalty_accounts set points_balance = 12 where visitor_id in (visitor_one, visitor_two, visitor_three, visitor_four);

	insert into public.loyalty_offers (
		id, title, summary, image_url, terms, offer_type, selection_method, status,
		minimum_points, points_cost, capacity, city, country_code, starts_at, ends_at, created_by
	)
	values
		(redemption_offer, 'Local gift smoke test', 'A guaranteed test gift', 'https://example.invalid/gift.png', 'Rollback-only test terms', 'redemption', 'first_come', 'published', 10, 8, 1, null, null, now() - interval '1 minute', now() + interval '10 minutes', admin_user),
		(multi_city_offer, 'Multi city smoke test', 'City-specific guaranteed test gift', 'https://example.invalid/city-gift.png', 'Rollback-only city quota terms', 'redemption', 'first_come', 'published', 1, 1, 3, null, null, now() - interval '1 minute', now() + interval '10 minutes', admin_user),
		(random_offer, 'Random gift smoke test', 'A limited test entry', 'https://example.invalid/draw.png', 'Rollback-only test terms', 'participation', 'random', 'published', 1, 3, 2, null, null, now() - interval '1 minute', now() + interval '10 minutes', admin_user);
	insert into public.loyalty_offer_city_quotas (offer_id, city_id, city, country_code, capacity)
	values
		(redemption_offer, doncaster_id, 'Doncaster', 'GB', 1),
		(multi_city_offer, doncaster_id, 'Doncaster', 'GB', 2),
		(multi_city_offer, leeds_id, 'Leeds', 'GB', 1),
		(random_offer, doncaster_id, 'Doncaster', 'GB', 1),
		(random_offer, leeds_id, 'Leeds', 'GB', 1);

	perform set_config('request.jwt.claim.sub', visitor_four::text, true);
	perform set_config('request.jwt.claims', jsonb_build_object('sub', visitor_four::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
	if exists (select 1 from public.get_visitor_loyalty_offers()) then
		raise exception 'A visitor without an enabled country must not see loyalty offers.';
	end if;

	perform set_config('request.jwt.claim.sub', visitor_one::text, true);
	perform set_config('request.jwt.claims', jsonb_build_object('sub', visitor_one::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
	if not public.is_visitor_city_locked() then
		raise exception 'A visitor in the offer city should be location-locked.';
	end if;
	begin
		update public.profiles set city_id = leeds_id where id = visitor_one;
		raise exception 'A matching active offer must prevent a city change.';
	exception when sqlstate '55000' then
		null;
	end;

	join_result := public.join_loyalty_offer(redemption_offer);
	if (join_result ->> 'alreadyJoined')::boolean then
		raise exception 'The first redemption should create a claim.';
	end if;
	select offers.capacity, offers.remaining_count, offers.locations
	into city_capacity, city_remaining, city_locations
	from public.get_visitor_loyalty_offers() offers where offers.id = multi_city_offer;
	if city_capacity <> 2 or city_remaining <> 2
		or not ('Doncaster, GB' = any(city_locations))
		or not ('Leeds, GB' = any(city_locations)) then
		raise exception 'Visitors should see the complete city list and their own quota.';
	end if;
	join_result := public.join_loyalty_offer(redemption_offer);
	if not (join_result ->> 'alreadyJoined')::boolean then
		raise exception 'Repeating a redemption should return the existing claim.';
	end if;
	select points_balance into current_balance from public.loyalty_accounts where visitor_id = visitor_one;
	if current_balance <> 4 then
		raise exception 'A repeated redemption must spend points exactly once; balance was %.', current_balance;
	end if;

	perform set_config('request.jwt.claim.sub', visitor_two::text, true);
	perform set_config('request.jwt.claims', jsonb_build_object('sub', visitor_two::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
	if not public.is_visitor_city_locked() then
		raise exception 'A visitor in any allocated offer city should be locked.';
	end if;
	begin
		perform public.join_loyalty_offer(redemption_offer);
		raise exception 'A visitor outside a single-city offer must not claim its gift.';
	exception when sqlstate '42501' then
		null;
	end;
	select points_balance into current_balance from public.loyalty_accounts where visitor_id = visitor_two;
	if current_balance <> 12 then
		raise exception 'A location-rejected redemption must not spend points.';
	end if;
	perform set_config('request.jwt.claim.sub', visitor_three::text, true);
	perform set_config('request.jwt.claims', jsonb_build_object('sub', visitor_three::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
	begin
		perform public.join_loyalty_offer(redemption_offer);
		raise exception 'A full guaranteed offer must reject another claim.';
	exception when sqlstate '55000' then
		null;
	end;
	select points_balance into current_balance from public.loyalty_accounts where visitor_id = visitor_two;
	if current_balance <> 12 then
		raise exception 'A rejected redemption must not spend points.';
	end if;
	perform public.join_loyalty_offer(multi_city_offer);
	select offers.capacity, offers.remaining_count into city_capacity, city_remaining
	from public.get_visitor_loyalty_offers() offers where offers.id = multi_city_offer;
	if city_capacity <> 2 or city_remaining <> 1 then
		raise exception 'Doncaster should have capacity 2 with 1 remaining.';
	end if;

	perform set_config('request.jwt.claim.sub', visitor_two::text, true);
	perform set_config('request.jwt.claims', jsonb_build_object('sub', visitor_two::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
	perform public.join_loyalty_offer(multi_city_offer);
	select offers.capacity, offers.remaining_count into city_capacity, city_remaining
	from public.get_visitor_loyalty_offers() offers where offers.id = multi_city_offer;
	if city_capacity <> 1 or city_remaining <> 0 then
		raise exception 'Leeds should have its separate capacity of 1, fully claimed.';
	end if;

	if public.get_visitor_loyalty_offers() is null then
		raise exception 'Offer visibility function returned null.';
	end if;
	if exists (select 1 from public.get_visitor_loyalty_offers() offer where offer.id = random_offer) then
		raise exception 'A random offer must stay hidden while random draws are disabled.';
	end if;
	begin
		perform public.join_loyalty_offer(random_offer);
		raise exception 'A random offer must reject entries while draws are disabled.';
	exception when sqlstate '55000' then
		null;
	end;
	select points_balance into current_balance from public.loyalty_accounts where visitor_id = visitor_two;
	if current_balance <> 11 then
		raise exception 'A rejected disabled-draw entry must not spend points.';
	end if;

	perform set_config('request.jwt.claim.sub', admin_user::text, true);
	perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_user::text, 'role', 'authenticated', 'app_metadata', '{"role":"admin"}'::jsonb)::text, true);
	perform public.admin_set_loyalty_random_draws_enabled(true);

	perform set_config('request.jwt.claim.sub', visitor_one::text, true);
	perform set_config('request.jwt.claims', jsonb_build_object('sub', visitor_one::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
	perform public.join_loyalty_offer(random_offer);
	perform set_config('request.jwt.claim.sub', visitor_two::text, true);
	perform set_config('request.jwt.claims', jsonb_build_object('sub', visitor_two::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
	perform public.join_loyalty_offer(random_offer);
	perform set_config('request.jwt.claim.sub', visitor_three::text, true);
	perform set_config('request.jwt.claims', jsonb_build_object('sub', visitor_three::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
	perform public.join_loyalty_offer(random_offer);

	perform set_config('request.jwt.claim.sub', admin_user::text, true);
	perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_user::text, 'role', 'authenticated', 'app_metadata', '{"role":"admin"}'::jsonb)::text, true);
	update public.loyalty_offers set ends_at = now() - interval '1 second' where id = random_offer;
	winner_count := public.admin_run_loyalty_offer_draw(random_offer);
	if winner_count <> 2 then
		raise exception 'The draw should choose the configured two winners; got %.', winner_count;
	end if;
	select count(*) into won_count from public.loyalty_offer_claims where offer_id = random_offer and status = 'won';
	select count(*) into lost_count from public.loyalty_offer_claims where offer_id = random_offer and status = 'lost';
	if won_count <> 2 or lost_count <> 1 then
		raise exception 'Per-city draw counts were incorrect: % selected, % not selected.', won_count, lost_count;
	end if;
	select points_balance into current_balance from public.loyalty_accounts where visitor_id = visitor_one;
	if current_balance <> 1 then
		raise exception 'Visitor one expected balance 1 after redemption and draw; got %.', current_balance;
	end if;
	select points_balance into current_balance from public.loyalty_accounts where visitor_id = visitor_two;
	if current_balance <> 8 then
		raise exception 'Visitor two expected balance 8 after city claim and draw; got %.', current_balance;
	end if;
	select points_balance into current_balance from public.loyalty_accounts where visitor_id = visitor_three;
	if current_balance <> 8 then
		raise exception 'Visitor three expected balance 8 after city claim and draw; got %.', current_balance;
	end if;
	if (select points_balance from public.loyalty_accounts where visitor_id = visitor_four) <> 12 then
		raise exception 'A visitor who did not participate must keep all points.';
	end if;

	perform set_config('request.jwt.claim.sub', visitor_three::text, true);
	perform set_config('request.jwt.claims', jsonb_build_object('sub', visitor_three::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
	if public.get_visitor_loyalty_points() <> 8 then
		raise exception 'Visitor balance RPC should return the ledger-backed balance.';
	end if;
	select status.daily_cap, status.points_earned
	into daily_cap, daily_earned
	from public.get_visitor_daily_visit_points_status() status;
	if daily_cap not between 1 and 250 or daily_earned <> 12 then
		raise exception 'Visitor daily points status should report the configured cap and recent earned points.';
	end if;
	if (select count(*) from public.get_visitor_loyalty_activity(5, 0)) <> 5
		or exists (
			select id from public.get_visitor_loyalty_activity(5, 0)
			intersect
			select id from public.get_visitor_loyalty_activity(5, 5)
		) then
		raise exception 'Point history pages should contain distinct stable rows.';
	end if;
	if (select count(*) from public.get_visitor_offer_history(1, 0)) <> 1 then
		raise exception 'Offer history should respect its requested page size.';
	end if;
	select id into test_product_id from public.products limit 1;
	if test_product_id is not null then
		update public.marketplace_settings set visitor_daily_visit_points_cap = 12 where singleton = true;
		insert into public.visitor_product_points (visitor_id, product_id)
		values (visitor_three, test_product_id)
		on conflict (visitor_id, product_id) do nothing;
		if (select count(*) from public.loyalty_point_transactions
			where visitor_id = visitor_three and transaction_type = 'visit_earned') <> 12 then
			raise exception 'A visitor at the daily cap must not receive another visit point.';
		end if;
	end if;

		raise exception using errcode = 'P0001', message = '__ROLLBACK_LOYALTY_SMOKE__';
	exception when sqlstate 'P0001' then
		if sqlerrm <> '__ROLLBACK_LOYALTY_SMOKE__' then
			raise;
		end if;
	end;
end;
$$;