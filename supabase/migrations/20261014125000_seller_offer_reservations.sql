create or replace function public.get_visitor_loyalty_summary()
returns table (points_balance bigint, points_earned bigint, points_spent bigint)
language sql
stable
security definer
set search_path = ''
as $$
	select
		account.points_balance,
		coalesce((
			select sum(transaction.points_delta)
			from public.loyalty_point_transactions transaction
			where transaction.visitor_id = account.visitor_id and transaction.points_delta > 0
		), 0)::bigint,
		(
			coalesce((
				select -sum(transaction.points_delta)
				from public.loyalty_point_transactions transaction
				where transaction.visitor_id = account.visitor_id and transaction.points_delta < 0
			), 0)
			+ coalesce((
				select -sum(transaction.points_delta)
				from public.seller_offer_point_transactions transaction
				where transaction.visitor_id = account.visitor_id
			), 0)
		)::bigint
	from public.loyalty_accounts account
	where account.visitor_id = (select auth.uid())
		and (select public.is_eligible_visitor());
$$;

create or replace function public.get_visitor_loyalty_activity(p_limit integer, p_offset integer)
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
	with activity as (
		select transaction.id, transaction.created_at, transaction.points_delta,
			transaction.transaction_type, transaction.source_product_name as product_name,
			offer.title as offer_title, transaction.visitor_id
		from public.loyalty_point_transactions transaction
		left join public.loyalty_offer_claims claim on claim.id = transaction.offer_claim_id
		left join public.loyalty_offers offer on offer.id = claim.offer_id
		union all
		select -transaction.id, transaction.created_at, transaction.points_delta,
			case transaction.transaction_type when 'spent' then 'seller_offer_spent' else 'seller_offer_refund' end,
		null::text, offer.title, transaction.visitor_id
		from public.seller_offer_point_transactions transaction
		join public.seller_offer_coupons coupon on coupon.id = transaction.coupon_id
		join public.seller_offers offer on offer.id = coupon.offer_id
	)
	select activity.id, activity.created_at, activity.points_delta, activity.transaction_type,
		activity.product_name, activity.offer_title
	from activity
	where activity.visitor_id = (select auth.uid())
		and (select public.is_eligible_visitor())
	order by activity.created_at desc, activity.id desc
	limit p_limit offset p_offset;
end;
$$;

