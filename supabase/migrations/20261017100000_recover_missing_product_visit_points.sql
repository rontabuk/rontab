create or replace function public.is_point_earning_visitor(p_visitor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		from auth.users account_user
		join public.profiles profile on profile.id = account_user.id
		join public.supported_countries country on country.country_code = profile.country_code
		where account_user.id = p_visitor_id
			and account_user.email_confirmed_at is not null
			and country.is_enabled
			and not coalesce((account_user.raw_app_meta_data ->> 'role') = 'admin', false)
	)
	and not exists (
		select 1 from public.seller_profiles seller where seller.user_id = p_visitor_id
	);
$$;

revoke all on function public.is_point_earning_visitor(uuid) from public, anon, authenticated;

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
	where public.is_point_earning_visitor(current_visitor.visitor_id);
$$;

create or replace function public.get_visitor_daily_visit_points_status()
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
		and public.is_point_earning_visitor((select auth.uid()))
	group by settings.visitor_daily_visit_points_cap;
$$;

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
		and public.is_point_earning_visitor((select auth.uid()));
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
		and public.is_point_earning_visitor((select auth.uid()))
	order by activity.created_at desc, activity.id desc
	limit p_limit offset p_offset;
end;
$$;

create or replace function public.get_visitor_loyalty_offers()
returns table (
	id uuid,
	title text,
	summary text,
	description text,
	image_url text,
	terms text,
	offer_type text,
	selection_method text,
	minimum_points integer,
	points_cost integer,
	capacity integer,
	claim_count bigint,
	remaining_count bigint,
	locations text[],
	starts_at timestamptz,
	ends_at timestamptz,
	already_joined boolean
)
language sql
stable
security definer
set search_path = ''
as $$
	select offer.id, offer.title, offer.summary, offer.description, offer.image_url, offer.terms,
		offer.offer_type, offer.selection_method, offer.minimum_points, offer.points_cost,
		coalesce(visitor_quota.capacity, offer.capacity), count(claim.id)::bigint,
		case when offer.offer_type = 'participation' and offer.selection_method = 'random'
			then coalesce(visitor_quota.capacity, offer.capacity)::bigint
			else greatest(coalesce(visitor_quota.capacity, offer.capacity) - count(claim.id), 0)::bigint end,
		coalesce((select array_agg(city.city_name || ', ' || city.country_code order by lower(city.city_name), city.admin_name)
			from public.loyalty_offer_city_quotas quota
			join public.supported_cities city on city.city_id = quota.city_id
			where quota.offer_id = offer.id), array['All locations']::text[]),
		offer.starts_at, offer.ends_at, coalesce(bool_or(claim.visitor_id = (select auth.uid())), false)
	from public.loyalty_offers offer
	join public.profiles visitor on visitor.id = (select auth.uid())
	left join public.loyalty_offer_city_quotas visitor_quota
		on visitor_quota.offer_id = offer.id and visitor_quota.city_id = visitor.city_id
	left join public.loyalty_offer_claims claim on claim.offer_id = offer.id
		and (not exists (select 1 from public.loyalty_offer_city_quotas quota where quota.offer_id = offer.id)
			or claim.city_id = visitor_quota.city_id)
	where public.is_point_earning_visitor((select auth.uid()))
		and offer.status = 'published'
		and offer.starts_at <= now()
		and offer.ends_at > now()
		and (not exists (select 1 from public.loyalty_offer_city_quotas quota where quota.offer_id = offer.id)
			or visitor_quota.offer_id is not null)
		and (offer.selection_method <> 'random' or exists (
			select 1 from public.marketplace_settings where singleton = true and loyalty_random_draws_enabled))
	group by offer.id, visitor_quota.capacity
	order by offer.ends_at asc, offer.created_at desc;
$$;

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
	if not public.is_point_earning_visitor(new.visitor_id) then
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

create trigger visitor_product_points_retry_award
	after update on public.visitor_product_points
	for each row execute function public.record_visitor_loyalty_point();

update public.visitor_product_points point
set awarded_at = point.awarded_at
where public.is_point_earning_visitor(point.visitor_id)
	and not exists (
		select 1 from public.loyalty_point_transactions transaction
		where transaction.visitor_id = point.visitor_id
			and transaction.transaction_type = 'visit_earned'
			and transaction.source_product_id = point.product_id
	);

