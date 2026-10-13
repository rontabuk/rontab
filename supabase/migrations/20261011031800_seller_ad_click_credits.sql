create table public.seller_ad_accounts (
	seller_profile_id uuid primary key references public.seller_profiles (id) on delete cascade,
	clicks_remaining bigint not null default 0 check (clicks_remaining >= 0),
	updated_at timestamptz not null default now()
);

create table public.seller_product_click_allocations (
	seller_profile_id uuid not null references public.seller_profiles (id) on delete cascade,
	product_id uuid not null references public.products (id) on delete cascade,
	clicks_remaining bigint not null check (clicks_remaining >= 0),
	updated_at timestamptz not null default now(),
	primary key (seller_profile_id, product_id)
);

create table public.product_shop_click_events (
	product_id uuid not null references public.products (id) on delete cascade,
	visitor_id uuid not null,
	window_start timestamptz not null,
	created_at timestamptz not null default now(),
	primary key (product_id, visitor_id, window_start)
);

alter table public.seller_ad_accounts enable row level security;
alter table public.seller_product_click_allocations enable row level security;
alter table public.product_shop_click_events enable row level security;

grant select on public.seller_ad_accounts, public.seller_product_click_allocations to authenticated;
revoke all on public.product_shop_click_events from anon, authenticated;

create policy "Sellers read their own ad account"
	on public.seller_ad_accounts for select to authenticated
	using (
		(select public.is_seller_owner(seller_profile_id))
		or (select public.is_admin())
	);

create policy "Sellers read their own product click allocations"
	on public.seller_product_click_allocations for select to authenticated
	using (
		(select public.is_seller_owner(seller_profile_id))
		or (select public.is_admin())
	);

create or replace function public.create_seller_ad_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	insert into public.seller_ad_accounts (seller_profile_id)
	values (new.id)
	on conflict (seller_profile_id) do nothing;
	return new;
end;
$$;

create trigger create_seller_ad_account
	after insert on public.seller_profiles
	for each row execute function public.create_seller_ad_account();

insert into public.seller_ad_accounts (seller_profile_id)
select id from public.seller_profiles
on conflict (seller_profile_id) do nothing;

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
		from jsonb_to_recordset(p_allocations) as requested(product_id uuid, clicks_remaining bigint)
		left join public.products p
			on p.id = requested.product_id
			and p.seller_profile_id = seller_id
			and p.status = 'approved'
		where p.id is null or requested.clicks_remaining is null or requested.clicks_remaining < 0
	) then
		raise exception 'Allocations must target approved products owned by this seller.' using errcode = '22023';
	end if;

	if exists (
		select 1
		from jsonb_to_recordset(p_allocations) as requested(product_id uuid, clicks_remaining bigint)
		group by requested.product_id
		having count(*) > 1
	) then
		raise exception 'A product can only have one allocation.' using errcode = '22023';
	end if;

	select coalesce(sum(requested.clicks_remaining), 0) into requested_clicks
	from jsonb_to_recordset(p_allocations) as requested(product_id uuid, clicks_remaining bigint);

	if requested_clicks > account_clicks then
		raise exception 'Product allocations cannot exceed the remaining account balance.' using errcode = '22023';
	end if;

	delete from public.seller_product_click_allocations
	where seller_profile_id = seller_id;

	insert into public.seller_product_click_allocations (seller_profile_id, product_id, clicks_remaining)
	select seller_id, requested.product_id, requested.clicks_remaining
	from jsonb_to_recordset(p_allocations) as requested(product_id uuid, clicks_remaining bigint)
	where requested.clicks_remaining > 0;
end;
$$;

drop function public.record_product_shop_click(uuid);

create function public.record_product_shop_click(p_product_id uuid, p_visitor_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
	product_seller_id uuid;
	account_clicks bigint;
	allocated_clicks bigint;
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

	select a.clicks_remaining into product_allocation
	from public.seller_product_click_allocations a
	where a.seller_profile_id = product_seller_id
		and a.product_id = p_product_id
	for update;

	select coalesce(sum(a.clicks_remaining), 0) into allocated_clicks
	from public.seller_product_click_allocations a
	where a.seller_profile_id = product_seller_id;

	if coalesce(product_allocation, 0) > 0 then
		update public.seller_product_click_allocations
		set clicks_remaining = clicks_remaining - 1,
			updated_at = now()
		where seller_profile_id = product_seller_id
			and product_id = p_product_id;
	elsif account_clicks <= allocated_clicks then
		return false;
	end if;

	update public.seller_ad_accounts
	set clicks_remaining = clicks_remaining - 1,
		updated_at = now()
	where seller_profile_id = product_seller_id;

	insert into public.product_shop_click_events (product_id, visitor_id, window_start)
	values (p_product_id, p_visitor_id, click_window);

	update public.products
	set click_count = click_count + 1
	where id = p_product_id;

	return true;
end;
$$;

revoke all on function public.create_seller_ad_account() from public, anon, authenticated;
revoke all on function public.seller_set_product_click_allocations(jsonb) from public, anon;
grant execute on function public.seller_set_product_click_allocations(jsonb) to authenticated;
revoke all on function public.record_product_shop_click(uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_product_shop_click(uuid, uuid) to service_role;