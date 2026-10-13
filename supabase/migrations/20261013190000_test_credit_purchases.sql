create table public.seller_credit_purchases (
	id uuid primary key,
	seller_profile_id uuid not null references public.seller_profiles (id) on delete restrict,
	clicks integer not null check (clicks between 1000 and 1000000 and clicks % 1000 = 0),
	unit_price_pence_per_1000 integer not null check (unit_price_pence_per_1000 between 1 and 100000),
	amount_pence integer not null check (amount_pence between 30 and 99999999),
	currency text not null default 'gbp' check (currency = 'gbp'),
	is_test boolean not null default true check (is_test),
	status text not null default 'pending' check (status in ('pending', 'paid', 'expired')),
	stripe_checkout_session_id text unique,
	stripe_payment_intent_id text unique,
	paid_event_id text unique,
	created_at timestamptz not null default now(),
	paid_at timestamptz,
	check (amount_pence = (clicks / 1000) * unit_price_pence_per_1000),
	check (status <> 'paid' or (paid_at is not null and stripe_checkout_session_id is not null and stripe_payment_intent_id is not null and paid_event_id is not null))
);

create index seller_credit_purchases_seller_created_idx on public.seller_credit_purchases (seller_profile_id, created_at desc);
alter table public.seller_credit_purchases enable row level security;
revoke all on public.seller_credit_purchases from public, anon, authenticated;
grant select on public.seller_credit_purchases to authenticated;
grant all on public.seller_credit_purchases to service_role;
create policy "Sellers and admins read credit purchase records"
	on public.seller_credit_purchases for select to authenticated
	using ((select public.is_seller_owner(seller_profile_id)) or (select public.is_admin()));

create function public.seller_create_credit_purchase(p_clicks integer, p_request_id uuid, p_expected_rate integer)
returns setof public.seller_credit_purchases
language plpgsql
security definer
set search_path = ''
as $$
declare
	seller_id uuid;
	current_rate integer;
	purchase public.seller_credit_purchases;
begin
	select id into seller_id from public.seller_profiles
	where user_id = (select auth.uid()) and status = 'active';
	if seller_id is null or (select public.is_admin()) then
		raise exception 'An active seller account is required.' using errcode = '42501';
	end if;
	if p_clicks is null or p_clicks not between 1000 and 1000000 or p_clicks % 1000 <> 0 or p_request_id is null then
		raise exception 'Choose between 1,000 and 1,000,000 clicks in increments of 1,000.' using errcode = '22023';
	end if;
	select * into purchase from public.seller_credit_purchases where id = p_request_id for update;
	if not found then
		current_rate := public.get_click_price_pence_per_1000();
		if p_expected_rate is distinct from current_rate then
			raise exception 'Click price changed. Refresh the page before purchasing.' using errcode = '22023';
		end if;
		if (p_clicks / 1000) * current_rate not between 30 and 99999999 then
			raise exception 'Choose a quantity with a total price between GBP 0.30 and GBP 999,999.99.' using errcode = '22023';
		end if;
		insert into public.seller_credit_purchases (id, seller_profile_id, clicks, unit_price_pence_per_1000, amount_pence)
		values (p_request_id, seller_id, p_clicks, current_rate, (p_clicks / 1000) * current_rate)
		on conflict (id) do nothing;
		select * into purchase from public.seller_credit_purchases where id = p_request_id for update;
	end if;
	if purchase.seller_profile_id <> seller_id or purchase.clicks <> p_clicks or purchase.unit_price_pence_per_1000 is distinct from p_expected_rate then
		raise exception 'Purchase request does not match.' using errcode = '22023';
	end if;
	return next purchase;
end;
$$;

create function public.billing_attach_credit_checkout(p_purchase_id uuid, p_session_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	purchase public.seller_credit_purchases;
begin
	if p_session_id is null or p_session_id !~ '^cs_test_[A-Za-z0-9_]+$' then
		raise exception 'Only test checkout sessions are supported.' using errcode = '22023';
	end if;
	select * into purchase from public.seller_credit_purchases where id = p_purchase_id for update;
	if not found or (purchase.stripe_checkout_session_id is not null and purchase.stripe_checkout_session_id <> p_session_id) then
		raise exception 'Purchase unavailable.' using errcode = '22023';
	end if;
	update public.seller_credit_purchases set stripe_checkout_session_id = p_session_id where id = p_purchase_id;
end;
$$;

create function public.billing_complete_credit_purchase(p_purchase_id uuid, p_session_id text, p_payment_intent_id text, p_amount_pence integer, p_currency text, p_event_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
	purchase public.seller_credit_purchases;
begin
	select * into purchase from public.seller_credit_purchases where id = p_purchase_id for update;
	if not found or p_session_id is null or p_session_id !~ '^cs_test_[A-Za-z0-9_]+$'
		or p_payment_intent_id is null or p_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$'
		or p_event_id is null or p_event_id !~ '^evt_[A-Za-z0-9_]+$'
		or purchase.amount_pence is distinct from p_amount_pence or purchase.currency is distinct from p_currency
		or (purchase.stripe_checkout_session_id is not null and purchase.stripe_checkout_session_id <> p_session_id) then
		raise exception 'Payment does not match the recorded purchase.' using errcode = '22023';
	end if;
	if purchase.status = 'paid' then
		if purchase.stripe_payment_intent_id <> p_payment_intent_id then
			raise exception 'Payment does not match the recorded purchase.' using errcode = '22023';
		end if;
		return false;
	end if;
	update public.seller_ad_accounts
	set clicks_remaining = clicks_remaining + purchase.clicks, updated_at = now()
	where seller_profile_id = purchase.seller_profile_id;
	if not found then
		raise exception 'Advertising account unavailable.' using errcode = 'P0002';
	end if;
	update public.products set clicks_since_top_up = 0 where seller_profile_id = purchase.seller_profile_id;
	update public.seller_credit_purchases
	set status = 'paid', stripe_checkout_session_id = p_session_id,
		stripe_payment_intent_id = p_payment_intent_id, paid_event_id = p_event_id, paid_at = now()
	where id = p_purchase_id;
	return true;
end;
$$;

create function public.billing_expire_credit_purchase(p_purchase_id uuid, p_session_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	update public.seller_credit_purchases set status = 'expired', stripe_checkout_session_id = p_session_id
	where id = p_purchase_id and status = 'pending'
		and p_session_id ~ '^cs_test_[A-Za-z0-9_]+$'
		and (stripe_checkout_session_id is null or stripe_checkout_session_id = p_session_id);
end;
$$;

revoke all on function public.seller_create_credit_purchase(integer, uuid, integer) from public, anon;
grant execute on function public.seller_create_credit_purchase(integer, uuid, integer) to authenticated;
revoke all on function public.billing_attach_credit_checkout(uuid, text) from public, anon, authenticated;
revoke all on function public.billing_complete_credit_purchase(uuid, text, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.billing_expire_credit_purchase(uuid, text) from public, anon, authenticated;
grant execute on function public.billing_attach_credit_checkout(uuid, text) to service_role;
grant execute on function public.billing_complete_credit_purchase(uuid, text, text, integer, text, text) to service_role;
grant execute on function public.billing_expire_credit_purchase(uuid, text) to service_role;