create function public.reserve_seller_offer_coupon(
	p_offer_id uuid,
	p_location_id uuid,
	p_offer_date date,
	p_starts_at time,
	p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_visitor_id uuid := (select auth.uid());
	offer public.seller_offers%rowtype;
	quota public.seller_offer_daily_quotas%rowtype;
	prior_coupon public.seller_offer_coupons%rowtype;
	coupon public.seller_offer_coupons%rowtype;
	visitor_city_id text;
	v_points_balance bigint;
	window_start timestamptz;
	window_end timestamptz;
	coupon_code text;
begin
	if v_visitor_id is null or not public.is_supported_loyalty_visitor(v_visitor_id) then
		raise exception 'An eligible, verified visitor account is required.' using errcode = '42501';
	end if;
	if p_offer_id is null or p_location_id is null or p_offer_date is null or p_starts_at is null or p_idempotency_key is null then
		raise exception 'Choose an available offer time.' using errcode = '22023';
	end if;

	select * into prior_coupon
	from public.seller_offer_coupons
	where seller_offer_coupons.visitor_id = v_visitor_id
		and seller_offer_coupons.idempotency_key = p_idempotency_key;
	if found then
		if prior_coupon.offer_id <> p_offer_id or prior_coupon.location_id <> p_location_id
			or prior_coupon.offer_date <> p_offer_date or prior_coupon.starts_at <> p_starts_at then
			raise exception 'This reservation key was already used for a different offer.' using errcode = '22023';
		end if;
		return jsonb_build_object('id', prior_coupon.id, 'code', prior_coupon.coupon_code, 'status', prior_coupon.status, 'alreadyReserved', true);
	end if;

	select * into offer from public.seller_offers seller_offer
	where seller_offer.id = p_offer_id and seller_offer.status = 'published'
	for share;
	if not found or p_offer_date < offer.valid_from or p_offer_date > offer.valid_until then
		raise exception 'This offer is not available for that date.' using errcode = '55000';
	end if;
	select profile.city_id into visitor_city_id from public.profiles profile where profile.id = v_visitor_id;
	if not exists (
		select 1 from public.seller_offer_locations location
		where location.id = p_location_id and location.offer_id = offer.id and location.city_id = visitor_city_id
	) then
		raise exception 'This offer is not available for your saved city.' using errcode = '42501';
	end if;

	select * into quota
	from public.seller_offer_daily_quotas daily_quota
	where daily_quota.location_id = p_location_id
		and daily_quota.offer_date = p_offer_date
		and daily_quota.starts_at = p_starts_at;
	if not found then
		raise exception 'This offer time is no longer available.' using errcode = '55000';
	end if;
	window_start := (quota.offer_date + quota.starts_at) at time zone 'Europe/London';
	window_end := (quota.offer_date + quota.ends_at) at time zone 'Europe/London';
	if now() >= window_end then
		raise exception 'This offer time has ended.' using errcode = '55000';
	end if;

	select account.points_balance into v_points_balance
	from public.loyalty_accounts account
	where account.visitor_id = v_visitor_id
	for update;
	if v_points_balance is null or v_points_balance < offer.points_cost then
		raise exception 'There are not enough points for this offer.' using errcode = '23514';
	end if;

	select * into quota
	from public.seller_offer_daily_quotas daily_quota
	where daily_quota.location_id = p_location_id
		and daily_quota.offer_date = p_offer_date
		and daily_quota.starts_at = p_starts_at
	for update;
	if not found or quota.reserved_count >= quota.capacity then
		raise exception 'This daily offer quota is full.' using errcode = '55000';
	end if;

	select * into prior_coupon
	from public.seller_offer_coupons
	where seller_offer_coupons.offer_id = p_offer_id
		and seller_offer_coupons.visitor_id = v_visitor_id
		and seller_offer_coupons.offer_date = p_offer_date;
	if found then
		if prior_coupon.status = 'reserved' then
			return jsonb_build_object('id', prior_coupon.id, 'code', prior_coupon.coupon_code, 'status', prior_coupon.status, 'alreadyReserved', true);
		end if;
		raise exception 'Only one reservation attempt is allowed for this offer each day.' using errcode = '55000';
	end if;

	coupon_code := upper(substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 20));
	update public.seller_offer_daily_quotas
	set reserved_count = reserved_count + 1
	where location_id = p_location_id and offer_date = p_offer_date and starts_at = p_starts_at;
	update public.loyalty_accounts
	set points_balance = v_points_balance - offer.points_cost, updated_at = now()
	where loyalty_accounts.visitor_id = v_visitor_id;
	insert into public.seller_offer_coupons (
		offer_id, location_id, visitor_id, offer_date, starts_at, ends_at,
		points_cost, coupon_code, idempotency_key
	)
	values (offer.id, p_location_id, v_visitor_id, p_offer_date, p_starts_at, quota.ends_at,
		offer.points_cost, coupon_code, p_idempotency_key)
	returning * into coupon;
	insert into public.seller_offer_point_transactions (
		visitor_id, coupon_id, points_delta, transaction_type, idempotency_key
	)
	values (v_visitor_id, coupon.id, -offer.points_cost, 'spent', 'coupon:' || coupon.id::text || ':spent');
	return jsonb_build_object('id', coupon.id, 'code', coupon.coupon_code, 'status', coupon.status, 'alreadyReserved', false);
end;
$$;

