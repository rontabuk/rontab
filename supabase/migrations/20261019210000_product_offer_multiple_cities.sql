alter table public.seller_offers
  add column daily_claim_limit integer check (daily_claim_limit between 1 and 1000);

create function public.seller_publish_product_offer_in_cities(
  p_request_id uuid, p_product_id uuid, p_payload jsonb, p_city_ids text[]
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  selected_cities text[];
  selected_city text;
  published_offer_id uuid;
  primary_location public.seller_offer_locations%rowtype;
  new_location_id uuid;
begin
  if p_city_ids is null or cardinality(p_city_ids) not between 1 and 10
    or array_position(p_city_ids, null) is not null then
    raise exception 'Choose between 1 and 10 supported UK cities.' using errcode = '22023';
  end if;
  select array_agg(distinct city_id order by city_id) into selected_cities from unnest(p_city_ids) as cities(city_id);
  if exists (select 1 from unnest(selected_cities) as selected(city_id) where not exists (
    select 1 from public.supported_cities city join public.supported_countries country using (country_code)
    where city.city_id = selected.city_id and city.country_code = 'GB' and city.is_enabled and country.is_enabled
  )) then
    raise exception 'Choose enabled UK cities.' using errcode = '22023';
  end if;
  published_offer_id := public.seller_publish_product_offer(p_request_id, p_product_id,
    p_payload || jsonb_build_object('city_id', selected_cities[1], 'city_ids', to_jsonb(selected_cities)));
  select * into primary_location from public.seller_offer_locations
    where offer_id = published_offer_id and city_id = selected_cities[1];
  update public.seller_offers set daily_claim_limit = case when fulfillment = 'branch'
    then (p_payload ->> 'daily_capacity')::integer else null end where id = published_offer_id;
  foreach selected_city in array selected_cities loop
    if exists (select 1 from public.seller_offer_locations where offer_id = published_offer_id and city_id = selected_city) then
      continue;
    end if;
    insert into public.seller_offer_request_locations(request_id, city_id, branch_name, branch_address)
      values(p_request_id, selected_city, primary_location.branch_name, primary_location.branch_address);
    insert into public.seller_offer_locations(offer_id, city_id, branch_name, branch_address)
      values(published_offer_id, selected_city, primary_location.branch_name, primary_location.branch_address)
      returning id into new_location_id;
    insert into public.seller_offer_daily_quotas(location_id, offer_date, starts_at, ends_at, capacity)
      select new_location_id, offer_date, starts_at, ends_at, capacity from public.seller_offer_daily_quotas
      where location_id = primary_location.id;
  end loop;
  return published_offer_id;
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
  is_retry := exists (select 1 from public.seller_offer_coupons coupon where coupon.visitor_id = v_visitor_id
    and (coupon.idempotency_key = p_idempotency_key or (coupon.offer_id = p_offer_id and coupon.offer_date = p_offer_date and coupon.status = 'reserved')));
  if not is_retry then
    if offer.max_claims is not null and (select count(*) from public.seller_offer_coupons
      where offer_id = p_offer_id and status <> 'cancelled') >= offer.max_claims then
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

create function public.get_public_seller_offer_daily_availability(p_offer_ids uuid[])
returns table(offer_id uuid, offer_date date, remaining_claims bigint)
language sql stable security definer set search_path = '' as $$
  with offer_dates as (
    select distinct offer.id, offer.daily_claim_limit, quota.offer_date
    from public.seller_offers offer
    join public.seller_offer_locations location on location.offer_id = offer.id
    join public.seller_offer_daily_quotas quota on quota.location_id = location.id
    where offer.id = any(p_offer_ids) and cardinality(p_offer_ids) <= 60 and offer.status = 'published'
      and offer.daily_claim_limit is not null and quota.offer_date >= timezone('Europe/London', now())::date
  )
  select available.id, available.offer_date, greatest(0, available.daily_claim_limit - count(coupon.id))
  from offer_dates available left join public.seller_offer_coupons coupon
    on coupon.offer_id = available.id and coupon.offer_date = available.offer_date and coupon.status <> 'cancelled'
  group by available.id, available.offer_date, available.daily_claim_limit;
$$;

revoke all on function public.seller_publish_product_offer_in_cities(uuid, uuid, jsonb, text[]) from public, anon;
grant execute on function public.seller_publish_product_offer_in_cities(uuid, uuid, jsonb, text[]) to authenticated;
revoke all on function public.get_public_seller_offer_daily_availability(uuid[]) from public;
grant execute on function public.get_public_seller_offer_daily_availability(uuid[]) to anon, authenticated;