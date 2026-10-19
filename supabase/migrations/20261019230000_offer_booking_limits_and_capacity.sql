alter table public.seller_offer_coupons drop constraint seller_offer_coupons_offer_id_visitor_id_offer_date_key;
alter table public.seller_offers add column redemption_product_id uuid;
update public.seller_offers set redemption_product_id = product_id where product_id is not null;

create function public.snapshot_seller_offer_product()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.redemption_product_id := new.product_id;
  new.terms := replace(new.terms, 'One voucher per account per offer each UK date.', case
    when new.offer_kind = 'discount' then 'Up to 3 non-cancelled reservations per account during this offer.'
    when new.offer_kind in ('free_item', 'meal') then 'One free benefit per account for this product every 7 days, including republished offers.'
    else 'One non-cancelled reservation per account each UK date.' end);
  return new;
end;
$$;
create trigger snapshot_seller_offer_product before insert on public.seller_offers
  for each row execute function public.snapshot_seller_offer_product();
revoke all on function public.snapshot_seller_offer_product() from public, anon, authenticated;
update public.seller_offers set terms = replace(terms, 'One voucher per account per offer each UK date.', case
  when offer_kind = 'discount' then 'Up to 3 non-cancelled reservations per account during this offer.'
  when offer_kind in ('free_item', 'meal') then 'One free benefit per account for this product every 7 days, including republished offers.'
  else 'One non-cancelled reservation per account each UK date.' end)
where auto_published;

create or replace function public.reserve_seller_offer_coupon_legacy(
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
    if (select count(*) from public.seller_offer_coupons where visitor_id = v_visitor_id and offer_id = p_offer_id and status <> 'cancelled') >= 3 then
      raise exception 'You have reached the 3-reservation limit for this discount offer.' using errcode = 'P0001';
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

create or replace function public.reserve_seller_offer_coupon(p_offer_id uuid, p_location_id uuid, p_offer_date date, p_starts_at time, p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  offer public.seller_offers%rowtype;
  v_visitor_id uuid := (select auth.uid());
  is_retry boolean;
begin
  if v_visitor_id is null or not public.is_supported_loyalty_visitor(v_visitor_id) then
    raise exception 'Verified visitor required.' using errcode = '42501';
  end if;
  select * into offer from public.seller_offers where id = p_offer_id for update;
  if not found or offer.fulfillment <> 'branch' then raise exception 'Voucher offer unavailable.' using errcode = '55000'; end if;
  is_retry := exists (select 1 from public.seller_offer_coupons coupon where coupon.visitor_id = v_visitor_id and coupon.idempotency_key = p_idempotency_key);
  if not is_retry then
    if offer.max_claims is not null and (select count(*) from public.seller_offer_coupons where offer_id = p_offer_id and status <> 'cancelled') >= offer.max_claims then
      raise exception 'This offer has reached its total capacity.' using errcode = '55000';
    end if;
    if offer.daily_claim_limit is not null and (select count(*) from public.seller_offer_coupons
      where offer_id = p_offer_id and offer_date = p_offer_date and status <> 'cancelled') >= offer.daily_claim_limit then
      raise exception 'This daily offer quota is full across all cities.' using errcode = '55000';
    end if;
  end if;
  insert into public.loyalty_accounts(visitor_id) values(v_visitor_id) on conflict do nothing;
  return public.reserve_seller_offer_coupon_legacy(p_offer_id, p_location_id, p_offer_date, p_starts_at, p_idempotency_key);
end;
$$;

create function public.get_my_seller_offer_booking_limits(p_offer_ids uuid[])
returns table(offer_id uuid, reservations_used bigint, next_free_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select offer.id,
    (select count(*) from public.seller_offer_coupons claim where claim.offer_id = offer.id and claim.visitor_id = (select auth.uid()) and claim.status <> 'cancelled'),
    case when offer.offer_kind in ('free_item', 'meal') then (
      select max(claim.created_at) + interval '7 days' from public.seller_offer_coupons claim
      join public.seller_offers previous_offer on previous_offer.id = claim.offer_id
      where claim.visitor_id = (select auth.uid()) and claim.status <> 'cancelled' and previous_offer.offer_kind in ('free_item', 'meal')
        and (previous_offer.id = offer.id or (offer.redemption_product_id is not null and previous_offer.redemption_product_id = offer.redemption_product_id))
    ) else null end
  from public.seller_offers offer where offer.id = any(p_offer_ids) and cardinality(p_offer_ids) <= 60
    and offer.status = 'published' and public.is_supported_loyalty_visitor((select auth.uid()));
$$;
revoke all on function public.get_my_seller_offer_booking_limits(uuid[]) from public, anon;
grant execute on function public.get_my_seller_offer_booking_limits(uuid[]) to authenticated;