create function public.cancel_seller_offer_coupon(p_coupon_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_visitor_id uuid := (select auth.uid());
	coupon public.seller_offer_coupons%rowtype;
	quota public.seller_offer_daily_quotas%rowtype;
	v_points_balance bigint;
	window_start timestamptz;
begin
	if v_visitor_id is null or not public.is_supported_loyalty_visitor(v_visitor_id) or p_coupon_id is null then
		raise exception 'An eligible visitor account and voucher are required.' using errcode = '42501';
	end if;
	select * into coupon from public.seller_offer_coupons coupon_row
	where coupon_row.id = p_coupon_id and coupon_row.visitor_id = v_visitor_id;
	if not found then raise exception 'Voucher not found.' using errcode = 'P0002'; end if;

	select account.points_balance into v_points_balance
	from public.loyalty_accounts account where account.visitor_id = v_visitor_id for update;
	select * into quota
	from public.seller_offer_daily_quotas daily_quota
	where daily_quota.location_id = coupon.location_id
		and daily_quota.offer_date = coupon.offer_date and daily_quota.starts_at = coupon.starts_at
	for update;
	select * into coupon from public.seller_offer_coupons coupon_row
	where coupon_row.id = p_coupon_id and coupon_row.visitor_id = v_visitor_id for update;
	if coupon.status = 'cancelled' then
		return jsonb_build_object('status', 'cancelled', 'refunded', false);
	end if;
	if coupon.status <> 'reserved' then
		raise exception 'This voucher can no longer be cancelled.' using errcode = '55000';
	end if;
	window_start := (coupon.offer_date + coupon.starts_at) at time zone 'Europe/London';
	if now() >= window_start then
		raise exception 'Vouchers can only be cancelled before the offer window opens.' using errcode = '55000';
	end if;
	if quota.reserved_count < 1 then raise exception 'Offer quota is inconsistent.' using errcode = 'P0002'; end if;

	update public.seller_offer_coupons
	set status = 'cancelled', cancelled_at = now()
	where id = p_coupon_id;
	update public.seller_offer_daily_quotas
	set reserved_count = reserved_count - 1
	where location_id = coupon.location_id and offer_date = coupon.offer_date and starts_at = coupon.starts_at;
	update public.loyalty_accounts
	set points_balance = v_points_balance + coupon.points_cost, updated_at = now()
	where loyalty_accounts.visitor_id = v_visitor_id;
	insert into public.seller_offer_point_transactions (visitor_id, coupon_id, points_delta, transaction_type, idempotency_key)
	values (v_visitor_id, coupon.id, coupon.points_cost, 'refund', 'coupon:' || coupon.id::text || ':refund');
	return jsonb_build_object('status', 'cancelled', 'refunded', true, 'points', coupon.points_cost);
end;
$$;

create function public.seller_redeem_offer_coupon(p_coupon_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	seller_id uuid;
	coupon public.seller_offer_coupons%rowtype;
	offer public.seller_offers%rowtype;
	window_start timestamptz;
	window_end timestamptz;
begin
	select profile.id into seller_id
	from public.seller_profiles profile
	where profile.user_id = (select auth.uid()) and profile.status = 'active';
	if seller_id is null or p_coupon_code is null or p_coupon_code !~ '^[A-Fa-f0-9]{20}$' then
		raise exception 'An active seller and valid voucher code are required.' using errcode = '42501';
	end if;
	select coupon_row.* into coupon
	from public.seller_offer_coupons coupon_row
	join public.seller_offers seller_offer on seller_offer.id = coupon_row.offer_id
	where coupon_row.coupon_code = upper(p_coupon_code)
		and seller_offer.seller_profile_id = seller_id
	for update of coupon_row;
	if not found then raise exception 'Voucher not found for this shop.' using errcode = 'P0002'; end if;
	select * into offer from public.seller_offers seller_offer where seller_offer.id = coupon.offer_id;
	if coupon.status = 'redeemed' then
		return jsonb_build_object('status', 'redeemed', 'alreadyRedeemed', true);
	end if;
	if coupon.status <> 'reserved' or offer.status not in ('published', 'paused') then
		raise exception 'This voucher is not valid.' using errcode = '55000';
	end if;
	window_start := (coupon.offer_date + coupon.starts_at) at time zone 'Europe/London';
	window_end := (coupon.offer_date + coupon.ends_at) at time zone 'Europe/London';
	if now() < window_start then raise exception 'This voucher is not valid yet.' using errcode = '55000'; end if;
	if now() >= window_end then
		update public.seller_offer_coupons set status = 'expired', expired_at = now() where id = coupon.id;
		return jsonb_build_object('status', 'expired', 'alreadyRedeemed', false);
	end if;
	update public.seller_offer_coupons set status = 'redeemed', redeemed_at = now() where id = coupon.id;
	return jsonb_build_object('status', 'redeemed', 'alreadyRedeemed', false);
end;
$$;

create function public.get_visitor_seller_offer_coupons()
returns table (
	id uuid,
	offer_id uuid,
	title text,
	coupon_code text,
	status text,
	points_cost integer,
	offer_date date,
	starts_at time,
	ends_at time,
	branch_name text,
	branch_address text,
	city_name text,
	created_at timestamptz,
	can_cancel boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not public.is_supported_loyalty_visitor((select auth.uid())) then
		raise exception 'An eligible visitor account is required.' using errcode = '42501';
	end if;
	update public.seller_offer_coupons coupon
	set status = 'expired', expired_at = now()
	where coupon.visitor_id = (select auth.uid()) and coupon.status = 'reserved'
		and now() >= ((coupon.offer_date + coupon.ends_at) at time zone 'Europe/London');
	return query
	select coupon.id, coupon.offer_id, offer.title, coupon.coupon_code, coupon.status,
		coupon.points_cost, coupon.offer_date, coupon.starts_at, coupon.ends_at,
		location.branch_name, location.branch_address, city.city_name, coupon.created_at,
		(coupon.status = 'reserved' and now() < ((coupon.offer_date + coupon.starts_at) at time zone 'Europe/London'))
	from public.seller_offer_coupons coupon
	join public.seller_offers offer on offer.id = coupon.offer_id
	join public.seller_offer_locations location on location.id = coupon.location_id
	join public.supported_cities city on city.city_id = location.city_id
	where coupon.visitor_id = (select auth.uid())
	order by coupon.created_at desc, coupon.id desc;
end;
$$;

create function public.prevent_ending_seller_offer_with_reserved_coupons()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if exists (
		select 1 from public.seller_offer_coupons coupon
		where coupon.offer_id = old.id and coupon.status = 'reserved'
			and now() < ((coupon.offer_date + coupon.ends_at) at time zone 'Europe/London')
	) then
		raise exception 'Redeem or expire every active voucher before ending this offer.' using errcode = '55000';
	end if;
	return new;
end;
$$;

create trigger prevent_ending_seller_offer_with_active_coupons
	before update of status on public.seller_offers
	for each row
	when (new.status = 'ended' and old.status is distinct from 'ended')
	execute function public.prevent_ending_seller_offer_with_reserved_coupons();

revoke all on function public.reserve_seller_offer_coupon(uuid,uuid,date,time,uuid) from public, anon;
revoke all on function public.cancel_seller_offer_coupon(uuid) from public, anon;
revoke all on function public.seller_redeem_offer_coupon(text) from public, anon;
revoke all on function public.get_visitor_seller_offer_coupons() from public, anon;
grant execute on function public.reserve_seller_offer_coupon(uuid,uuid,date,time,uuid) to authenticated;
grant execute on function public.cancel_seller_offer_coupon(uuid) to authenticated;
grant execute on function public.seller_redeem_offer_coupon(text) to authenticated;
grant execute on function public.get_visitor_seller_offer_coupons() to authenticated;
revoke all on function public.prevent_ending_seller_offer_with_reserved_coupons() from public, anon, authenticated;