create table public.visitor_product_points (
	visitor_id uuid not null references auth.users (id) on delete cascade,
	product_id uuid not null references public.products (id) on delete cascade,
	awarded_at timestamptz not null default now(),
	primary key (visitor_id, product_id)
);

alter table public.visitor_product_points enable row level security;
grant select on public.visitor_product_points to authenticated;
create policy "Visitors read their own product points"
	on public.visitor_product_points for select to authenticated
	using (visitor_id = (select auth.uid()));

create or replace function public.get_visitor_loyalty_points()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
	select count(*)
	from public.visitor_product_points
	where visitor_id = (select auth.uid());
$$;

revoke all on function public.get_visitor_loyalty_points() from public, anon;
grant execute on function public.get_visitor_loyalty_points() to authenticated;

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