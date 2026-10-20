-- Welcome points for newly confirmed visitors, and admin point adjustments with a
-- recorded reason. Both are written to the points ledger so balances stay auditable.

alter table public.marketplace_settings
	add column if not exists visitor_welcome_bonus_points integer not null default 50
		check (visitor_welcome_bonus_points between 0 and 1000);

alter table public.loyalty_point_transactions
	add column if not exists created_by uuid references auth.users(id) on delete set null;

alter table public.loyalty_point_transactions drop constraint if exists loyalty_point_transactions_transaction_type_check;
alter table public.loyalty_point_transactions add constraint loyalty_point_transactions_transaction_type_check
	check (transaction_type = any (array['visit_earned', 'participation_spent', 'redemption_spent', 'welcome_bonus', 'admin_adjustment']));

-- source_product_name carries the visible description (the reason) for welcome and admin rows.
alter table public.loyalty_point_transactions drop constraint if exists loyalty_point_transactions_check;
alter table public.loyalty_point_transactions add constraint loyalty_point_transactions_check check (
	(transaction_type = 'visit_earned' and points_delta > 0 and source_product_id is not null
		and length(btrim(source_product_name)) > 0 and offer_claim_id is null)
	or (transaction_type in ('participation_spent', 'redemption_spent') and points_delta < 0
		and source_product_id is null and offer_claim_id is not null)
	or (transaction_type = 'welcome_bonus' and points_delta > 0
		and source_product_id is null and offer_claim_id is null)
	or (transaction_type = 'admin_adjustment' and source_product_id is null and offer_claim_id is null
		and length(btrim(source_product_name)) between 3 and 200)
);

create or replace function public.grant_visitor_welcome_bonus()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	bonus integer;
	new_transaction_id bigint;
begin
	if new.email_verified_at is null or (tg_op = 'UPDATE' and old.email_verified_at is not null) then
		return new;
	end if;
	if not public.is_point_earning_visitor(new.id) then
		return new;
	end if;

	select visitor_welcome_bonus_points into bonus from public.marketplace_settings where singleton = true;
	if coalesce(bonus, 0) <= 0 then
		return new;
	end if;

	perform pg_advisory_xact_lock(hashtextextended(new.id::text, 0));
	insert into public.loyalty_point_transactions (visitor_id, points_delta, transaction_type, source_product_name, idempotency_key)
	values (new.id, bonus, 'welcome_bonus', 'Welcome to RonTab', 'welcome-bonus')
	on conflict (visitor_id, idempotency_key) do nothing
	returning id into new_transaction_id;

	if new_transaction_id is not null then
		insert into public.loyalty_accounts (visitor_id, points_balance)
		values (new.id, bonus)
		on conflict (visitor_id) do update
		set points_balance = public.loyalty_accounts.points_balance + bonus, updated_at = now();

		insert into public.notification_events (notification_id, recipient_id, audience, kind, title, body, href, created_at)
		values (
			'welcome-bonus-' || new.id::text, new.id, 'personal', 'reward-result',
			'Welcome gift: ' || bonus || ' points',
			'Thanks for confirming your email. ' || bonus || ' points have been added to your balance to use on local offers.',
			'/visitor/rewards', now()
		)
		on conflict do nothing;
	end if;
	return new;
end;
$$;

drop trigger if exists grant_visitor_welcome_bonus on public.profiles;
create trigger grant_visitor_welcome_bonus
	after insert or update of email_verified_at on public.profiles
	for each row execute function public.grant_visitor_welcome_bonus();

create or replace function public.admin_adjust_visitor_points(p_visitor_id uuid, p_points_delta integer, p_reason text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
	reason text := btrim(coalesce(p_reason, ''));
	current_balance bigint;
	new_balance bigint;
	adjustment_id bigint;
begin
	if not public.is_admin() then
		raise exception 'Administrator access required.' using errcode = '42501';
	end if;
	if p_visitor_id is null or p_points_delta is null or p_points_delta = 0 or abs(p_points_delta) > 100000 then
		raise exception 'Enter a points change between -100,000 and 100,000, other than zero.' using errcode = '22023';
	end if;
	if length(reason) not between 3 and 200 then
		raise exception 'Enter a reason between 3 and 200 characters.' using errcode = '22023';
	end if;
	if not public.is_point_earning_visitor(p_visitor_id) then
		raise exception 'Points can only be adjusted for confirmed visitor accounts in a supported country.' using errcode = 'RT020';
	end if;

	perform pg_advisory_xact_lock(hashtextextended(p_visitor_id::text, 0));
	insert into public.loyalty_accounts (visitor_id) values (p_visitor_id) on conflict (visitor_id) do nothing;
	select points_balance into current_balance from public.loyalty_accounts where visitor_id = p_visitor_id for update;
	new_balance := current_balance + p_points_delta;
	if new_balance < 0 then
		raise exception 'This visitor has only % points, so the deduction would make the balance negative.', current_balance using errcode = 'RT021';
	end if;

	insert into public.loyalty_point_transactions (visitor_id, points_delta, transaction_type, source_product_name, idempotency_key, created_by)
	values (p_visitor_id, p_points_delta, 'admin_adjustment', reason, 'admin-adjustment:' || gen_random_uuid()::text, (select auth.uid()))
	returning id into adjustment_id;

	update public.loyalty_accounts set points_balance = new_balance, updated_at = now() where visitor_id = p_visitor_id;

	insert into public.notification_events (notification_id, recipient_id, audience, kind, title, body, href, created_at)
	values (
		'points-adjustment-' || adjustment_id::text, p_visitor_id, 'personal', 'reward-result',
		case when p_points_delta > 0 then abs(p_points_delta) || ' points added' else abs(p_points_delta) || ' points deducted' end,
		'RonTab ' || case when p_points_delta > 0 then 'added ' else 'deducted ' end || abs(p_points_delta)
			|| ' points. Reason: ' || reason || '. Your balance is now ' || new_balance || ' points.',
		'/visitor/rewards', now()
	);

	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values ((select auth.uid()), 'visitor_points_adjusted', 'visitor', p_visitor_id,
		jsonb_build_object('points_delta', p_points_delta, 'reason', reason, 'previous_balance', current_balance, 'new_balance', new_balance));

	return new_balance;
end;
$$;

revoke all on function public.admin_adjust_visitor_points(uuid, integer, text) from public, anon;
grant execute on function public.admin_adjust_visitor_points(uuid, integer, text) to authenticated;
revoke all on function public.grant_visitor_welcome_bonus() from public, anon, authenticated;

create or replace function public.admin_set_visitor_welcome_bonus_points(p_points integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	previous_points integer;
begin
	if not public.is_admin() then
		raise exception 'Administrator access required.' using errcode = '42501';
	end if;
	if p_points is null or p_points not between 0 and 1000 then
		raise exception 'Enter welcome points between 0 and 1,000.' using errcode = '22023';
	end if;
	select visitor_welcome_bonus_points into previous_points from public.marketplace_settings where singleton for update;
	update public.marketplace_settings set visitor_welcome_bonus_points = p_points where singleton = true;
	insert into public.admin_audit_logs (actor_id, action, entity_type, details)
	values ((select auth.uid()), 'visitor_welcome_bonus_updated', 'marketplace_settings',
		jsonb_build_object('previous_points', previous_points, 'points', p_points));
end;
$$;

revoke all on function public.admin_set_visitor_welcome_bonus_points(integer) from public, anon;
grant execute on function public.admin_set_visitor_welcome_bonus_points(integer) to authenticated;
