alter table public.seller_ad_accounts
	add column welcome_clicks_remaining bigint not null default 0
		check (welcome_clicks_remaining >= 0),
	add column admin_clicks_remaining bigint not null default 0
		check (admin_clicks_remaining >= 0),
	add column welcome_bonus_granted_at timestamptz,
	add constraint seller_ad_accounts_free_credits_fit
		check (welcome_clicks_remaining + admin_clicks_remaining <= clicks_remaining);

create table public.seller_ad_credit_grants (
	id bigint generated always as identity primary key,
	seller_profile_id uuid not null references public.seller_profiles (id) on delete cascade,
	actor_id uuid not null references auth.users (id) on delete restrict,
	clicks bigint not null check (clicks > 0),
	note text not null default '',
	created_at timestamptz not null default now()
);

alter table public.seller_ad_credit_grants enable row level security;
grant select on public.seller_ad_credit_grants to authenticated;
create policy "Admins read seller ad credit grants"
	on public.seller_ad_credit_grants for select to authenticated
	using ((select public.is_admin()));

update public.seller_ad_accounts
set clicks_remaining = clicks_remaining + 10000,
	welcome_clicks_remaining = 10000,
	welcome_bonus_granted_at = now(),
	updated_at = now()
where welcome_bonus_granted_at is null;

create or replace function public.create_seller_ad_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	insert into public.seller_ad_accounts (
		seller_profile_id,
		clicks_remaining,
		welcome_clicks_remaining,
		welcome_bonus_granted_at
	)
	values (new.id, 10000, 10000, now())
	on conflict (seller_profile_id) do nothing;
	return new;
end;
$$;

create or replace function public.admin_grant_seller_ad_credits(p_seller_id uuid, p_clicks bigint, p_note text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
	updated_balance bigint;
	grant_note text := coalesce(trim(p_note), '');
	admin_id uuid := (select auth.uid());
begin
	if not public.is_admin() then
		raise exception 'Administrator access is required.' using errcode = '42501';
	end if;
	if p_seller_id is null or p_clicks is null or p_clicks < 1 or p_clicks > 10000000 then
		raise exception 'Enter a valid seller and a grant between 1 and 10,000,000 clicks.' using errcode = '22023';
	end if;
	if length(grant_note) > 300 then
		raise exception 'Grant note must be 300 characters or fewer.' using errcode = '22023';
	end if;

	update public.seller_ad_accounts
	set clicks_remaining = clicks_remaining + p_clicks,
		admin_clicks_remaining = admin_clicks_remaining + p_clicks,
		updated_at = now()
	where seller_profile_id = p_seller_id
	returning clicks_remaining into updated_balance;

	if updated_balance is null then
		raise exception 'Seller advertising account was not found.' using errcode = 'P0002';
	end if;

	insert into public.seller_ad_credit_grants (seller_profile_id, actor_id, clicks, note)
	values (p_seller_id, admin_id, p_clicks, grant_note);

	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values (
		admin_id,
		'grant_ad_click_credits',
		'seller_profile',
		p_seller_id,
		jsonb_build_object('clicks', p_clicks, 'note', grant_note)
	);

	return updated_balance;
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
	welcome_clicks bigint;
	admin_clicks bigint;
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

	select account.clicks_remaining, account.welcome_clicks_remaining, account.admin_clicks_remaining
	into account_clicks, welcome_clicks, admin_clicks
	from public.seller_ad_accounts account
	where account.seller_profile_id = product_seller_id
	for update;

	if account_clicks is null or account_clicks <= 0 then
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
		select coalesce(sum(allocation.clicks_remaining), 0) into allocated_clicks
		from public.seller_product_click_allocations allocation
		where allocation.seller_profile_id = product_seller_id;

		if account_clicks <= allocated_clicks then
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

revoke all on function public.admin_grant_seller_ad_credits(uuid, bigint, text) from public, anon;
grant execute on function public.admin_grant_seller_ad_credits(uuid, bigint, text) to authenticated;