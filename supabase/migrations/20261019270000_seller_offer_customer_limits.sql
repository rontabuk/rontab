alter table public.seller_offers
  add column max_per_customer integer not null default 3
  check (max_per_customer between 1 and 1000);

create or replace function public.snapshot_seller_offer_product()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.redemption_product_id := new.product_id;
  new.terms := replace(new.terms, 'One voucher per account per offer each UK date.', case
    when new.offer_kind = 'discount' then pg_catalog.format('Up to %s non-cancelled reservations per account during this offer.', new.max_per_customer)
    when new.offer_kind in ('free_item', 'meal') then 'One free benefit per account for this product every 7 days, including republished offers.'
    else 'One non-cancelled reservation per account each UK date.' end);
  return new;
end;
$$;
revoke all on function public.snapshot_seller_offer_product() from public, anon, authenticated;

alter function public.seller_publish_product_offer(uuid, uuid, jsonb)
  rename to seller_publish_product_offer_before_customer_limit;
revoke all on function public.seller_publish_product_offer_before_customer_limit(uuid, uuid, jsonb) from public, anon, authenticated;

create function public.seller_publish_product_offer(p_request_id uuid, p_product_id uuid, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  was_published boolean;
  published_offer_id uuid;
  requested_limit integer;
  total_limit integer;
  offer_kind text := p_payload ->> 'offer_kind';
  fulfillment_kind text := p_payload ->> 'fulfillment';
begin
  select exists(select 1 from public.seller_offers where request_id = p_request_id) into was_published;
  published_offer_id := public.seller_publish_product_offer_before_customer_limit(p_request_id, p_product_id, p_payload);

  if not was_published then
    if offer_kind = 'discount' and fulfillment_kind = 'branch' then
      begin
        requested_limit := (p_payload ->> 'max_per_customer')::integer;
      exception when others then
        raise exception 'Set a valid per-customer discount limit.' using errcode = '22023';
      end;
      select max_claims into total_limit from public.seller_offers where id = published_offer_id;
      if requested_limit is null or requested_limit not between 1 and 1000 or requested_limit > total_limit then
        raise exception 'The per-customer discount limit must be between 1 and the total voucher count.' using errcode = '22023';
      end if;
      update public.seller_offers offer
      set max_per_customer = requested_limit,
          terms = replace(offer.terms, 'Up to 3 non-cancelled reservations per account during this offer.',
            pg_catalog.format('Up to %s non-cancelled reservations per account during this offer.', requested_limit))
      where offer.id = published_offer_id;
    elsif offer_kind <> 'discount' then
      update public.seller_offers set max_per_customer = 1 where id = published_offer_id;
    end if;
  end if;

  return published_offer_id;
end;
$$;

revoke all on function public.seller_publish_product_offer(uuid, uuid, jsonb) from public, anon;
grant execute on function public.seller_publish_product_offer(uuid, uuid, jsonb) to authenticated;

alter function public.reserve_seller_offer_coupon_legacy(uuid, uuid, date, time, uuid)
  rename to reserve_seller_offer_coupon_legacy_before_customer_limit;
revoke all on function public.reserve_seller_offer_coupon_legacy_before_customer_limit(uuid, uuid, date, time, uuid) from public, anon, authenticated;

create function public.reserve_seller_offer_coupon_legacy(
  p_offer_id uuid, p_location_id uuid, p_offer_date date, p_starts_at time, p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_visitor_id uuid := (select auth.uid());
  offer public.seller_offers%rowtype;
  quota public.seller_offer_daily_quotas%rowtype;
  prior_coupon public.seller_offer_coupons%rowtype;
  coupon public.seller_offer_coupons%rowtype;
  visitor_city_id text;
  v_points_balance bigint;
  last_free_claim timestamptz;
begin
  if v_visitor_id is null or not public.is_supported_loyalty_visitor(v_visitor_id) then
    raise exception 'An eligible, verified visitor account is required.' using errcode = '42501';
  end if;
  if p_offer_id is null or p_location_id is null or p_offer_date is null or p_starts_at is null or p_idempotency_key is null then
    raise exception 'Choose an available offer time.' using errcode = '22023';
  end if;
  select * into prior_coupon from public.seller_offer_coupons
    where seller_offer_coupons.visitor_id = v_visitor_id and seller_offer_coupons.idempotency_key = p_idempotency_key;
  if found then
    if prior_coupon.offer_id <> p_offer_id or prior_coupon.location_id <> p_location_id
      or prior_coupon.offer_date <> p_offer_date or prior_coupon.starts_at <> p_starts_at then
      raise exception 'This reservation key was already used for a different offer.' using errcode = '22023';
    end if;
    return jsonb_build_object('id', prior_coupon.id, 'code', prior_coupon.coupon_code, 'status', prior_coupon.status, 'alreadyReserved', true);
  end if;
  select * into offer from public.seller_offers seller_offer
    where seller_offer.id = p_offer_id and seller_offer.status = 'published' for share;
  if not found or p_offer_date < offer.valid_from or p_offer_date > offer.valid_until
    or timezone('Europe/London', now())::date > offer.valid_until then
    raise exception 'This offer is not available for that date.' using errcode = '55000';
  end if;
  select profile.city_id into visitor_city_id from public.profiles profile where profile.id = v_visitor_id;
  if not exists (select 1 from public.seller_offer_locations location
    where location.id = p_location_id and location.offer_id = offer.id
      and (location.city_id = visitor_city_id or (offer.target_all_uk and exists (
        select 1 from public.supported_cities city join public.supported_countries country using(country_code)
        where city.city_id = visitor_city_id and city.country_code = 'GB' and city.is_enabled and country.is_enabled
      )))) then
    raise exception 'This offer is not available for your saved city.' using errcode = '42501';
  end if;
  select * into quota from public.seller_offer_daily_quotas daily_quota
    where daily_quota.location_id = p_location_id and daily_quota.offer_date = p_offer_date and daily_quota.starts_at = p_starts_at;
  if not found then raise exception 'This offer time is no longer available.' using errcode = '55000'; end if;
  if now() >= ((quota.offer_date + quota.ends_at) at time zone 'Europe/London') then
    raise exception 'This offer time has ended.' using errcode = '55000';
  end if;
  select account.points_balance into v_points_balance from public.loyalty_accounts account where account.visitor_id = v_visitor_id for update;
  if v_points_balance is null or v_points_balance < offer.points_cost then
    raise exception 'There are not enough points for this offer.' using errcode = '23514';
  end if;
  if offer.offer_kind = 'discount' then
    if (select count(*) from public.seller_offer_coupons where visitor_id = v_visitor_id and offer_id = p_offer_id and status <> 'cancelled') >= offer.max_per_customer then
      raise exception 'You have reached the per-customer reservation limit for this discount offer.' using errcode = 'P0001';
    end if;
  elsif offer.offer_kind in ('free_item', 'meal') then
    select max(claim.created_at) into last_free_claim from public.seller_offer_coupons claim
      join public.seller_offers previous_offer on previous_offer.id = claim.offer_id
      where claim.visitor_id = v_visitor_id and claim.status <> 'cancelled' and previous_offer.offer_kind in ('free_item', 'meal')
        and (previous_offer.id = offer.id or (offer.redemption_product_id is not null and previous_offer.redemption_product_id = offer.redemption_product_id));
    if last_free_claim > now() - interval '7 days' then
      raise exception 'A free benefit for this product is available once every 7 days.' using errcode = 'P0001';
    end if;
  elsif exists (select 1 from public.seller_offer_coupons where visitor_id = v_visitor_id and offer_id = p_offer_id
    and offer_date = p_offer_date and status <> 'cancelled') then
    raise exception 'Only one reservation for this offer is allowed each day.' using errcode = 'P0001';
  end if;
  select * into quota from public.seller_offer_daily_quotas daily_quota
    where daily_quota.location_id = p_location_id and daily_quota.offer_date = p_offer_date and daily_quota.starts_at = p_starts_at for update;
  if not found or quota.reserved_count >= quota.capacity then raise exception 'This daily offer quota is full.' using errcode = '55000'; end if;
  update public.seller_offer_daily_quotas set reserved_count = reserved_count + 1
    where location_id = p_location_id and offer_date = p_offer_date and starts_at = p_starts_at;
  update public.loyalty_accounts set points_balance = v_points_balance - offer.points_cost, updated_at = now() where loyalty_accounts.visitor_id = v_visitor_id;
  insert into public.seller_offer_coupons(offer_id, location_id, visitor_id, offer_date, starts_at, ends_at, points_cost, coupon_code, idempotency_key)
    values(offer.id, p_location_id, v_visitor_id, p_offer_date, p_starts_at, quota.ends_at, offer.points_cost,
      upper(substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 20)), p_idempotency_key) returning * into coupon;
  insert into public.seller_offer_point_transactions(visitor_id, coupon_id, points_delta, transaction_type, idempotency_key)
    values(v_visitor_id, coupon.id, -offer.points_cost, 'spent', 'coupon:' || coupon.id::text || ':spent');
  return jsonb_build_object('id', coupon.id, 'code', coupon.coupon_code, 'status', coupon.status, 'alreadyReserved', false);
end;
$$;

revoke all on function public.reserve_seller_offer_coupon_legacy(uuid, uuid, date, time, uuid) from public, anon, authenticated;

create or replace function public.get_public_seller_offer_daily_availability(p_offer_ids uuid[])
returns table(offer_id uuid, offer_date date, remaining_claims bigint)
language sql stable security definer set search_path = '' as $$
  with offer_dates as (
    select distinct offer.id, offer.daily_claim_limit, offer.max_claims, quota.offer_date
    from public.seller_offers offer
    join public.seller_offer_locations location on location.offer_id = offer.id
    join public.seller_offer_daily_quotas quota on quota.location_id = location.id
    where offer.id = any(p_offer_ids) and cardinality(p_offer_ids) <= 60 and offer.status = 'published'
      and offer.daily_claim_limit is not null and quota.offer_date >= timezone('Europe/London', now())::date
  )
  select available.id, available.offer_date,
    greatest(0, least(available.daily_claim_limit - count(coupon.id),
      coalesce(available.max_claims, available.daily_claim_limit) - (
        select count(*) from public.seller_offer_coupons total_coupon
        where total_coupon.offer_id = available.id and total_coupon.status <> 'cancelled'
      )))
  from offer_dates available left join public.seller_offer_coupons coupon
    on coupon.offer_id = available.id and coupon.offer_date = available.offer_date and coupon.status <> 'cancelled'
  group by available.id, available.offer_date, available.daily_claim_limit, available.max_claims;
$$;

revoke all on function public.get_public_seller_offer_daily_availability(uuid[]) from public;
grant execute on function public.get_public_seller_offer_daily_availability(uuid[]) to anon, authenticated;