alter table public.marketplace_settings
	add column visitor_daily_visit_points_cap integer not null default 20
		check (visitor_daily_visit_points_cap between 1 and 100);

create function public.admin_update_marketplace_settings(
	p_product_approval_mode text,
	p_seller_approval_mode text,
	p_featured_duration_minutes integer,
	p_new_products_duration_minutes integer,
	p_click_price_pence_per_1000 integer,
	p_visitor_daily_visit_points_cap integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not public.is_admin() then
		raise exception 'Administrator access required.' using errcode = '42501';
	end if;

	if p_product_approval_mode not in ('manual', 'automatic')
		or p_seller_approval_mode not in ('manual', 'automatic')
		or p_featured_duration_minutes not between 1 and 10080
		or p_new_products_duration_minutes not between 1 and 10080
		or p_click_price_pence_per_1000 not between 1 and 100000
		or p_visitor_daily_visit_points_cap not between 1 and 100
	then
		raise exception 'Invalid marketplace setting.' using errcode = '22023';
	end if;

	update public.marketplace_settings
	set product_approval_mode = p_product_approval_mode,
		seller_approval_mode = p_seller_approval_mode,
		featured_duration_minutes = p_featured_duration_minutes,
		new_products_duration_minutes = p_new_products_duration_minutes,
		click_price_pence_per_1000 = p_click_price_pence_per_1000,
		visitor_daily_visit_points_cap = p_visitor_daily_visit_points_cap
	where singleton = true;

	insert into public.admin_audit_logs (actor_id, action, entity_type, details)
	values (
		(select auth.uid()),
		'marketplace_settings_updated',
		'marketplace_settings',
		jsonb_build_object(
			'product_approval_mode', p_product_approval_mode,
			'seller_approval_mode', p_seller_approval_mode,
			'featured_duration_minutes', p_featured_duration_minutes,
			'new_products_duration_minutes', p_new_products_duration_minutes,
			'click_price_pence_per_1000', p_click_price_pence_per_1000,
			'visitor_daily_visit_points_cap', p_visitor_daily_visit_points_cap
		)
	);
end;
$$;

revoke all on function public.admin_update_marketplace_settings(text, text, integer, integer, integer, integer) from public, anon;
grant execute on function public.admin_update_marketplace_settings(text, text, integer, integer, integer, integer) to authenticated;

create function public.get_visitor_daily_visit_points_status()
returns table (daily_cap integer, points_earned bigint)
language sql
stable
security definer
set search_path = ''
as $$
	select settings.visitor_daily_visit_points_cap, count(transaction.id)::bigint
	from public.marketplace_settings settings
	left join public.loyalty_point_transactions transaction
		on transaction.visitor_id = (select auth.uid())
		and transaction.transaction_type = 'visit_earned'
		and transaction.created_at >= now() - interval '24 hours'
	where settings.singleton = true
		and (select public.is_eligible_visitor())
	group by settings.visitor_daily_visit_points_cap;
$$;

revoke all on function public.get_visitor_daily_visit_points_status() from public, anon;
grant execute on function public.get_visitor_daily_visit_points_status() to authenticated;

create or replace function public.get_visitor_loyalty_points()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(account.points_balance, 0)
	from (select (select auth.uid()) as visitor_id) current_visitor
	left join public.loyalty_accounts account on account.visitor_id = current_visitor.visitor_id
	where (select public.is_eligible_visitor());
$$;

revoke all on function public.get_visitor_loyalty_points() from public, anon;
grant execute on function public.get_visitor_loyalty_points() to authenticated;

create or replace function public.record_visitor_loyalty_point()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	new_transaction_id bigint;
	product_name text;
	daily_cap integer;
	points_earned_recently integer;
begin
	if not public.is_supported_loyalty_visitor(new.visitor_id) then
		return new;
	end if;

	perform pg_advisory_xact_lock(hashtextextended(new.visitor_id::text, 0));
	select visitor_daily_visit_points_cap into daily_cap
	from public.marketplace_settings where singleton = true;
	select count(*)::integer into points_earned_recently
	from public.loyalty_point_transactions transaction
	where transaction.visitor_id = new.visitor_id
		and transaction.transaction_type = 'visit_earned'
		and transaction.created_at >= now() - interval '24 hours';
	if points_earned_recently >= daily_cap then
		return new;
	end if;

	select product.name into product_name
	from public.products product
	where product.id = new.product_id;

	insert into public.loyalty_point_transactions (
		visitor_id, points_delta, transaction_type, source_product_id, source_product_name, idempotency_key
	)
	values (new.visitor_id, 1, 'visit_earned', new.product_id, coalesce(product_name, 'Product visit'), 'visit:' || new.product_id::text)
	on conflict (visitor_id, idempotency_key) do nothing
	returning id into new_transaction_id;

	if new_transaction_id is not null then
		insert into public.loyalty_accounts (visitor_id, points_balance)
		values (new.visitor_id, 1)
		on conflict (visitor_id) do update
		set points_balance = public.loyalty_accounts.points_balance + 1, updated_at = now();
	end if;
	return new;
end;
$$;

create function public.get_visitor_loyalty_activity(p_limit integer, p_offset integer)
returns table (
	id bigint,
	created_at timestamptz,
	points_delta integer,
	transaction_type text,
	product_name text,
	offer_title text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if p_limit is null or p_offset is null or p_limit not between 1 and 51 or p_offset not between 0 and 10000 then
		raise exception 'Invalid history page.' using errcode = '22023';
	end if;
	return query
	select
		transaction.id,
		transaction.created_at,
		transaction.points_delta,
		transaction.transaction_type,
		transaction.source_product_name,
		offer.title
	from public.loyalty_point_transactions transaction
	left join public.loyalty_offer_claims claim on claim.id = transaction.offer_claim_id
	left join public.loyalty_offers offer on offer.id = claim.offer_id
	where transaction.visitor_id = (select auth.uid())
		and (select public.is_eligible_visitor())
	order by transaction.created_at desc, transaction.id desc
	limit p_limit offset p_offset;
end;
$$;

revoke all on function public.get_visitor_loyalty_activity(integer, integer) from public, anon;
grant execute on function public.get_visitor_loyalty_activity(integer, integer) to authenticated;

create function public.get_visitor_offer_history(p_limit integer, p_offset integer)
returns table (
	id uuid,
	offer_id uuid,
	title text,
	claim_type text,
	status text,
	points_spent integer,
	created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if p_limit is null or p_offset is null or p_limit not between 1 and 51 or p_offset not between 0 and 10000 then
		raise exception 'Invalid history page.' using errcode = '22023';
	end if;
	return query
	select claim.id, claim.offer_id, offer.title, claim.claim_type, claim.status, claim.points_spent, claim.created_at
	from public.loyalty_offer_claims claim
	join public.loyalty_offers offer on offer.id = claim.offer_id
	where claim.visitor_id = (select auth.uid())
		and (select public.is_eligible_visitor())
	order by claim.created_at desc, claim.id desc
	limit p_limit offset p_offset;
end;
$$;

revoke all on function public.get_visitor_offer_history(integer, integer) from public, anon;
grant execute on function public.get_visitor_offer_history(integer, integer) to authenticated;