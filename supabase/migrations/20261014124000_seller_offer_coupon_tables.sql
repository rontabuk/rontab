alter table public.seller_offer_locations
	add constraint seller_offer_locations_id_offer_unique unique (id, offer_id);

create table public.seller_offer_coupons (
	id uuid primary key default gen_random_uuid(),
	offer_id uuid not null references public.seller_offers (id) on delete restrict,
	location_id uuid not null,
	visitor_id uuid not null references auth.users (id) on delete restrict,
	offer_date date not null,
	starts_at time not null,
	ends_at time not null,
	points_cost integer not null check (points_cost > 0),
	coupon_code text not null unique check (coupon_code ~ '^[A-F0-9]{20}$'),
	idempotency_key uuid not null,
	status text not null default 'reserved' check (status in ('reserved', 'redeemed', 'cancelled', 'expired')),
	created_at timestamptz not null default now(),
	redeemed_at timestamptz,
	cancelled_at timestamptz,
	expired_at timestamptz,
	unique (offer_id, visitor_id, offer_date),
	unique (visitor_id, idempotency_key),
	foreign key (location_id, offer_id) references public.seller_offer_locations (id, offer_id) on delete restrict,
	foreign key (location_id, offer_date, starts_at) references public.seller_offer_daily_quotas (location_id, offer_date, starts_at) on delete restrict,
	check (ends_at > starts_at),
	check (
		(status = 'reserved' and redeemed_at is null and cancelled_at is null and expired_at is null)
		or (status = 'redeemed' and redeemed_at is not null and cancelled_at is null and expired_at is null)
		or (status = 'cancelled' and redeemed_at is null and cancelled_at is not null and expired_at is null)
		or (status = 'expired' and redeemed_at is null and cancelled_at is null and expired_at is not null)
	)
);

create index seller_offer_coupons_visitor_created_idx
	on public.seller_offer_coupons (visitor_id, created_at desc);
create index seller_offer_coupons_offer_window_idx
	on public.seller_offer_coupons (offer_id, offer_date, status);

create table public.seller_offer_point_transactions (
	id bigint generated always as identity primary key,
	visitor_id uuid not null references auth.users (id) on delete restrict,
	coupon_id uuid not null references public.seller_offer_coupons (id) on delete restrict,
	points_delta integer not null,
	transaction_type text not null check (transaction_type in ('spent', 'refund')),
	idempotency_key text not null,
	created_at timestamptz not null default now(),
	unique (visitor_id, idempotency_key),
	unique (coupon_id, transaction_type),
	check ((transaction_type = 'spent' and points_delta < 0) or (transaction_type = 'refund' and points_delta > 0))
);

create index seller_offer_point_transactions_visitor_created_idx
	on public.seller_offer_point_transactions (visitor_id, created_at desc);

alter table public.seller_offer_coupons enable row level security;
alter table public.seller_offer_point_transactions enable row level security;

revoke all on public.seller_offer_coupons, public.seller_offer_point_transactions from public, anon, authenticated;
grant select on public.seller_offer_coupons, public.seller_offer_point_transactions to authenticated;
grant select on public.seller_offer_daily_quotas to anon, authenticated;

create policy "Visitors read their own seller offer coupons"
	on public.seller_offer_coupons for select to authenticated
	using (visitor_id = (select auth.uid()) or (select public.is_admin()));

create policy "Visitors read their own seller offer point transactions"
	on public.seller_offer_point_transactions for select to authenticated
	using (visitor_id = (select auth.uid()) or (select public.is_admin()));

create policy "Visitors see capacity for published seller offers"
	on public.seller_offer_daily_quotas for select to anon, authenticated
	using (
		offer_date >= timezone('Europe/London', now())::date
		and exists (
			select 1 from public.seller_offer_locations location
			join public.seller_offers offer on offer.id = location.offer_id
			where location.id = location_id and offer.status = 'published'
		)
	);