do $$
declare
	admin_user uuid := gen_random_uuid();
	seller_user uuid := gen_random_uuid();
	other_seller_user uuid := gen_random_uuid();
	visitor_one_id uuid := gen_random_uuid();
	visitor_two_id uuid := gen_random_uuid();
	seller_id uuid;
	other_seller_id uuid;
	target_request_id uuid := gen_random_uuid();
	approved_offer_id uuid;
	target_location_id uuid;
	reservation_id uuid;
	test_city_id text;
	offer_media_path text;
	valid_from date := (timezone('Europe/London', now())::date + 1);
	valid_until date := (timezone('Europe/London', now())::date + 7);
	target_offer_date date;
	target_start_time time;
	first_coupon_code text;
	first_idempotency_key uuid := gen_random_uuid();
	voucher_support_case_id uuid;
	duplicate_voucher_support_case_id uuid;
	expected_audience_count bigint;
	estimated_audience_count bigint;
	voucher_metric_issued bigint;
	voucher_metric_redeemed bigint;
	audience_is_withheld boolean;
	weekday integer;
	payload jsonb;
	result jsonb;
	schedule_capacities jsonb;
begin
	begin
	select supported_city.city_id into test_city_id
	from public.supported_cities supported_city
	join public.supported_countries supported_country on supported_country.country_code = supported_city.country_code
	where supported_city.country_code = 'GB'
		and supported_city.is_enabled and supported_country.is_enabled
	order by supported_city.city_name
	limit 1;
	if test_city_id is null then
		raise exception 'An enabled UK city fixture is required.';
	end if;
	weekday := extract(dow from valid_from)::integer;

	insert into auth.users (
		id, aud, role, email, encrypted_password, email_confirmed_at,
		raw_app_meta_data, raw_user_meta_data, created_at, updated_at
	)
	values
		(admin_user, 'authenticated', 'authenticated', admin_user::text || '@offer-smoke.invalid', '', now(), '{"role":"admin"}', '{}', now(), now()),
		(seller_user, 'authenticated', 'authenticated', seller_user::text || '@offer-smoke.invalid', '', now(), '{}', jsonb_build_object('account_type', 'seller', 'shop_name', 'Offer smoke seller', 'shop_slug', 'offer-smoke-' || seller_user::text), now(), now()),
		(other_seller_user, 'authenticated', 'authenticated', other_seller_user::text || '@offer-smoke.invalid', '', now(), '{}', jsonb_build_object('account_type', 'seller', 'shop_name', 'Other offer seller', 'shop_slug', 'other-offer-smoke-' || other_seller_user::text), now(), now()),
		(visitor_one_id, 'authenticated', 'authenticated', visitor_one_id::text || '@offer-smoke.invalid', '', now(), '{}', '{"account_type":"visitor"}', now(), now()),
		(visitor_two_id, 'authenticated', 'authenticated', visitor_two_id::text || '@offer-smoke.invalid', '', now(), '{}', '{"account_type":"visitor"}', now(), now());

	perform set_config('request.jwt.claim.sub', admin_user::text, true);
	perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_user::text, 'role', 'authenticated', 'app_metadata', '{"role":"admin"}'::jsonb)::text, true);
	select id into seller_id from public.seller_profiles where user_id = seller_user;
	select id into other_seller_id from public.seller_profiles where user_id = other_seller_user;
	perform public.admin_set_seller_status(seller_id, 'active', true);
	perform public.admin_set_seller_status(other_seller_id, 'active', true);
	offer_media_path := seller_id::text || '/' || target_request_id::text || '/' || gen_random_uuid()::text || '-smoke.jpg';
	insert into storage.objects (bucket_id, name, owner, owner_id)
	values ('seller-offer-media', offer_media_path, seller_user, seller_user::text);
	if offer_media_path !~ ('^' || seller_id::text || '/' || target_request_id::text || '/[0-9a-f-]{36}-[^/]+$') then
		raise exception 'Offer media fixture path does not match owner/request/uuid pattern: %.', offer_media_path;
	end if;
	if not exists (select 1 from storage.objects object where object.bucket_id = 'seller-offer-media' and object.name = offer_media_path) then
		raise exception 'Offer media fixture object is missing from Storage: %.', offer_media_path;
	end if;
	update public.profiles set city_id = test_city_id, email_verified_at = now()
	where id in (visitor_one_id, visitor_two_id);
	update public.loyalty_accounts set points_balance = 50
	where visitor_id in (visitor_one_id, visitor_two_id);

	payload := jsonb_build_object(
		'offer_kind', 'discount',
		'title', 'Smoke test lunch offer',
		'description', 'A rollback-only seller offer request for database testing.',
		'benefit_details', 'Half price for the first five visitors each day.',
		'discount_percent', 50,
		'media_url', null,
		'media_storage_path', offer_media_path,
		'media_type', 'image',
		'valid_from', valid_from,
		'valid_until', valid_until,
		'capacity_acknowledged', true,
		'locations', jsonb_build_array(jsonb_build_object(
			'city_id', test_city_id,
			'branch_name', 'Smoke test branch',
			'branch_address', '1 Test Street',
			'schedules', jsonb_build_array(jsonb_build_object(
				'weekday', weekday,
				'starts_at', '10:00',
				'ends_at', '15:00',
				'daily_capacity', 5
			), jsonb_build_object(
				'weekday', weekday,
				'starts_at', '16:00',
				'ends_at', '18:00',
				'daily_capacity', 8
			))
		))
	);
	if payload ->> 'media_storage_path' is distinct from offer_media_path then raise exception 'Payload did not preserve offer media path.'; end if;

	perform set_config('request.jwt.claim.sub', seller_user::text, true);
	perform set_config('request.jwt.claims', jsonb_build_object('sub', seller_user::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
	result := public.seller_save_offer_request(target_request_id, payload, true);
	if result ->> 'status' <> 'submitted' or (result ->> 'alreadySubmitted')::boolean then
		raise exception 'A valid seller request should enter review exactly once.';
	end if;
	if (select counts.registered_count from public.seller_get_location_registration_counts() counts where counts.city_id = test_city_id)
		is distinct from (select count(*) from public.profiles profile where profile.city_id = test_city_id)
		or (select counts.registered_count from public.seller_get_location_registration_counts() counts where counts.country_code = 'GB' and counts.city_id is null)
		is distinct from (select count(*) from public.profiles profile where profile.country_code = 'GB') then
		raise exception 'Seller location counts should match all registered profiles by city and country.';
	end if;
	if (select bucket.public from storage.buckets bucket where bucket.id = 'seller-offer-media') is distinct from false then
		raise exception 'Seller offer uploads must remain private until an offer is published.';
	end if;
	payload := jsonb_set(payload, '{media_storage_path}', to_jsonb(seller_id::text || '/' || target_request_id::text || '/' || gen_random_uuid()::text || '-missing.jpg'));
	begin
		perform public.seller_save_offer_request(target_request_id, payload, false);
		raise exception 'An offer request must not reference an unuploaded or foreign storage object.';
	exception when sqlstate '22023' then
		null;
	end;
	payload := jsonb_set(payload, '{media_storage_path}', to_jsonb(offer_media_path));
	if (select count(*) from public.seller_offer_request_locations location where location.request_id = target_request_id) <> 1
		or (select count(*) from public.seller_offer_request_schedules schedule join public.seller_offer_request_locations location on location.id = schedule.location_id where location.request_id = target_request_id) <> 2
		or (select request.seller_terms_accepted_at from public.seller_offer_requests request where request.id = target_request_id) is null then
		raise exception 'Submission should atomically save the branch, schedule, and seller terms acceptance.';
	end if;
	select count(*) into expected_audience_count
	from public.profiles profile
	where profile.city_id = test_city_id and public.is_supported_loyalty_visitor(profile.id);
	select audience.registered_audience, audience.is_withheld
	into estimated_audience_count, audience_is_withheld
	from public.seller_get_offer_audience_estimates() audience
	where audience.request_id = target_request_id and audience.city_id = test_city_id;
	if expected_audience_count < 5 then
		if audience_is_withheld is distinct from true or estimated_audience_count is not null then
			raise exception 'City audiences under five eligible visitors must be withheld.';
		end if;
	elsif audience_is_withheld or estimated_audience_count <> expected_audience_count then
		raise exception 'City audiences at or above five should show only the aggregate visitor count.';
	end if;

	result := public.seller_save_offer_request(target_request_id, payload, true);
	if not (result ->> 'alreadySubmitted')::boolean then
		raise exception 'Retrying the same submission should return its existing request.';
	end if;

	begin
		perform public.seller_save_offer_request(target_request_id, jsonb_set(payload, '{title}', '"Changed offer title"'), true);
		raise exception 'A submitted request must not be changed without admin review.';
	exception when sqlstate '55000' then
		null;
	end;

	perform set_config('request.jwt.claim.sub', other_seller_user::text, true);
	perform set_config('request.jwt.claims', jsonb_build_object('sub', other_seller_user::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
	begin
		perform public.seller_save_offer_request(target_request_id,
			jsonb_set(jsonb_set(payload, '{media_storage_path}', 'null'::jsonb), '{media_url}', '"https://example.invalid/other.jpg"'::jsonb),
			true);
		raise exception 'A seller must not reuse another seller request.';
	exception when sqlstate '42501' then
		null;
	end;

	if has_table_privilege('authenticated', 'public.seller_offer_requests', 'INSERT')
		or has_table_privilege('authenticated', 'public.seller_offer_requests', 'UPDATE')
		or has_table_privilege('authenticated', 'public.seller_offer_request_locations', 'INSERT')
		or has_table_privilege('authenticated', 'public.seller_offer_request_schedules', 'INSERT') then
		raise exception 'Seller offer requests must only be mutated through the authorized RPC.';
	end if;
	if not has_table_privilege('authenticated', 'public.seller_offer_request_locations', 'SELECT')
		or not has_table_privilege('authenticated', 'public.seller_offer_request_schedules', 'SELECT') then
		raise exception 'Sellers and admins need RLS-scoped read access to request branches and schedules.';
	end if;
	if not has_function_privilege('authenticated', 'public.seller_save_offer_request(uuid,jsonb,boolean)', 'EXECUTE')
		or has_function_privilege('anon', 'public.seller_save_offer_request(uuid,jsonb,boolean)', 'EXECUTE')
		or not has_function_privilege('authenticated', 'public.seller_get_location_registration_counts()', 'EXECUTE')
		or has_function_privilege('anon', 'public.seller_get_location_registration_counts()', 'EXECUTE') then
		raise exception 'Seller request RPC permissions are incorrect.';
	end if;
	select jsonb_agg(jsonb_build_object('schedule_id', schedule.id, 'daily_capacity', 3))
	into schedule_capacities
	from public.seller_offer_request_schedules schedule
	join public.seller_offer_request_locations location on location.id = schedule.location_id
	where location.request_id = target_request_id;

	begin
		perform public.admin_decide_seller_offer_request(target_request_id, 'approve', null, 50, 'Final smoke test terms apply.', schedule_capacities);
		raise exception 'A seller must not review offer requests.';
	exception when sqlstate '42501' then
		null;
	end;

	perform set_config('request.jwt.claim.sub', admin_user::text, true);
	perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_user::text, 'role', 'authenticated', 'app_metadata', '{"role":"admin"}'::jsonb)::text, true);
	select jsonb_agg(jsonb_build_object(
		'schedule_id', schedule.id,
		'daily_capacity', case when schedule.starts_at = '10:00'::time then 1 else 4 end
	))
	into schedule_capacities
	from public.seller_offer_request_schedules schedule
	join public.seller_offer_request_locations location on location.id = schedule.location_id
	where location.request_id = target_request_id;
	approved_offer_id := public.admin_decide_seller_offer_request(target_request_id, 'approve', null, 50, 'Final smoke test terms apply.', schedule_capacities);
	if approved_offer_id is null
		or (select request.status from public.seller_offer_requests request where request.id = target_request_id) <> 'approved'
		or (select offer.media_storage_path from public.seller_offers offer where offer.id = approved_offer_id) <> offer_media_path
		or (select offer.points_cost from public.seller_offers offer where offer.id = approved_offer_id) <> 50
		or (select count(*) from public.seller_offer_schedules schedule join public.seller_offer_locations location on location.id = schedule.location_id where location.offer_id = approved_offer_id and ((schedule.starts_at = '10:00'::time and schedule.daily_capacity = 1) or (schedule.starts_at = '16:00'::time and schedule.daily_capacity = 4))) <> 2 then
		raise exception 'Admin approval should preserve distinct final capacities for each schedule.';
	end if;
	perform public.admin_set_seller_offer_status(approved_offer_id, 'published');
	if (select offer.status from public.seller_offers offer where offer.id = approved_offer_id) <> 'published'
		or (select count(*) from public.seller_offer_daily_quotas quota join public.seller_offer_locations location on location.id = quota.location_id where location.offer_id = approved_offer_id) < 1
		or not exists (select 1 from public.admin_audit_logs audit where audit.entity_type = 'seller_offer_request' and audit.entity_id = target_request_id and audit.action = 'seller_offer_request_approve')
		or not exists (select 1 from public.admin_audit_logs audit where audit.entity_type = 'seller_offer' and audit.entity_id = approved_offer_id and audit.action = 'seller_offer_published') then
		raise exception 'Publishing should create dated quota rows and audit review and publication.';
	end if;
	select quota.location_id, quota.offer_date, quota.starts_at
	into target_location_id, target_offer_date, target_start_time
	from public.seller_offer_daily_quotas quota
	join public.seller_offer_locations location on location.id = quota.location_id
	where location.offer_id = approved_offer_id
	order by quota.offer_date, quota.starts_at
	limit 1;

	perform set_config('request.jwt.claim.sub', visitor_one_id::text, true);
	perform set_config('request.jwt.claims', jsonb_build_object('sub', visitor_one_id::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
	result := public.reserve_seller_offer_coupon(approved_offer_id, target_location_id, target_offer_date, target_start_time, first_idempotency_key);
	reservation_id := (result ->> 'id')::uuid;
	first_coupon_code := result ->> 'code';
	if reservation_id is null or first_coupon_code is null or result ->> 'status' <> 'reserved'
		or (select account.points_balance from public.loyalty_accounts account where account.visitor_id = visitor_one_id) <> 0
		or (select quota.reserved_count from public.seller_offer_daily_quotas quota where quota.location_id = target_location_id and quota.offer_date = target_offer_date and quota.starts_at = target_start_time) <> 1 then
		raise exception 'A successful voucher booking should charge points and reserve one daily seat atomically.';
	end if;
	result := public.reserve_seller_offer_coupon(approved_offer_id, target_location_id, target_offer_date, target_start_time, first_idempotency_key);
	if result ->> 'code' <> first_coupon_code or not (result ->> 'alreadyReserved')::boolean
		or (select account.points_balance from public.loyalty_accounts account where account.visitor_id = visitor_one_id) <> 0 then
		raise exception 'Retrying the same booking must return the same voucher without charging again.';
	end if;

	perform set_config('request.jwt.claim.sub', visitor_two_id::text, true);
	perform set_config('request.jwt.claims', jsonb_build_object('sub', visitor_two_id::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
	begin
		perform public.reserve_seller_offer_coupon(approved_offer_id, target_location_id, target_offer_date, target_start_time, gen_random_uuid());
		raise exception 'A full daily quota must reject another visitor.';
	exception when sqlstate '55000' then
		null;
	end;

	perform set_config('request.jwt.claim.sub', visitor_one_id::text, true);
	perform set_config('request.jwt.claims', jsonb_build_object('sub', visitor_one_id::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
	result := public.cancel_seller_offer_coupon(reservation_id);
	if result ->> 'status' <> 'cancelled' or not (result ->> 'refunded')::boolean
		or (select account.points_balance from public.loyalty_accounts account where account.visitor_id = visitor_one_id) <> 50
		or (select quota.reserved_count from public.seller_offer_daily_quotas quota where quota.location_id = target_location_id and quota.offer_date = target_offer_date and quota.starts_at = target_start_time) <> 0
		or (select count(*) from public.seller_offer_point_transactions transaction where transaction.coupon_id = reservation_id) <> 2 then
		raise exception 'An early cancellation must atomically refund points and release the seat exactly once.';
	end if;
	result := public.reserve_seller_offer_coupon(approved_offer_id, target_location_id, target_offer_date, target_start_time, first_idempotency_key);
	if result ->> 'status' <> 'cancelled' or (result ->> 'id')::uuid <> reservation_id
		or (select account.points_balance from public.loyalty_accounts account where account.visitor_id = visitor_one_id) <> 50 then
		raise exception 'Retrying a cancelled reservation key must not issue a new voucher or charge points.';
	end if;

	perform set_config('request.jwt.claim.sub', visitor_two_id::text, true);
	perform set_config('request.jwt.claims', jsonb_build_object('sub', visitor_two_id::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
	result := public.reserve_seller_offer_coupon(approved_offer_id, target_location_id, target_offer_date, target_start_time, gen_random_uuid());
	if result ->> 'status' <> 'reserved'
		or (select account.points_balance from public.loyalty_accounts account where account.visitor_id = visitor_two_id) <> 0
		or (select quota.reserved_count from public.seller_offer_daily_quotas quota where quota.location_id = target_location_id and quota.offer_date = target_offer_date and quota.starts_at = target_start_time) <> 1 then
		raise exception 'Early cancellation should release the quota for another visitor.';
	end if;
	perform set_config('request.jwt.claim.sub', admin_user::text, true);
	perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_user::text, 'role', 'authenticated', 'app_metadata', '{"role":"admin"}'::jsonb)::text, true);
	select metrics.vouchers_issued_last_30_days, metrics.vouchers_redeemed_last_30_days
	into voucher_metric_issued, voucher_metric_redeemed
	from public.admin_get_seller_voucher_location_metrics() metrics
	where metrics.country_code = 'GB' and metrics.city_id = test_city_id;
	if voucher_metric_issued is null or voucher_metric_redeemed is null
		or voucher_metric_issued is distinct from (
			select count(*) from public.seller_offer_coupons coupon
			join public.seller_offer_locations location on location.id = coupon.location_id
			where location.city_id = test_city_id and coupon.created_at >= now() - interval '30 days'
		)
		or voucher_metric_redeemed is distinct from (
			select count(*) from public.seller_offer_coupons coupon
			join public.seller_offer_locations location on location.id = coupon.location_id
			where location.city_id = test_city_id and coupon.status = 'redeemed' and coupon.redeemed_at >= now() - interval '30 days'
		) then
		raise exception 'Seller voucher location metrics should match issued and redeemed city vouchers.';
	end if;
	if not exists (
		select 1 from public.admin_get_seller_offer_voucher_status_metrics() metrics
		where metrics.offer_id = approved_offer_id and metrics.location_id = target_location_id
			and metrics.reserved_count = 1 and metrics.redeemed_count = 0
			and metrics.cancelled_count = 1 and metrics.expired_count = 0
	) then
		raise exception 'Admin branch metrics should distinguish reserved and cancelled seller vouchers.';
	end if;
	perform set_config('request.jwt.claim.sub', visitor_one_id::text, true);
	perform set_config('request.jwt.claims', jsonb_build_object('sub', visitor_one_id::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
	begin
		perform count(*) from public.admin_get_seller_voucher_location_metrics();
		raise exception using errcode = 'P0001', message = 'A visitor must not read seller voucher metrics.';
	exception when sqlstate '42501' then
		null;
	end;

	perform set_config('request.jwt.claim.sub', visitor_two_id::text, true);
	perform set_config('request.jwt.claims', jsonb_build_object('sub', visitor_two_id::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
	if not exists (
		select 1 from public.get_visitor_seller_offer_coupons() coupon
		where coupon.offer_id = approved_offer_id and coupon.coupon_code = result ->> 'code' and coupon.status = 'reserved' and coupon.can_cancel
	) then
		raise exception 'Visitors should see their own voucher and its cancellation deadline.';
	end if;
	if (select summary.points_spent from public.get_visitor_loyalty_summary() summary) <> 50
		or not exists (
			select 1 from public.get_visitor_loyalty_activity(10, 0) activity
			where activity.transaction_type = 'seller_offer_spent' and activity.points_delta = -50
		) then
		raise exception 'Seller voucher spending should appear in the shared points summary and activity.';
	end if;

	perform set_config('request.jwt.claim.sub', admin_user::text, true);
	perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_user::text, 'role', 'authenticated', 'app_metadata', '{"role":"admin"}'::jsonb)::text, true);
	begin
		perform public.admin_set_seller_offer_status(approved_offer_id, 'ended');
		if (select account.points_balance from public.loyalty_accounts account where account.visitor_id = visitor_two_id) <> 50
			or not exists(select 1 from public.seller_offer_coupons coupon where coupon.coupon_code = result ->> 'code' and coupon.status = 'cancelled') then
			raise exception 'Ending an offer must cancel and refund its unused active vouchers.';
		end if;
		raise exception using errcode = 'ZX002', message = 'Rollback cancellation probe before testing redemption and support.';
	exception when sqlstate 'ZX002' then
		null;
	end;
	perform set_config('request.jwt.claim.sub', seller_user::text, true);
	perform set_config('request.jwt.claims', jsonb_build_object('sub', seller_user::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
	begin
		perform public.seller_redeem_offer_coupon(result ->> 'code');
		raise exception 'A voucher must not be redeemed before its scheduled window.';
	exception when sqlstate '55000' then
		null;
	end;
	update public.seller_offer_coupons
	set status = 'redeemed', redeemed_at = now()
	where coupon_code = result ->> 'code';
	perform set_config('request.jwt.claim.sub', visitor_two_id::text, true);
	perform set_config('request.jwt.claims', jsonb_build_object('sub', visitor_two_id::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
	voucher_support_case_id := public.visitor_report_seller_voucher_issue(
		(select coupon.id from public.seller_offer_coupons coupon where coupon.coupon_code = result ->> 'code'),
		'not_honored', 'The shop could not honor the confirmed voucher.'
	);
	duplicate_voucher_support_case_id := public.visitor_report_seller_voucher_issue(
		(select coupon.id from public.seller_offer_coupons coupon where coupon.coupon_code = result ->> 'code'),
		'not_honored', 'The shop could not honor the confirmed voucher.'
	);
	if voucher_support_case_id is null or duplicate_voucher_support_case_id is distinct from voucher_support_case_id
		or (select account.points_balance from public.loyalty_accounts account where account.visitor_id = visitor_two_id) <> 0 then
		raise exception 'A voucher report should be idempotent and must not change the visitor points balance.';
	end if;
	perform set_config('request.jwt.claim.sub', admin_user::text, true);
	perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_user::text, 'role', 'authenticated', 'app_metadata', '{"role":"admin"}'::jsonb)::text, true);
	if not exists (
		select 1 from public.admin_get_seller_voucher_support_cases(50, 0) support_case
		where support_case.case_id = voucher_support_case_id and support_case.status = 'open'
	) then
		raise exception 'An open seller voucher report should appear in the admin queue.';
	end if;
	perform public.admin_update_seller_voucher_support_case(voucher_support_case_id, 'in_review', null);
	perform public.admin_update_seller_voucher_support_case(voucher_support_case_id, 'resolved', 'Confirmed the branch could not honor the voucher and replied to the visitor.');
	if not exists (
		select 1 from public.seller_voucher_support_cases support_case
		where support_case.id = voucher_support_case_id and support_case.status = 'resolved'
			and support_case.resolution_note = 'Confirmed the branch could not honor the voucher and replied to the visitor.'
			and support_case.resolved_by = admin_user
	) or not exists (
		select 1 from public.admin_audit_logs audit
		where audit.entity_type = 'seller_voucher_support_case' and audit.entity_id = voucher_support_case_id
			and audit.action = 'seller_voucher_support_case_updated'
	) then
		raise exception 'Seller voucher support resolution should be noted and audited.';
	end if;
	select metrics.vouchers_redeemed_last_30_days into voucher_metric_redeemed
	from public.admin_get_seller_voucher_location_metrics() metrics
	where metrics.country_code = 'GB' and metrics.city_id = test_city_id;
	if voucher_metric_redeemed is distinct from (
		select count(*) from public.seller_offer_coupons coupon
		join public.seller_offer_locations location on location.id = coupon.location_id
		where location.city_id = test_city_id and coupon.status = 'redeemed' and coupon.redeemed_at >= now() - interval '30 days'
	) then
		raise exception 'Redeemed seller vouchers should be included in the city redemption metric.';
	end if;
	perform public.admin_set_seller_status(seller_id, 'suspended', false);
	if (select offer.status from public.seller_offers offer where offer.id = approved_offer_id) <> 'paused'
		or not exists (
			select 1 from public.admin_audit_logs audit
			where audit.entity_type = 'seller_offer' and audit.entity_id = approved_offer_id
				and audit.action = 'seller_offer_paused_seller_inactive'
		) then
		raise exception 'Suspending a seller should pause their published offer and audit the change.';
	end if;
	begin
		perform public.admin_set_seller_offer_status(approved_offer_id, 'published');
		raise exception 'An inactive seller must not publish an offer.';
	exception when sqlstate '55000' then
		null;
	end;
	perform set_config('request.jwt.claim.sub', visitor_one_id::text, true);
	perform set_config('request.jwt.claims', jsonb_build_object('sub', visitor_one_id::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
	begin
		perform public.reserve_seller_offer_coupon(approved_offer_id, target_location_id, target_offer_date, target_start_time, gen_random_uuid());
		raise exception 'A paused offer from a suspended seller must reject new bookings.';
	exception when sqlstate '55000' then
		null;
	end;
	if not exists (
		select 1 from public.seller_offer_coupons coupon
		where coupon.offer_id = approved_offer_id and coupon.visitor_id = visitor_two_id and coupon.status = 'redeemed'
	) then
		raise exception 'Suspending a seller must preserve previously redeemed voucher history.';
	end if;

		raise exception using errcode = 'P0001', message = '__ROLLBACK_SELLER_OFFER_REQUEST_SMOKE__';
	exception when sqlstate 'P0001' then
		if sqlerrm <> '__ROLLBACK_SELLER_OFFER_REQUEST_SMOKE__' then
			raise;
		end if;
	end;
end;
$$;