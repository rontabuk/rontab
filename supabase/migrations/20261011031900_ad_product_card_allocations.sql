alter table public.products
	add column clicks_since_top_up bigint not null default 0
		check (clicks_since_top_up >= 0);

alter table public.seller_product_click_allocations
	add column clicks_limit bigint not null default 0
		check (clicks_limit >= 0);

update public.seller_product_click_allocations
set clicks_limit = clicks_remaining
where clicks_limit = 0 and clicks_remaining > 0;

create or replace function public.is_product_click_credit_available(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		from public.products p
		join public.seller_profiles s on s.id = p.seller_profile_id
		join public.categories c on c.id = p.category_id
		join public.seller_ad_accounts account on account.seller_profile_id = s.id
		where p.id = p_product_id
			and p.status = 'approved'
			and s.status = 'active'
			and s.is_public
			and c.is_active
			and account.clicks_remaining > 0
			and (
				exists (
					select 1
					from public.seller_product_click_allocations allocation
					where allocation.product_id = p.id
						and allocation.seller_profile_id = s.id
						and allocation.clicks_remaining > 0
				)
				or (
					not exists (
						select 1
						from public.seller_product_click_allocations allocation
						where allocation.product_id = p.id
							and allocation.seller_profile_id = s.id
					)
					and account.clicks_remaining > coalesce((
						select sum(allocation.clicks_remaining)
						from public.seller_product_click_allocations allocation
						where allocation.seller_profile_id = s.id
					), 0)
				)
			)
	);
$$;

revoke all on function public.is_product_click_credit_available(uuid) from public;
grant execute on function public.is_product_click_credit_available(uuid) to anon, authenticated;

drop policy "Public reads approved products; sellers read their own" on public.products;

create policy "Public reads approved funded products; sellers read their own"
	on public.products for select to anon, authenticated
	using (
		public.is_product_click_credit_available(id)
		or (select public.is_seller_owner(seller_profile_id))
		or (select public.is_admin())
	);

create or replace function public.seller_set_product_click_allocations(p_allocations jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	seller_id uuid;
	account_clicks bigint;
	requested_clicks bigint;
begin
	select id into seller_id
	from public.seller_profiles
	where user_id = (select auth.uid())
		and status = 'active';

	if seller_id is null then
		raise exception 'An active seller account is required.' using errcode = '42501';
	end if;
	if jsonb_typeof(p_allocations) is distinct from 'array' then
		raise exception 'Product allocations must be an array.' using errcode = '22023';
	end if;

	select clicks_remaining into account_clicks
	from public.seller_ad_accounts
	where seller_profile_id = seller_id
	for update;

	if exists (
		select 1
		from jsonb_to_recordset(p_allocations) as requested(product_id uuid, clicks_remaining bigint, clicks_limit bigint)
		left join public.products p
		on p.id = requested.product_id
			and p.seller_profile_id = seller_id
			and p.status = 'approved'
		where p.id is null
			or requested.clicks_remaining is null
			or requested.clicks_limit is null
			or requested.clicks_remaining < 0
			or requested.clicks_limit < requested.clicks_remaining
	) then
		raise exception 'Allocations must target approved products owned by this seller and have valid click limits.' using errcode = '22023';
	end if;

	if exists (
		select 1
		from jsonb_to_recordset(p_allocations) as requested(product_id uuid, clicks_remaining bigint, clicks_limit bigint)
		group by requested.product_id
		having count(*) > 1
	) then
		raise exception 'A product can only have one allocation.' using errcode = '22023';
	end if;

	select coalesce(sum(requested.clicks_remaining), 0) into requested_clicks
	from jsonb_to_recordset(p_allocations) as requested(product_id uuid, clicks_remaining bigint, clicks_limit bigint);

	if requested_clicks > account_clicks then
		raise exception 'Product allocations cannot exceed the remaining account balance.' using errcode = '22023';
	end if;

	delete from public.seller_product_click_allocations
	where seller_profile_id = seller_id;

	insert into public.seller_product_click_allocations (seller_profile_id, product_id, clicks_remaining, clicks_limit)
	select seller_id, requested.product_id, requested.clicks_remaining, requested.clicks_limit
	from jsonb_to_recordset(p_allocations) as requested(product_id uuid, clicks_remaining bigint, clicks_limit bigint);
end;
$$;

create or replace function public.record_product_shop_click(p_product_id uuid, p_visitor_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
	product_seller_id uuid;
	account_clicks bigint;
	product_allocation bigint;
	click_window timestamptz;
begin
	select p.seller_profile_id into product_seller_id
	from public.products p
	join public.seller_profiles s on s.id = p.seller_profile_id
	join public.categories c on c.id = p.category_id
	where p.id = p_product_id
		and p.status = 'approved'
		and s.status = 'active'
		and s.is_public
		and c.is_active;

	if product_seller_id is null then
		return false;
	end if;
	if p_visitor_id is null then
		raise exception 'A visitor identifier is required.' using errcode = '22023';
	end if;

	select clicks_remaining into account_clicks
	from public.seller_ad_accounts
	where seller_profile_id = product_seller_id
	for update;

	if account_clicks is null then
		return false;
	end if;

	click_window := to_timestamp(floor(extract(epoch from now()) / 1800) * 1800);
	if exists (
		select 1 from public.product_shop_click_events e
		where e.product_id = p_product_id
			and e.visitor_id = p_visitor_id
			and e.window_start = click_window
	) then
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
		if account_clicks <= coalesce((
			select sum(allocation.clicks_remaining)
			from public.seller_product_click_allocations allocation
			where allocation.seller_profile_id = product_seller_id
		), 0) then
			return false;
		end if;
	end if;

	update public.seller_ad_accounts
	set clicks_remaining = clicks_remaining - 1,
		updated_at = now()
	where seller_profile_id = product_seller_id;

	insert into public.product_shop_click_events (product_id, visitor_id, window_start)
	values (p_product_id, p_visitor_id, click_window);

	update public.products
	set click_count = click_count + 1,
		clicks_since_top_up = clicks_since_top_up + 1
	where id = p_product_id;

	return true;
end;
$$;

create or replace function public.apply_seller_ad_credit_top_up(p_seller_id uuid, p_clicks bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
	updated_balance bigint;
begin
	if p_clicks is null or p_clicks <= 0 then
		raise exception 'Top-up clicks must be a positive integer.' using errcode = '22023';
	end if;

	update public.seller_ad_accounts
	set clicks_remaining = clicks_remaining + p_clicks,
		updated_at = now()
	where seller_profile_id = p_seller_id
	returning clicks_remaining into updated_balance;

	if updated_balance is null then
		raise exception 'Seller advertising account was not found.' using errcode = 'P0002';
	end if;

	update public.products
	set clicks_since_top_up = 0
	where seller_profile_id = p_seller_id;

	return updated_balance;
end;
$$;

revoke all on function public.apply_seller_ad_credit_top_up(uuid, bigint) from public, anon, authenticated;
grant execute on function public.apply_seller_ad_credit_top_up(uuid, bigint) to service_role;