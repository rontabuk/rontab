do $$
declare
	first_user uuid := gen_random_uuid();
	second_user uuid := gen_random_uuid();
	first_request record;
	repeated_request record;
	cancelled_request record;
	repeated_cancel record;
	new_request record;
begin
	begin
		insert into auth.users (
			id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		)
		values
			(first_user, 'authenticated', 'authenticated', first_user::text || '@closure-smoke.invalid', '', now(), '{}', '{}', now(), now()),
			(second_user, 'authenticated', 'authenticated', second_user::text || '@closure-smoke.invalid', '', now(), '{}', '{}', now(), now());

		if not (
			select relrowsecurity
			from pg_class
			where oid = 'public.account_closure_requests'::regclass
		) then
			raise exception 'Account closure requests must have row-level security enabled.';
		end if;
		if has_table_privilege('authenticated', 'public.account_closure_requests', 'select')
			or has_table_privilege('authenticated', 'public.account_closure_requests', 'insert')
			or has_table_privilege('authenticated', 'public.account_closure_requests', 'update')
			or has_table_privilege('authenticated', 'public.account_closure_requests', 'delete') then
			raise exception 'Authenticated users must not access closure request rows directly.';
		end if;
		if not has_function_privilege('authenticated', 'public.request_account_closure()', 'execute')
			or not has_function_privilege('authenticated', 'public.cancel_account_closure()', 'execute')
			or has_function_privilege('anon', 'public.request_account_closure()', 'execute')
			or has_function_privilege('anon', 'public.cancel_account_closure()', 'execute') then
			raise exception 'Closure RPC grants must be limited to authenticated users.';
		end if;

		perform set_config('request.jwt.claim.sub', '', true);
		perform set_config('request.jwt.claims', '{"role":"anon"}', true);
		begin
			perform * from public.request_account_closure();
			raise exception 'Unauthenticated closure request unexpectedly succeeded.';
		exception when sqlstate '42501' then
			null;
		end;

		perform set_config('request.jwt.claim.sub', first_user::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', first_user, 'role', 'authenticated')::text, true);
		select * into first_request from public.request_account_closure();
		select * into repeated_request from public.request_account_closure();
		if first_request.request_id is null
			or first_request.request_id <> repeated_request.request_id
			or first_request.status <> 'requested'
			or first_request.scheduled_for <> first_request.requested_at + interval '720 hours' then
			raise exception 'A repeated closure request must return the same pending request with a 30-day period.';
		end if;

		perform set_config('request.jwt.claim.sub', second_user::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', second_user, 'role', 'authenticated')::text, true);
		begin
			perform * from public.cancel_account_closure();
			raise exception 'A user without a closure request unexpectedly cancelled one.';
		exception when sqlstate '55000' then
			null;
		end;
		insert into public.account_closure_requests (user_id, requested_at, scheduled_for)
		values (second_user, statement_timestamp() - interval '750 hours', statement_timestamp() - interval '30 hours');
		begin
			perform * from public.cancel_account_closure();
			raise exception 'An expired closure request unexpectedly remained cancellable.';
		exception when sqlstate '55000' then
			null;
		end;

		perform set_config('request.jwt.claim.sub', first_user::text, true);
		perform set_config('request.jwt.claims', jsonb_build_object('sub', first_user, 'role', 'authenticated')::text, true);
		select * into cancelled_request from public.cancel_account_closure();
		select * into repeated_cancel from public.cancel_account_closure();
		if cancelled_request.request_id <> first_request.request_id
			or cancelled_request.status <> 'cancelled'
			or cancelled_request.requested_at <> first_request.requested_at
			or repeated_cancel.request_id <> first_request.request_id
			or repeated_cancel.status <> 'cancelled' then
			raise exception 'Cancellation must be owner-scoped and safe to retry.';
		end if;
		select * into new_request from public.request_account_closure();
		if new_request.request_id = first_request.request_id
			or new_request.status <> 'requested' then
			raise exception 'A new closure request after cancellation must create a fresh grace period.';
		end if;

		raise exception using errcode = 'P0001', message = '__ROLLBACK_ACCOUNT_CLOSURE_SMOKE__';
	exception when sqlstate 'P0001' then
		if sqlerrm <> '__ROLLBACK_ACCOUNT_CLOSURE_SMOKE__' then
			raise;
		end if;
	end;
end;
$$;
