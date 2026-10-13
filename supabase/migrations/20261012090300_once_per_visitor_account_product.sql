create unique index product_shop_click_events_once_per_account_product
	on public.product_shop_click_events (product_id, visitor_id)
	where window_start = '1970-01-01 00:00:00+00'::timestamptz;

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
	click_window timestamptz := '1970-01-01 00:00:00+00'::timestamptz;
begin
	if p_visitor_id is null then
		raise exception 'A registered visitor account is required.' using errcode = '22023';
	end if;

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

	update public.products
	set click_count = click_count + 1,
		clicks_since_top_up = clicks_since_top_up + 1
	where id = p_product_id;

	return true;
end;
$$;

revoke all on function public.record_product_shop_click(uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_product_shop_click(uuid, uuid) to service_role;