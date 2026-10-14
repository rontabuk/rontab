begin;
select plan(1);

do $$
declare
	visitor_id uuid := gen_random_uuid();
	unverified_visitor_id uuid := gen_random_uuid();
	seller_user_id uuid := gen_random_uuid();
	admin_user_id uuid := gen_random_uuid();
	seller_profile_id uuid;
	category_id uuid := gen_random_uuid();
	product_id uuid := gen_random_uuid();
	product_case_id uuid;
	duplicate_product_case_id uuid;
	seller_case_id uuid;
	resolved_case_id uuid;
	first_notification_id text;
	latest_notification_id text;
	case_updated_at timestamptz;
	case_count bigint;
begin
	begin
		insert into auth.users (
			id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		)
	values
			(visitor_id, 'authenticated', 'authenticated', visitor_id::text || '@market-report.invalid', '', now(), '{}', '{"account_type":"visitor"}', now(), now()),
			(unverified_visitor_id, 'authenticated', 'authenticated', unverified_visitor_id::text || '@market-report.invalid', '', now(), '{}', '{"account_type":"visitor"}', now(), now()),
			(seller_user_id, 'authenticated', 'authenticated', seller_user_id::text || '@market-report.invalid', '', now(), '{}', jsonb_build_object('account_type', 'seller', 'shop_name', 'Report smoke seller', 'shop_slug', 'report-smoke-' || replace(seller_user_id::text, '-', '')), now(), now()),
			(admin_user_id, 'authenticated', 'authenticated', admin_user_id::text || '@market-report.invalid', '', now(), '{"role":"admin"}', '{}', now(), now());

		update public.profiles set email_verified_at = now() where id = visitor_id;
		select id into seller_profile_id from public.seller_profiles where user_id = seller_user_id;
		perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_user_id::text, 'role', 'authenticated', 'app_metadata', '{"role":"admin"}'::jsonb)::text, true);
		perform public.admin_set_seller_status(seller_profile_id, 'active', true);

		insert into public.categories (id, slug, name, is_active)
		values (category_id, 'report-smoke-' || replace(category_id::text, '-', ''), 'Report smoke test', true);
		insert into public.products (id, seller_profile_id, category_id, slug, name, description, external_url, status)
		values (product_id, seller_profile_id, category_id, 'report-smoke-' || replace(product_id::text, '-', ''), 'Report smoke product', 'A rollback-only product for marketplace report testing.', 'https://example.invalid/report-smoke', 'approved');

		perform set_config('request.jwt.claim.sub', unverified_visitor_id::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', unverified_visitor_id::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
		begin
			perform public.visitor_report_marketplace_item('product', product_id, 'misleading', 'The product material differs from its listing.');
			raise exception using errcode = 'P0001', message = 'An unverified visitor must not submit a marketplace report.';
		exception when sqlstate '42501' then
			null;
		end;

		perform set_config('request.jwt.claim.sub', visitor_id::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', visitor_id::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
		product_case_id := public.visitor_report_marketplace_item('product', product_id, 'misleading', 'The product material differs from its listing.');
		duplicate_product_case_id := public.visitor_report_marketplace_item('product', product_id, 'misleading', 'The product material differs from its listing.');
		seller_case_id := public.visitor_report_marketplace_item('seller_account', seller_profile_id, 'seller_conduct', 'The seller repeatedly sends unrelated payment requests.');
		if product_case_id is null or duplicate_product_case_id is distinct from product_case_id or seller_case_id is null then
			raise exception 'Marketplace report submission should be idempotent per target and allow both target types.';
		end if;
		select total_case_count into case_count from public.get_visitor_marketplace_support_cases(25, 0) limit 1;
		if case_count <> 2 then
			raise exception 'Visitors should be able to track both of their submitted reports.';
		end if;

		perform set_config('request.jwt.claim.sub', unverified_visitor_id::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', unverified_visitor_id::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
		begin
			perform public.admin_get_marketplace_support_cases(25, 0);
			raise exception using errcode = 'P0001', message = 'A visitor must not read the admin report queue.';
		exception when sqlstate '42501' then
			null;
		end;

		perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_user_id::text, 'role', 'authenticated', 'app_metadata', '{"role":"admin"}'::jsonb)::text, true);
		select total_case_count into case_count from public.admin_get_marketplace_support_cases(1, 0) limit 1;
		if case_count <> 2 then
			raise exception 'The admin report queue should count two distinct open targets; got %.', case_count;
		end if;
		perform public.admin_update_marketplace_support_case(product_case_id, 'in_review', null);
		select updated_at into case_updated_at from public.marketplace_support_cases where id = product_case_id;
		perform public.admin_update_marketplace_support_case(product_case_id, 'in_review', null);
		if (select updated_at from public.marketplace_support_cases where id = product_case_id) is distinct from case_updated_at then
			raise exception 'Saving an unchanged report status must not create another update.';
		end if;
		perform set_config('request.jwt.claim.sub', visitor_id::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', visitor_id::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
		select notification_id into first_notification_id
		from public.get_visitor_marketplace_support_notifications()
		where notification_id like 'support-marketplace-' || product_case_id::text || '-%';
		if first_notification_id is null then
			raise exception 'A visitor should receive a notification when a report enters review.';
		end if;
		if public.mark_notification_items_read(array[first_notification_id]) <> array[first_notification_id] then
			raise exception 'The current support update notification should be marked as read.';
		end if;
		perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_user_id::text, 'role', 'authenticated', 'app_metadata', '{"role":"admin"}'::jsonb)::text, true);
		perform public.admin_update_marketplace_support_case(product_case_id, 'resolved', 'Confirmed the product details were inaccurate and recorded the correction.');
		perform set_config('request.jwt.claim.sub', visitor_id::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', visitor_id::text, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text, true);
		select notification_id into latest_notification_id
		from public.get_visitor_marketplace_support_notifications()
		where notification_id like 'support-marketplace-' || product_case_id::text || '-%';
		if latest_notification_id is null or latest_notification_id = first_notification_id then
			raise exception 'Resolving a report should produce a distinct follow-up notification.';
		end if;
		resolved_case_id := public.visitor_report_marketplace_item('product', product_id, 'misleading', 'The product material differs from its listing after resolution.');
		if resolved_case_id is null or resolved_case_id = product_case_id then
			raise exception 'A visitor should be able to submit a new report after the previous report is resolved.';
		end if;
		if not exists (
			select 1 from public.admin_audit_logs audit
			where audit.entity_type = 'marketplace_support_case'
				and audit.entity_id = product_case_id
				and audit.action = 'marketplace_support_case_updated'
		) then
			raise exception 'Resolving a marketplace report must write an audit event.';
		end if;

		raise exception using errcode = 'P0001', message = '__ROLLBACK_MARKETPLACE_SUPPORT_REPORTS_SMOKE__';
	exception when sqlstate 'P0001' then
		if sqlerrm <> '__ROLLBACK_MARKETPLACE_SUPPORT_REPORTS_SMOKE__' then
			raise;
		end if;
	end;
end;
$$;

select pass('marketplace support reports enforce access, deduplicate open cases, paginate, and audit resolutions');
select * from finish();
rollback;