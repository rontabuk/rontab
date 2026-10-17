do $$
declare
	admin_user uuid := gen_random_uuid();
	seller_user uuid := gen_random_uuid();
	other_user uuid := gen_random_uuid();
	seller_id uuid;
	other_seller_id uuid;
	request_id uuid := gen_random_uuid();
	other_request_id uuid := gen_random_uuid();
	current_rate integer := public.get_click_price_pence_per_1000();
	requested_clicks integer;
	purchase public.seller_credit_purchases;
	initial_balance bigint;
	initial_welcome bigint;
	initial_admin bigint;
	session_id text := 'cs_test_' || replace(request_id::text, '-', '');
	intent_id text := 'pi_' || replace(request_id::text, '-', '');
	event_id text := 'evt_' || replace(request_id::text, '-', '');
begin
	begin
		requested_clicks := greatest(1000, ceil(30.0 / current_rate)::integer * 1000);
		insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
		values
			(admin_user, 'authenticated', 'authenticated', admin_user::text || '@billing-admin-test.invalid', '', now(), '{"role":"admin"}', '{}', now(), now()),
			(seller_user, 'authenticated', 'authenticated', seller_user::text || '@billing-test.invalid', '', now(), '{}', jsonb_build_object('account_type', 'seller', 'shop_name', 'Billing test', 'shop_slug', 'billing-' || seller_user::text), now(), now()),
			(other_user, 'authenticated', 'authenticated', other_user::text || '@billing-test.invalid', '', now(), '{}', jsonb_build_object('account_type', 'seller', 'shop_name', 'Other billing test', 'shop_slug', 'billing-' || other_user::text), now(), now());
		select id into seller_id from public.seller_profiles where user_id = seller_user;
		select id into other_seller_id from public.seller_profiles where user_id = other_user;
		perform set_config('request.jwt.claim.sub', admin_user::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_user::text, 'role', 'authenticated', 'app_metadata', '{"role":"admin"}'::jsonb)::text, true);
		perform public.admin_set_seller_status(seller_id, 'active', true);
		perform public.admin_set_seller_status(other_seller_id, 'active', true);
		select clicks_remaining, welcome_clicks_remaining, admin_clicks_remaining
		into initial_balance, initial_welcome, initial_admin from public.seller_ad_accounts where seller_profile_id = seller_id;
		select * into purchase from public.seller_create_credit_purchase(seller_id, requested_clicks, request_id, current_rate);
		if purchase.amount_pence <> (requested_clicks / 1000) * current_rate or not purchase.is_test or purchase.currency <> 'gbp' then
			raise exception 'The purchase must snapshot the configured GBP price in test mode.';
		end if;
		perform public.seller_create_credit_purchase(seller_id, requested_clicks, request_id, current_rate);
		if (select count(*) from public.seller_credit_purchases where id = request_id) <> 1 then
			raise exception 'Retrying checkout must not create another purchase.';
		end if;
		begin
			perform public.seller_create_credit_purchase(seller_id, 1001, gen_random_uuid(), current_rate);
			raise exception 'A non-step quantity must be rejected.';
		exception when sqlstate '22023' then null;
		end;
		begin
			perform public.seller_create_credit_purchase(seller_id, requested_clicks, gen_random_uuid(), current_rate + 1);
			raise exception 'An altered or stale rate must be rejected.';
		exception when sqlstate '22023' then null;
		end;
		begin
			perform public.seller_create_credit_purchase(other_seller_id, requested_clicks, request_id, current_rate);
			raise exception 'Another seller must not reuse a purchase ID.';
		exception when sqlstate '22023' then null;
		end;
		perform public.seller_create_credit_purchase(other_seller_id, requested_clicks, other_request_id, current_rate);
		if has_function_privilege('anon', 'public.seller_create_credit_purchase(uuid,integer,uuid,integer)', 'execute')
			or has_function_privilege('authenticated', 'public.seller_create_credit_purchase(uuid,integer,uuid,integer)', 'execute')
			or has_function_privilege('anon', 'public.is_active_seller_owner(uuid)', 'execute')
			or not has_function_privilege('authenticated', 'public.is_active_seller_owner(uuid)', 'execute')
			or has_function_privilege('anon', 'public.handle_new_user()', 'execute')
			or has_function_privilege('authenticated', 'public.handle_new_user()', 'execute')
			or has_function_privilege('anon', 'public.normalize_and_lock_profile_city()', 'execute')
			or has_function_privilege('authenticated', 'public.normalize_and_lock_profile_city()', 'execute')
			or has_function_privilege('anon', 'public.reject_unsupported_profile_city()', 'execute')
			or has_function_privilege('authenticated', 'public.reject_unsupported_profile_city()', 'execute')
			or has_function_privilege('anon', 'public.reject_unsupported_seller_city()', 'execute')
			or has_function_privilege('authenticated', 'public.reject_unsupported_seller_city()', 'execute')
			or has_function_privilege('anon', 'public.sync_seller_contact_email()', 'execute')
			or has_function_privilege('authenticated', 'public.sync_seller_contact_email()', 'execute')
			or has_function_privilege('anon', 'public.billing_complete_credit_purchase(uuid,text,text,integer,text,text)', 'execute')
			or has_function_privilege('authenticated', 'public.billing_attach_credit_checkout(uuid,text)', 'execute') then
			raise exception 'Billing RPC permissions are too broad.';
		end if;
		perform public.billing_attach_credit_checkout(request_id, session_id);
		begin
			perform public.billing_attach_credit_checkout(request_id, 'cs_live_invalid');
			raise exception 'Live sessions must be rejected.';
		exception when sqlstate '22023' then null;
		end;
		begin
			perform public.billing_complete_credit_purchase(request_id, session_id, intent_id, purchase.amount_pence + 1, 'gbp', event_id);
			raise exception 'An incorrect payment amount must be rejected.';
		exception when sqlstate '22023' then null;
		end;
		begin
			perform public.billing_complete_credit_purchase(request_id, session_id, intent_id, purchase.amount_pence, 'usd', event_id);
			raise exception 'An incorrect payment currency must be rejected.';
		exception when sqlstate '22023' then null;
		end;
		if (select clicks_remaining from public.seller_ad_accounts where seller_profile_id = seller_id) <> initial_balance then
			raise exception 'Rejected payments must not change credit balance.';
		end if;
		if not public.billing_complete_credit_purchase(request_id, session_id, intent_id, purchase.amount_pence, 'gbp', event_id) then
			raise exception 'The first confirmed payment should grant credits.';
		end if;
		if public.billing_complete_credit_purchase(request_id, session_id, intent_id, purchase.amount_pence, 'gbp', event_id)
			or public.billing_complete_credit_purchase(request_id, session_id, intent_id, purchase.amount_pence, 'gbp', event_id || '_retry') then
			raise exception 'Payment redelivery must not grant credits again.';
		end if;
		if not exists (select 1 from public.seller_ad_accounts where seller_profile_id = seller_id
			and clicks_remaining = initial_balance + requested_clicks
			and welcome_clicks_remaining = initial_welcome and admin_clicks_remaining = initial_admin) then
			raise exception 'Paid top-up must preserve gift balances and grant credits exactly once.';
		end if;
		perform public.billing_expire_credit_purchase(request_id, session_id);
		if (select status from public.seller_credit_purchases where id = request_id) <> 'paid' then
			raise exception 'A late expiry event must not undo a confirmed payment.';
		end if;
		perform public.billing_attach_credit_checkout(other_request_id, session_id || '_other');
		begin
			perform public.billing_complete_credit_purchase(other_request_id, session_id || '_other', intent_id, purchase.amount_pence, 'gbp', event_id || '_other');
			raise exception 'The same PaymentIntent must not pay for another purchase.';
		exception when unique_violation then null;
		end;
		if (select clicks_remaining from public.seller_ad_accounts where seller_profile_id = other_seller_id) <> 10000 then
			raise exception 'A rejected duplicate payment must roll back the other credit grant.';
		end if;
		raise exception using errcode = 'P0001', message = '__ROLLBACK_BILLING_SMOKE__';
	exception when sqlstate 'P0001' then
		if sqlerrm <> '__ROLLBACK_BILLING_SMOKE__' then raise; end if;
	end;
end;
$$;