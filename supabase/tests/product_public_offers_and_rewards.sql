do $$
<<product_offer_test>>
declare
  admin_user uuid := gen_random_uuid();
  seller_user uuid := gen_random_uuid();
  other_user uuid := gen_random_uuid();
  visitor_user uuid := gen_random_uuid();
  second_visitor uuid := gen_random_uuid();
  seller_id uuid;
  product_id uuid := gen_random_uuid();
  category_id uuid;
  city_id text;
  second_city text;
  request_id uuid := gen_random_uuid();
  offer_id uuid;
  free_offer_id uuid;
  location_id uuid;
  second_location uuid;
  coupon_id uuid;
  tomorrow date := timezone('Europe/London', now())::date + 1;
  payload jsonb;
  result jsonb;
  first_key uuid := gen_random_uuid();
  future_city text := 'GB-' || (9900000000 + floor(random() * 100000000)::bigint)::text;
  another_offer_id uuid;
  old_coupon_id uuid;
  participant uuid;
  participant_index integer;
begin
  begin
  select category.id into category_id from public.categories category limit 1;
  select city.city_id into city_id from public.supported_cities city
    join public.supported_countries country using(country_code)
    where city.country_code = 'GB' and city.is_enabled and country.is_enabled limit 1;
  if category_id is null or city_id is null then raise exception 'Category and UK city fixtures required.'; end if;
  select city.city_id into second_city from public.supported_cities city
    join public.supported_countries country using(country_code)
    where city.country_code = 'GB' and city.is_enabled and country.is_enabled and city.city_id <> product_offer_test.city_id limit 1;
  if second_city is null then raise exception 'Two supported UK cities required.'; end if;
  insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (admin_user, 'authenticated', 'authenticated', admin_user || '@offer-test.invalid', '', now(), '{"role":"admin"}', '{}', now(), now()),
    (seller_user, 'authenticated', 'authenticated', seller_user || '@offer-test.invalid', '', now(), '{}',
      jsonb_build_object('account_type','seller','shop_name','Product offer test','shop_slug','offer-test-' || seller_user), now(), now()),
    (other_user, 'authenticated', 'authenticated', other_user || '@offer-test.invalid', '', now(), '{}',
      jsonb_build_object('account_type','seller','shop_name','Other offer test','shop_slug','offer-test-' || other_user), now(), now()),
    (visitor_user, 'authenticated', 'authenticated', visitor_user || '@offer-test.invalid', '', now(), '{}', '{"account_type":"visitor"}', now(), now()),
    (second_visitor, 'authenticated', 'authenticated', second_visitor || '@offer-test.invalid', '', now(), '{}', '{"account_type":"visitor"}', now(), now());
  perform set_config('request.jwt.claim.sub', admin_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',admin_user,'role','authenticated','app_metadata','{"role":"admin"}'::jsonb)::text, true);
  update public.seller_profiles set status = 'active', is_public = true where user_id in (seller_user, other_user);
  select seller.id into seller_id from public.seller_profiles seller where seller.user_id = seller_user;
  update public.profiles profile set city_id = product_offer_test.city_id where profile.id = visitor_user;
  update public.profiles set email_verified_at = now() where id = visitor_user;
  update public.loyalty_accounts set points_balance = 250 where visitor_id = visitor_user;
  update public.profiles set city_id = second_city, email_verified_at = now() where id = second_visitor;
  update public.loyalty_accounts set points_balance = 250 where visitor_id = second_visitor;
  insert into public.products(id, seller_profile_id, category_id, name, slug, description, external_url, status)
    values(product_id, seller_id, category_id, 'Product offer test', 'offer-test-' || product_id, 'Approved product description.', 'https://example.invalid/product', 'approved');
  insert into public.product_images(product_id, storage_path, media_type)
    values(product_id, seller_id || '/' || product_id || '/test.jpg', 'image');
  payload := jsonb_build_object('audience','reward','fulfillment','branch','offer_kind','discount','benefit_details','Exclusive 50 percent discount',
    'discount_percent',50,'city_id',city_id,'postcode','SW1A 1AA','valid_from',tomorrow,'valid_until',tomorrow + 1,
    'starts_at','10:00','ends_at','15:00','daily_capacity',2,'max_claims',1,'accept_terms',true);
  perform set_config('request.jwt.claim.sub', seller_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',seller_user,'role','authenticated')::text, true);
  offer_id := public.seller_publish_product_offer(request_id, product_id, payload);
  if public.seller_publish_product_offer(request_id, product_id, payload) <> offer_id then raise exception 'Publication retry created a duplicate.'; end if;
  if not exists(select 1 from public.seller_offers offer where offer.id = offer_id and audience = 'reward'
    and points_cost = 100 and auto_published and approved_by is null and status = 'published') then
    raise exception 'Reward must store its audience, use platform cost, and retain honest automated approval attribution.';
  end if;
  begin
    perform public.seller_publish_product_offer(request_id, product_id, payload || '{"benefit_details":"Changed benefit"}');
    raise exception 'Changed idempotent payload accepted.';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.seller_publish_product_offer(gen_random_uuid(), product_id, payload || '{"fulfillment":"online"}');
    raise exception 'Online points reward accepted.';
  exception when sqlstate '22023' then null; end;
  perform set_config('request.jwt.claim.sub', other_user::text, true);
  begin
    perform public.seller_publish_product_offer(gen_random_uuid(), product_id, payload);
    raise exception 'Another seller published an offer for this product.';
  exception when sqlstate '42501' then null; end;
  perform set_config('request.jwt.claim.sub', seller_user::text, true);
  free_offer_id := public.seller_publish_product_offer(gen_random_uuid(), product_id, payload || '{"audience":"general"}');
  if not exists(select 1 from public.seller_offers offer where offer.id = free_offer_id and audience = 'general' and points_cost = 100) then
    raise exception 'Public branch voucher did not retain its audience and use the configured points cost.';
  end if;
  perform public.seller_get_product_offer_audience();
  select location.id into location_id from public.seller_offer_locations location where location.offer_id = product_offer_test.offer_id;
  perform set_config('request.jwt.claim.sub', visitor_user::text, true);
  result := public.reserve_seller_offer_coupon(offer_id, location_id, tomorrow, '10:00', first_key);
  coupon_id := (result ->> 'id')::uuid;
  perform set_config('request.jwt.claim.sub', seller_user::text, true);
  result := public.seller_inspect_offer_coupon(result ->> 'code');
  if (result ->> 'canRedeem')::boolean or result ->> 'status' <> 'reserved'
    or (select coupon.status from public.seller_offer_coupons coupon where coupon.id = product_offer_test.coupon_id) <> 'reserved' then
    raise exception 'Checking a future voucher changed its state or allowed early redemption.';
  end if;
  perform set_config('request.jwt.claim.sub', visitor_user::text, true);
  if (select points_balance from public.loyalty_accounts where visitor_id = visitor_user) <> 150 then raise exception 'Reward did not deduct 100 points.'; end if;
  result := public.reserve_seller_offer_coupon(offer_id, location_id, tomorrow, '10:00', first_key);
  if (result ->> 'id')::uuid <> coupon_id or (select points_balance from public.loyalty_accounts where visitor_id = visitor_user) <> 150 then
    raise exception 'Retry spent points twice.';
  end if;
  begin
    perform public.reserve_seller_offer_coupon(offer_id, location_id, tomorrow + 1, '10:00', gen_random_uuid());
    raise exception 'Total offer capacity was exceeded across dates.';
  exception when sqlstate '55000' then null; end;
  perform public.cancel_seller_offer_coupon(coupon_id);
  perform public.cancel_seller_offer_coupon(coupon_id);
  if (select points_balance from public.loyalty_accounts where visitor_id = visitor_user) <> 250 then raise exception 'Cancellation refund was not exactly once.'; end if;
  perform public.reserve_seller_offer_coupon(offer_id, location_id, tomorrow + 1, '10:00', gen_random_uuid());
  perform set_config('request.jwt.claim.sub', seller_user::text, true);
  perform public.seller_cancel_product_offer(offer_id);
  perform public.seller_cancel_product_offer(offer_id);
  if (select points_balance from public.loyalty_accounts where visitor_id = visitor_user) <> 250
    or exists(select 1 from public.seller_offer_coupons coupon where coupon.offer_id = product_offer_test.offer_id and status = 'reserved') then
    raise exception 'Seller cancellation did not refund exactly once.';
  end if;
  select location.id into location_id from public.seller_offer_locations location where location.offer_id = free_offer_id;
  perform set_config('request.jwt.claim.sub', visitor_user::text, true);
  update public.loyalty_accounts set points_balance = 250 where visitor_id = visitor_user;
  result := public.reserve_seller_offer_coupon(free_offer_id, location_id, tomorrow, '10:00', gen_random_uuid());
  coupon_id := (result ->> 'id')::uuid;
  if (select points_balance from public.loyalty_accounts where visitor_id = visitor_user) <> 150
    or (select points_cost from public.seller_offer_coupons where id = product_offer_test.coupon_id) <> 100 then
    raise exception 'Public offer reservation did not deduct its configured points cost.';
  end if;
  perform public.cancel_seller_offer_coupon(coupon_id);
  if (select points_balance from public.loyalty_accounts where visitor_id = visitor_user) <> 250
    or not exists(select 1 from public.seller_offer_point_transactions transaction where transaction.coupon_id = product_offer_test.coupon_id and transaction.transaction_type = 'spent' and transaction.points_delta = -100)
    or not exists(select 1 from public.seller_offer_point_transactions transaction where transaction.coupon_id = product_offer_test.coupon_id and transaction.transaction_type = 'refund' and transaction.points_delta = 100) then
    raise exception 'Public offer cancellation did not refund its points exactly once.';
  end if;
  perform set_config('request.jwt.claim.sub', seller_user::text, true);
  offer_id := public.seller_publish_product_offer(gen_random_uuid(), product_id, payload || '{"audience":"general","fulfillment":"online","external_code":"PUBLIC50"}');
  if not exists(select 1 from public.seller_offers offer where offer.id = offer_id and offer.points_cost = 0
    and fulfillment = 'online' and external_url = 'https://example.invalid/product' and max_claims is null) then
    raise exception 'Public online offer did not preserve the product link.';
  end if;
  request_id := gen_random_uuid();
  payload := payload || '{"daily_capacity":1,"max_claims":3}';
  offer_id := public.seller_publish_product_offer_in_cities(request_id, product_id, payload, array[city_id, second_city]);
  if public.seller_publish_product_offer_in_cities(request_id, product_id, payload, array[second_city, city_id, city_id]) <> offer_id
    or (select count(*) from public.seller_offer_locations location where location.offer_id = product_offer_test.offer_id) <> 2
    or (select count(*) from public.seller_offer_request_locations location where location.request_id = product_offer_test.request_id) <> 2
    or (select count(*) from public.seller_offer_daily_quotas quota join public.seller_offer_locations location on location.id = quota.location_id
      where location.offer_id = product_offer_test.offer_id) <> 4 then
    raise exception 'Multi-city publication or order-independent retry failed.';
  end if;
  begin
    perform public.seller_publish_product_offer_in_cities(request_id, product_id, payload, array[city_id]);
    raise exception 'Changed audience cities accepted for an existing publication key.';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.seller_publish_product_offer_in_cities(gen_random_uuid(), product_id, payload, array[city_id, 'GB-not-a-supported-city']);
    raise exception 'Unsupported target city accepted.';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.seller_publish_product_offer_in_cities(gen_random_uuid(), product_id, payload, null);
    raise exception 'Null audience accepted.';
  exception when sqlstate '22023' then null; end;
  select location.id into location_id from public.seller_offer_locations location
    where location.offer_id = product_offer_test.offer_id and location.city_id = product_offer_test.city_id;
  select location.id into second_location from public.seller_offer_locations location
    where location.offer_id = product_offer_test.offer_id and location.city_id = second_city;
  update public.loyalty_accounts set points_balance = 250 where visitor_id = visitor_user;
  perform set_config('request.jwt.claim.sub', visitor_user::text, true);
  result := public.reserve_seller_offer_coupon(offer_id, location_id, tomorrow, '10:00', gen_random_uuid());
  coupon_id := (result ->> 'id')::uuid;
  if (select remaining_claims from public.get_public_seller_offer_daily_availability(array[offer_id]) availability where availability.offer_date = tomorrow) <> 0 then
    raise exception 'Public availability did not reflect the shared daily cap.';
  end if;
  perform set_config('request.jwt.claim.sub', second_visitor::text, true);
  begin
    perform public.reserve_seller_offer_coupon(offer_id, second_location, tomorrow, '10:00', gen_random_uuid());
    raise exception 'Daily capacity multiplied across audience cities.';
  exception when sqlstate '55000' then null; end;
  perform public.reserve_seller_offer_coupon(offer_id, second_location, tomorrow + 1, '10:00', gen_random_uuid());
  perform set_config('request.jwt.claim.sub', visitor_user::text, true);
  perform public.cancel_seller_offer_coupon(coupon_id);
  if (select remaining_claims from public.get_public_seller_offer_daily_availability(array[offer_id]) availability where availability.offer_date = tomorrow) <> 1 then
    raise exception 'Cancellation did not restore shared daily availability.';
  end if;
  perform set_config('request.jwt.claim.sub', second_visitor::text, true);
  first_key := gen_random_uuid();
  result := public.reserve_seller_offer_coupon(offer_id, second_location, tomorrow, '10:00', first_key);
  if public.reserve_seller_offer_coupon(offer_id, second_location, tomorrow, '10:00', first_key) ->> 'id' <> result ->> 'id' then
    raise exception 'Multi-city reservation retry failed.';
  end if;
  perform set_config('request.jwt.claim.sub', seller_user::text, true);
  perform public.seller_cancel_product_offer(offer_id);
  if (select points_balance from public.loyalty_accounts where visitor_id = second_visitor) <> 250 then
    raise exception 'Multi-city cancellation did not refund all reserved customer points.';
  end if;
  offer_id := public.seller_publish_product_offer_in_cities(gen_random_uuid(), product_id,
    payload || '{"audience":"general","fulfillment":"online"}', array[city_id, second_city]);
  if (select count(*) from public.seller_offer_locations location where location.offer_id = product_offer_test.offer_id) <> 2
    or exists(select 1 from public.seller_offer_daily_quotas quota join public.seller_offer_locations location on location.id = quota.location_id
      where location.offer_id = product_offer_test.offer_id) then
    raise exception 'Online multi-city offers created voucher quotas.';
  end if;
  begin
    perform public.admin_set_seller_reward_points(75);
    raise exception 'A seller changed reward point settings.';
  exception when sqlstate '42501' then null; end;
  perform set_config('request.jwt.claim.sub', admin_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',admin_user,'role','authenticated','app_metadata','{"role":"admin"}'::jsonb)::text, true);
  begin
    perform public.admin_set_seller_reward_points(49);
    raise exception 'Point cost below 50 accepted.';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.admin_decide_seller_offer_request(gen_random_uuid(), 'approve', null, 49, 'Test final terms.', '[]');
    raise exception 'Reviewed reward below 50 points accepted.';
  exception when sqlstate '22023' then null; end;
  perform public.admin_set_seller_reward_points(75);
  perform set_config('request.jwt.claim.sub', seller_user::text, true);
  perform set_config('request.jwt.claims', '{}', true);
  request_id := gen_random_uuid();
  payload := payload || '{"daily_capacity":20,"max_claims":20}';
  offer_id := public.seller_publish_product_offer_in_cities(request_id, product_id, payload, array[]::text[]);
  if not exists(select 1 from public.seller_offers offer where offer.id = product_offer_test.offer_id and audience = 'reward' and target_all_uk and points_cost = 75)
    or (select count(*) from public.seller_offer_locations location where location.offer_id = product_offer_test.offer_id) <> 1 then
    raise exception 'All UK did not use the administrator default or created duplicated quotas.';
  end if;
  insert into public.supported_cities(city_id, country_code, city_name, city_ascii, is_enabled)
    values(future_city, 'GB', 'Future offer test ' || product_id, 'Future offer test ' || product_id, true);
  update public.profiles set city_id = future_city where id = visitor_user;
  update public.loyalty_accounts set points_balance = 500 where visitor_id in (visitor_user, second_visitor);
  select location.id into location_id from public.seller_offer_locations location where location.offer_id = product_offer_test.offer_id;
  perform set_config('request.jwt.claim.sub', visitor_user::text, true);
  first_key := gen_random_uuid();
  result := public.reserve_seller_offer_coupon_at_cost(offer_id, location_id, tomorrow, '10:00', first_key, 75);
  old_coupon_id := (result ->> 'id')::uuid;
  perform set_config('request.jwt.claim.sub', seller_user::text, true);
  another_offer_id := public.seller_publish_product_offer_in_cities(gen_random_uuid(), product_id, payload, array[]::text[]);
  select location.id into second_location from public.seller_offer_locations location where location.offer_id = another_offer_id;
  perform set_config('request.jwt.claim.sub', visitor_user::text, true);
  perform public.reserve_seller_offer_coupon(another_offer_id, second_location, tomorrow, '10:00', gen_random_uuid());
  if (select points_balance from public.loyalty_accounts where visitor_id = visitor_user) <> 350 then
    raise exception 'The same visitor could not reserve a different offer immediately.';
  end if;
  perform set_config('request.jwt.claim.sub', admin_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',admin_user,'role','authenticated','app_metadata','{"role":"admin"}'::jsonb)::text, true);
  perform public.admin_set_seller_reward_points(125, offer_id);
  perform public.admin_set_seller_reward_points(200);
  if (select points_cost from public.seller_offer_coupons coupon where coupon.id = old_coupon_id) <> 75 then
    raise exception 'Repricing changed a previously reserved voucher.';
  end if;
  perform set_config('request.jwt.claim.sub', second_visitor::text, true);
  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform public.reserve_seller_offer_coupon_at_cost(offer_id, location_id, tomorrow, '10:00', gen_random_uuid(), 75);
    raise exception 'A stale point quote was charged at a new price.';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%point cost has changed%' then raise; end if;
  end;
  if (select points_balance from public.loyalty_accounts where visitor_id = second_visitor) <> 500 then
    raise exception 'Rejecting a stale quote changed the visitor balance.';
  end if;
  result := public.reserve_seller_offer_coupon_at_cost(offer_id, location_id, tomorrow, '10:00', gen_random_uuid(), 125);
  if (select points_balance from public.loyalty_accounts where visitor_id = second_visitor) <> 375 then
    raise exception 'New reservation did not use the new per-offer price.';
  end if;
  perform set_config('request.jwt.claim.sub', visitor_user::text, true);
  result := public.reserve_seller_offer_coupon_at_cost(offer_id, location_id, tomorrow, '10:00', first_key, 75);
  if (result ->> 'id')::uuid <> old_coupon_id or (select points_balance from public.loyalty_accounts where visitor_id = visitor_user) <> 350 then
    raise exception 'Retrying after repricing created another voucher or spent more points.';
  end if;
  perform set_config('request.jwt.claim.sub', seller_user::text, true);
  if public.seller_publish_product_offer_in_cities(request_id, product_id, payload, array[]::text[]) <> offer_id
    or (select points_cost from public.seller_offers offer where offer.id = product_offer_test.offer_id) <> 125 then
    raise exception 'Publication retry reset an administrator-adjusted price.';
  end if;
  perform public.seller_cancel_product_offer(offer_id);
  if (select points_balance from public.loyalty_accounts where visitor_id = visitor_user) <> 425
    or (select points_balance from public.loyalty_accounts where visitor_id = second_visitor) <> 500 then
    raise exception 'Cancellation did not refund each voucher original price.';
  end if;
  perform public.seller_cancel_product_offer(another_offer_id);
  offer_id := public.seller_publish_product_offer_in_cities(gen_random_uuid(), product_id, payload, array[]::text[]);
  select location.id into location_id from public.seller_offer_locations location where location.offer_id = product_offer_test.offer_id;
  for participant_index in 1..21 loop
    participant := gen_random_uuid();
    insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values(participant, 'authenticated', 'authenticated', participant || '@offer-test.invalid', '', now(), '{}', '{"account_type":"visitor"}', now(), now());
    update public.profiles set city_id = future_city, email_verified_at = now() where id = participant;
    update public.loyalty_accounts set points_balance = 500 where visitor_id = participant;
    perform set_config('request.jwt.claim.sub', participant::text, true);
    if participant_index <= 20 then
      perform public.reserve_seller_offer_coupon(offer_id, location_id, tomorrow, '10:00', gen_random_uuid());
    else
      begin
        perform public.reserve_seller_offer_coupon(offer_id, location_id, tomorrow, '10:00', gen_random_uuid());
        raise exception 'The twenty-first reservation exceeded a 20-voucher offer.';
      exception when sqlstate '55000' then null; end;
      if (select points_balance from public.loyalty_accounts where visitor_id = participant) <> 500 then
        raise exception 'Rejected twenty-first visitor was charged points.';
      end if;
    end if;
  end loop;
  if (select count(*) from public.seller_offer_coupons coupon where coupon.offer_id = product_offer_test.offer_id) <> 20 then
    raise exception 'A 20-voucher offer did not accept exactly 20 successful reservations.';
  end if;
  perform set_config('request.jwt.claim.sub', seller_user::text, true);
  offer_id := public.seller_publish_product_offer_in_cities(gen_random_uuid(), product_id, payload, array[]::text[]);
  select location.id into location_id from public.seller_offer_locations location where location.offer_id = product_offer_test.offer_id;
  update public.loyalty_accounts set points_balance = 1000 where visitor_id = visitor_user;
  perform set_config('request.jwt.claim.sub', visitor_user::text, true);
  first_key := gen_random_uuid();
  result := public.reserve_seller_offer_coupon(offer_id, location_id, tomorrow, '10:00', first_key);
  coupon_id := (result ->> 'id')::uuid;
  perform public.reserve_seller_offer_coupon(offer_id, location_id, tomorrow, '10:00', gen_random_uuid());
  perform public.reserve_seller_offer_coupon(offer_id, location_id, tomorrow + 1, '10:00', gen_random_uuid());
  update public.seller_offer_coupons set status = 'expired', expired_at = now() where id = (
    select claim.id from public.seller_offer_coupons claim where claim.offer_id = product_offer_test.offer_id and claim.id <> product_offer_test.coupon_id limit 1
  );
  if (select reservations_used from public.get_my_seller_offer_booking_limits(array[offer_id])) <> 3
    or (select points_balance from public.loyalty_accounts where visitor_id = visitor_user) <> 400 then
    raise exception 'Three immediate discount reservations across dates did not count and charge exactly once each.';
  end if;
  begin
    perform public.reserve_seller_offer_coupon(offer_id, location_id, tomorrow + 1, '10:00', gen_random_uuid());
    raise exception 'A fourth discount reservation was accepted.';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%3-reservation limit%' then raise; end if;
  end;
  result := public.reserve_seller_offer_coupon(offer_id, location_id, tomorrow, '10:00', first_key);
  if (result ->> 'id')::uuid <> coupon_id or (select points_balance from public.loyalty_accounts where visitor_id = visitor_user) <> 400 then
    raise exception 'Limit rejection or an idempotent retry charged additional points.';
  end if;
  perform public.cancel_seller_offer_coupon(coupon_id);
  if (select remaining_claims from public.get_public_seller_offer_availability(array[offer_id])) <> 18
    or (select reservations_used from public.get_my_seller_offer_booking_limits(array[offer_id])) <> 2 then
    raise exception 'Cancellation did not restore capacity and one personal discount reservation.';
  end if;
  perform public.reserve_seller_offer_coupon(offer_id, location_id, tomorrow, '10:00', gen_random_uuid());
  if (select reservations_used from public.get_my_seller_offer_booking_limits(array[offer_id])) <> 3
    or (select points_balance from public.loyalty_accounts where visitor_id = visitor_user) <> 400 then
    raise exception 'Rebooking after cancellation failed or used the wrong refund amount.';
  end if;
  perform set_config('request.jwt.claim.sub', second_visitor::text, true);
  if (select reservations_used from public.get_my_seller_offer_booking_limits(array[offer_id])) <> 0 then
    raise exception 'Personal booking limits leaked another visitor history.';
  end if;
  perform set_config('request.jwt.claim.sub', seller_user::text, true);
  free_offer_id := public.seller_publish_product_offer_in_cities(gen_random_uuid(), product_id,
    payload || '{"audience":"general","offer_kind":"free_item","discount_percent":null}', array[]::text[]);
  another_offer_id := public.seller_publish_product_offer_in_cities(gen_random_uuid(), product_id,
    payload || '{"audience":"general","offer_kind":"meal","discount_percent":null}', array[]::text[]);
  select location.id into location_id from public.seller_offer_locations location where location.offer_id = free_offer_id;
  select location.id into second_location from public.seller_offer_locations location where location.offer_id = another_offer_id;
  perform set_config('request.jwt.claim.sub', visitor_user::text, true);
  result := public.reserve_seller_offer_coupon(free_offer_id, location_id, tomorrow, '10:00', gen_random_uuid());
  coupon_id := (result ->> 'id')::uuid;
  update public.seller_offers set product_id = null where id = free_offer_id;
  if (select redemption_product_id from public.seller_offers where id = free_offer_id) <> product_id then
    raise exception 'Clearing the product reference lost the durable redemption identity.';
  end if;
  begin
    perform public.reserve_seller_offer_coupon(another_offer_id, second_location, tomorrow, '10:00', gen_random_uuid());
    raise exception 'Republishing a free product bypassed its cooldown.';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%every 7 days%' then raise; end if;
  end;
  if (select next_free_at from public.get_my_seller_offer_booking_limits(array[another_offer_id])) <> now() + interval '7 days' then
    raise exception 'The free-product eligibility date was not based on the reservation timestamp.';
  end if;
  update public.seller_offer_coupons set created_at = now() - interval '7 days' where id = coupon_id;
  result := public.reserve_seller_offer_coupon(another_offer_id, second_location, tomorrow, '10:00', gen_random_uuid());
  old_coupon_id := (result ->> 'id')::uuid;
  perform public.cancel_seller_offer_coupon(coupon_id);
  perform public.cancel_seller_offer_coupon(old_coupon_id);
  if (select next_free_at from public.get_my_seller_offer_booking_limits(array[free_offer_id])) is not null then
    raise exception 'Cancelled free reservations still imposed a cooldown.';
  end if;
  perform public.reserve_seller_offer_coupon(free_offer_id, location_id, tomorrow, '10:00', gen_random_uuid());
  if (select points_balance from public.loyalty_accounts where visitor_id = visitor_user) <> 200 then
    raise exception 'Public free-product reservations did not charge and refund the configured points cost correctly.';
  end if;
  if has_function_privilege('authenticated', 'public.reserve_seller_offer_coupon_legacy(uuid,uuid,date,time,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.seller_publish_product_offer_initial(uuid,uuid,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.seller_publish_product_offer_selected_cities(uuid,uuid,jsonb,text[])', 'EXECUTE')
    or has_function_privilege('anon', 'public.seller_publish_product_offer(uuid,uuid,jsonb)', 'EXECUTE')
    or has_function_privilege('anon', 'public.seller_publish_product_offer_in_cities(uuid,uuid,jsonb,text[])', 'EXECUTE') then
    raise exception 'Offer RPC permissions are too broad.';
  end if;
  raise notice 'PASS: 3 discount reservations, 7-day free-product cooldown across republishing, cancellation reopening, private eligibility, All UK, admin pricing, shared caps and idempotency.';
  raise exception using errcode = 'ZX001', message = 'Rollback test fixtures.';
  exception when sqlstate 'ZX001' then null;
  end;
end;
$$;