alter table public.seller_offers add column target_all_uk boolean not null default false;

create table public.seller_offer_settings (
  singleton boolean primary key default true check (singleton),
  default_reward_points integer not null default 100 check (default_reward_points between 50 and 1000000)
);
insert into public.seller_offer_settings default values;
alter table public.seller_offer_settings enable row level security;
revoke all on public.seller_offer_settings from anon, authenticated;
grant select on public.seller_offer_settings to authenticated;
create policy "Read seller offer point settings" on public.seller_offer_settings for select to authenticated using (true);

create function public.admin_set_seller_reward_points(p_points_cost integer, p_offer_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  previous_points integer;
begin
  if not (select public.is_admin()) then raise exception 'Administrator access required.' using errcode = '42501'; end if;
  if p_points_cost is null or p_points_cost not between 50 and 1000000 then
    raise exception 'Reward points must be a whole number from 50 to 1,000,000.' using errcode = '22023';
  end if;
  if p_offer_id is null then
    select default_reward_points into previous_points from public.seller_offer_settings where singleton for update;
    update public.seller_offer_settings set default_reward_points = p_points_cost where singleton;
  else
    select points_cost into previous_points from public.seller_offers
      where id = p_offer_id and points_cost > 0 and fulfillment = 'branch' and status <> 'ended' for update;
    if not found then raise exception 'Choose an active points reward.' using errcode = '22023'; end if;
    update public.seller_offers set points_cost = p_points_cost where id = p_offer_id;
  end if;
  insert into public.admin_audit_logs(actor_id, action, entity_type, entity_id, details)
    values((select auth.uid()), 'seller_reward_points_changed', case when p_offer_id is null then 'seller_offer_settings' else 'seller_offer' end,
      p_offer_id, jsonb_build_object('previous_points', previous_points, 'points_cost', p_points_cost));
end;
$$;

alter function public.seller_publish_product_offer(uuid, uuid, jsonb) rename to seller_publish_product_offer_initial;
revoke all on function public.seller_publish_product_offer_initial(uuid, uuid, jsonb) from public, anon, authenticated;
create function public.seller_publish_product_offer(p_request_id uuid, p_product_id uuid, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  was_published boolean;
  published_offer_id uuid;
begin
  perform 1 from public.seller_profiles where user_id = (select auth.uid()) and status = 'active' for update;
  select exists(select 1 from public.seller_offers where request_id = p_request_id) into was_published;
  published_offer_id := public.seller_publish_product_offer_initial(p_request_id, p_product_id, p_payload);
  if not was_published and p_payload ->> 'audience' = 'reward' then
    update public.seller_offers set points_cost = (select default_reward_points from public.seller_offer_settings where singleton)
      where id = published_offer_id;
  end if;
  return published_offer_id;
end;
$$;

alter function public.seller_publish_product_offer_in_cities(uuid, uuid, jsonb, text[]) rename to seller_publish_product_offer_selected_cities;
revoke all on function public.seller_publish_product_offer_selected_cities(uuid, uuid, jsonb, text[]) from public, anon, authenticated;
create function public.seller_publish_product_offer_in_cities(p_request_id uuid, p_product_id uuid, p_payload jsonb, p_city_ids text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  primary_city text;
  published_offer_id uuid;
begin
  if p_city_ids is null or cardinality(p_city_ids) > 10 or array_position(p_city_ids, null) is not null then
    raise exception 'Choose up to 10 UK cities, or no cities for All UK.' using errcode = '22023';
  end if;
  if cardinality(p_city_ids) = 0 then
    select location.city_id into primary_city from public.seller_offer_locations location
      join public.seller_offers offer on offer.id = location.offer_id
      join public.seller_profiles seller on seller.id = offer.seller_profile_id
      where offer.request_id = p_request_id and seller.user_id = (select auth.uid()) limit 1;
    if primary_city is null then
    select city.city_id into primary_city from public.supported_cities city
      join public.supported_countries country using(country_code)
      where city.country_code = 'GB' and city.is_enabled and country.is_enabled
      order by (city.city_id = (select shop_city_id from public.seller_profiles where user_id = (select auth.uid()))) desc nulls last, city.city_id limit 1;
    end if;
    if primary_city is null then raise exception 'No supported UK city is available.' using errcode = '22023'; end if;
    published_offer_id := public.seller_publish_product_offer_selected_cities(p_request_id, p_product_id,
      p_payload || '{"target_all_uk":true}'::jsonb, array[primary_city]);
    update public.seller_offers set target_all_uk = true where id = published_offer_id;
  else
    published_offer_id := public.seller_publish_product_offer_selected_cities(p_request_id, p_product_id,
      p_payload || '{"target_all_uk":false}'::jsonb, p_city_ids);
  end if;
  return published_offer_id;
end;
$$;

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
  window_end timestamptz;
  coupon_code text;
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
  if not found or p_offer_date < offer.valid_from or p_offer_date > offer.valid_until then
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
  window_end := (quota.offer_date + quota.ends_at) at time zone 'Europe/London';
  if now() >= window_end then raise exception 'This offer time has ended.' using errcode = '55000'; end if;
  select account.points_balance into v_points_balance from public.loyalty_accounts account where account.visitor_id = v_visitor_id for update;
  if v_points_balance is null or v_points_balance < offer.points_cost then
    raise exception 'There are not enough points for this offer.' using errcode = '23514';
  end if;
  select * into quota from public.seller_offer_daily_quotas daily_quota
    where daily_quota.location_id = p_location_id and daily_quota.offer_date = p_offer_date and daily_quota.starts_at = p_starts_at for update;
  if not found or quota.reserved_count >= quota.capacity then raise exception 'This daily offer quota is full.' using errcode = '55000'; end if;
  select * into prior_coupon from public.seller_offer_coupons
    where seller_offer_coupons.offer_id = p_offer_id and seller_offer_coupons.visitor_id = v_visitor_id and seller_offer_coupons.offer_date = p_offer_date;
  if found then
    if prior_coupon.status = 'reserved' then
      return jsonb_build_object('id', prior_coupon.id, 'code', prior_coupon.coupon_code, 'status', prior_coupon.status, 'alreadyReserved', true);
    end if;
    raise exception 'Only one reservation attempt is allowed for this offer each day.' using errcode = '55000';
  end if;
  coupon_code := upper(substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 20));
  update public.seller_offer_daily_quotas set reserved_count = reserved_count + 1
    where location_id = p_location_id and offer_date = p_offer_date and starts_at = p_starts_at;
  update public.loyalty_accounts set points_balance = v_points_balance - offer.points_cost, updated_at = now() where loyalty_accounts.visitor_id = v_visitor_id;
  insert into public.seller_offer_coupons(offer_id, location_id, visitor_id, offer_date, starts_at, ends_at, points_cost, coupon_code, idempotency_key)
    values(offer.id, p_location_id, v_visitor_id, p_offer_date, p_starts_at, quota.ends_at, offer.points_cost, coupon_code, p_idempotency_key) returning * into coupon;
  insert into public.seller_offer_point_transactions(visitor_id, coupon_id, points_delta, transaction_type, idempotency_key)
    values(v_visitor_id, coupon.id, -offer.points_cost, 'spent', 'coupon:' || coupon.id::text || ':spent');
  return jsonb_build_object('id', coupon.id, 'code', coupon.coupon_code, 'status', coupon.status, 'alreadyReserved', false);
end;
$$;

alter function public.admin_decide_seller_offer_request(uuid, text, text, integer, text, jsonb) rename to admin_decide_seller_offer_request_initial;
revoke all on function public.admin_decide_seller_offer_request_initial(uuid, text, text, integer, text, jsonb) from public, anon, authenticated;
create function public.admin_decide_seller_offer_request(p_request_id uuid, p_decision text, p_review_note text, p_points_cost integer, p_final_terms text, p_schedule_capacities jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_admin()) then raise exception 'Administrator access required.' using errcode = '42501'; end if;
  if p_decision = 'approve' and (p_points_cost is null or p_points_cost not between 50 and 1000000) then
    raise exception 'Reward points must be a whole number from 50 to 1,000,000.' using errcode = '22023';
  end if;
  return public.admin_decide_seller_offer_request_initial(p_request_id, p_decision, p_review_note, p_points_cost, p_final_terms, p_schedule_capacities);
end;
$$;
revoke all on function public.admin_decide_seller_offer_request(uuid, text, text, integer, text, jsonb) from public, anon;
grant execute on function public.admin_decide_seller_offer_request(uuid, text, text, integer, text, jsonb) to authenticated;
revoke all on function public.admin_set_seller_reward_points(integer, uuid) from public, anon;
grant execute on function public.admin_set_seller_reward_points(integer, uuid) to authenticated;
revoke all on function public.seller_publish_product_offer(uuid, uuid, jsonb) from public, anon;
grant execute on function public.seller_publish_product_offer(uuid, uuid, jsonb) to authenticated;
revoke all on function public.seller_publish_product_offer_in_cities(uuid, uuid, jsonb, text[]) from public, anon;
grant execute on function public.seller_publish_product_offer_in_cities(uuid, uuid, jsonb, text[]) to authenticated;

create or replace function public.reserve_seller_offer_coupon_at_cost(
  p_offer_id uuid, p_location_id uuid, p_offer_date date, p_starts_at time, p_idempotency_key uuid, p_expected_points_cost integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  current_points integer;
begin
  if not public.is_supported_loyalty_visitor((select auth.uid())) then
    raise exception 'Verified visitor required.' using errcode = '42501';
  end if;
  select points_cost into current_points from public.seller_offers where id = p_offer_id for update;
  if not found then raise exception 'Offer unavailable.' using errcode = '55000'; end if;
  if (p_expected_points_cost is null or current_points <> p_expected_points_cost) and not exists (
    select 1 from public.seller_offer_coupons where visitor_id = (select auth.uid()) and idempotency_key = p_idempotency_key
  ) then
    raise exception 'The point cost has changed. Refresh the offer before confirming again.' using errcode = 'P0001';
  end if;
  return public.reserve_seller_offer_coupon(p_offer_id, p_location_id, p_offer_date, p_starts_at, p_idempotency_key);
end;
$$;
revoke all on function public.reserve_seller_offer_coupon_at_cost(uuid, uuid, date, time, uuid, integer) from public, anon;
grant execute on function public.reserve_seller_offer_coupon_at_cost(uuid, uuid, date, time, uuid, integer) to authenticated;