create or replace function public.record_product_shop_click(p_product_id uuid, p_visitor_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
	product_seller_id uuid;
	account_clicks bigint;
	welcome_clicks bigint;
	admin_clicks bigint;
	allocated_clicks bigint;
	product_allocation bigint;
	visitor_is_registered boolean;
	click_window timestamptz;
begin
	if p_visitor_id is null then
		raise exception 'A visitor identifier is required.' using errcode = '22023';
	end if;

	if exists (
		select 1 from auth.users u
		where u.id = p_visitor_id and u.email_confirmed_at is null
	) then
		raise exception 'A confirmed visitor account is required.' using errcode = '42501';
	end if;
	visitor_is_registered := exists (select 1 from auth.users u where u.id = p_visitor_id and u.email_confirmed_at is not null);
	click_window := case
		when visitor_is_registered then '1970-01-01 00:00:00+00'::timestamptz
		else to_timestamp(floor(extract(epoch from now()) / 1800) * 1800)
	end;

	select p.seller_profile_id into product_seller_id
	from public.products p
	join public.seller_profiles s on s.id = p.seller_profile_id
	join public.categories c on c.id = p.category_id
	where p.id = p_product_id
		and p.status = 'approved'
		and s.status = 'active'
		and s.is_public
		and s.user_id is distinct from p_visitor_id
		and c.is_active;

	if product_seller_id is null then
		return false;
	end if;

	select account.clicks_remaining, account.welcome_clicks_remaining, account.admin_clicks_remaining
	into account_clicks, welcome_clicks, admin_clicks
	from public.seller_ad_accounts account
	where account.seller_profile_id = product_seller_id
	for update;

	if account_clicks is null or account_clicks <= 0 then
		return false;
	end if;

	if exists (
		select 1 from public.product_shop_click_events event
		where event.product_id = p_product_id
			and event.visitor_id = p_visitor_id
			and event.window_start = click_window
	) then
		if visitor_is_registered then
			update public.visitor_product_points point
			set awarded_at = point.awarded_at
			where point.visitor_id = p_visitor_id and point.product_id = p_product_id;
			if not found then
				insert into public.visitor_product_points (visitor_id, product_id)
				values (p_visitor_id, p_product_id)
				on conflict (visitor_id, product_id) do nothing;
			end if;
		end if;
		return true;
	end if;

	select allocation.clicks_remaining into product_allocation
	from public.seller_product_click_allocations allocation
	where allocation.seller_profile_id = product_seller_id
		and allocation.product_id = p_product_id
	for update;

	if found then
		if product_allocation <= 0 then
			return false;
		end if;
		update public.seller_product_click_allocations
		set clicks_remaining = clicks_remaining - 1,
			updated_at = now()
		where seller_profile_id = product_seller_id
			and product_id = p_product_id;
	else
		select coalesce(sum(allocation.clicks_remaining), 0) into allocated_clicks
		from public.seller_product_click_allocations allocation
		where allocation.seller_profile_id = product_seller_id;

		if account_clicks <= coalesce(allocated_clicks, 0) then
			return false;
		end if;
	end if;

	if admin_clicks > 0 then
		update public.seller_ad_accounts
		set admin_clicks_remaining = admin_clicks_remaining - 1
		where seller_profile_id = product_seller_id;
	elsif welcome_clicks > 0 then
		update public.seller_ad_accounts
		set welcome_clicks_remaining = welcome_clicks_remaining - 1
		where seller_profile_id = product_seller_id;
	end if;

	update public.seller_ad_accounts
	set clicks_remaining = clicks_remaining - 1,
		updated_at = now()
	where seller_profile_id = product_seller_id;

	insert into public.product_shop_click_events (product_id, visitor_id, window_start)
	values (p_product_id, p_visitor_id, click_window);

	if visitor_is_registered then
		insert into public.visitor_product_points (visitor_id, product_id)
		values (p_visitor_id, p_product_id)
		on conflict (visitor_id, product_id) do nothing;
	end if;

	update public.products
	set click_count = click_count + 1,
		clicks_since_top_up = clicks_since_top_up + 1
	where id = p_product_id;

	return true;
end;
$$;

revoke all on function public.record_product_shop_click(uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_product_shop_click(uuid, uuid) to service_role;