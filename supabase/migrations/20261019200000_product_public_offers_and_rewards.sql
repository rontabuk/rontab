alter table public.seller_offer_requests add column product_media_path text;
alter table public.seller_offer_requests drop constraint seller_offer_requests_media_reference_check;
alter table public.seller_offer_requests add constraint seller_offer_requests_media_reference_check check (
  (media_type is null and num_nonnulls(media_url, media_storage_path, product_media_path) = 0)
  or (media_type is not null and num_nonnulls(media_url, media_storage_path, product_media_path) = 1)
);

alter table public.seller_offers
  add column product_id uuid references public.products(id) on delete set null,
  add column product_media_path text,
  add column fulfillment text not null default 'branch' check (fulfillment in ('branch', 'online')),
  add column external_url text check (external_url is null or external_url ~* '^https://'),
  add column external_code text check (external_code is null or length(external_code) <= 80),
  add column max_claims integer check (max_claims between 1 and 1000),
  add column auto_published boolean not null default false;
alter table public.seller_offers alter column approved_by drop not null;
alter table public.seller_offers add constraint seller_offers_approval_source_check check (approved_by is not null or auto_published);
alter table public.seller_offers drop constraint seller_offers_points_cost_check;
alter table public.seller_offers add constraint seller_offers_points_cost_check check (points_cost between 0 and 1000000);
alter table public.seller_offers drop constraint seller_offers_media_reference_check;
alter table public.seller_offers add constraint seller_offers_media_reference_check check (num_nonnulls(media_url, media_storage_path, product_media_path) = 1);
alter table public.seller_offers add constraint seller_offers_online_check check (
  fulfillment = 'branch' or (points_cost = 0 and external_url is not null and max_claims is null)
);
alter table public.seller_offer_coupons drop constraint seller_offer_coupons_points_cost_check;
alter table public.seller_offer_coupons add constraint seller_offer_coupons_points_cost_check check (points_cost >= 0);

create function public.skip_zero_seller_offer_transaction()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.points_delta = 0 then return null; end if;
  return new;
end;
$$;
create trigger skip_zero_seller_offer_transaction before insert on public.seller_offer_point_transactions
for each row execute function public.skip_zero_seller_offer_transaction();
revoke all on function public.skip_zero_seller_offer_transaction() from public, anon, authenticated;

create policy "Read product media used by published offers" on storage.objects for select to anon, authenticated
using (bucket_id = 'product-images' and exists (
  select 1 from public.seller_offers offer where offer.product_media_path = storage.objects.name and offer.status = 'published'
));
create policy "Preserve media for active product offers" on storage.objects as restrictive for delete to authenticated
using (bucket_id <> 'product-images' or not exists (
  select 1 from public.seller_offers offer where offer.product_media_path = storage.objects.name and offer.status in ('published', 'paused')
));

create function public.seller_get_product_offer_audience()
returns table(city_id text, eligible_count bigint, is_withheld boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.seller_profiles where user_id = (select auth.uid()) and status = 'active') then
    raise exception 'Active seller required.' using errcode = '42501';
  end if;
  return query select city.city_id, case when count(profile.id) >= 5 then count(profile.id) else null end,
    count(profile.id) < 5
  from public.supported_cities city
  join public.supported_countries country on country.country_code = city.country_code and country.is_enabled
  left join public.profiles profile on profile.city_id = city.city_id and public.is_supported_loyalty_visitor(profile.id)
  where city.country_code = 'GB' and city.is_enabled group by city.city_id;
end;
$$;

create function public.seller_publish_product_offer(p_request_id uuid, p_product_id uuid, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
<<publish_offer>>
declare
  seller public.seller_profiles%rowtype;
  product public.products%rowtype;
  media public.product_images%rowtype;
  existing_offer public.seller_offers%rowtype;
  new_offer_id uuid;
  request_location_id uuid;
  new_location_id uuid;
  offer_day date;
  audience text := p_payload ->> 'audience';
  fulfillment_kind text := p_payload ->> 'fulfillment';
  kind text := p_payload ->> 'offer_kind';
  benefit text := btrim(p_payload ->> 'benefit_details');
  city text := p_payload ->> 'city_id';
  postcode text := upper(btrim(p_payload ->> 'postcode'));
  valid_from date := (p_payload ->> 'valid_from')::date;
  valid_until date := (p_payload ->> 'valid_until')::date;
  starts_at time := (p_payload ->> 'starts_at')::time;
  ends_at time := (p_payload ->> 'ends_at')::time;
  daily_capacity integer := (p_payload ->> 'daily_capacity')::integer;
  total_capacity integer := (p_payload ->> 'max_claims')::integer;
  discount numeric := nullif(p_payload ->> 'discount_percent', '')::numeric;
  points integer;
  payload_hash text := md5(p_payload::text || p_product_id::text);
  final_terms text;
begin
  if p_request_id is null or p_product_id is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Invalid offer.' using errcode = '22023';
  end if;
  select * into seller from public.seller_profiles where user_id = (select auth.uid()) and status = 'active' for update;
  if not found then raise exception 'Active seller required.' using errcode = '42501'; end if;
  select * into existing_offer from public.seller_offers where request_id = p_request_id;
  if found then
    if existing_offer.seller_profile_id <> seller.id or existing_offer.product_id is distinct from p_product_id
      or not exists (select 1 from public.seller_offer_requests where id = p_request_id and request_payload_hash = payload_hash) then
      raise exception 'Offer key already used for another request.' using errcode = '22023';
    end if;
    return existing_offer.id;
  end if;
  select * into product from public.products where id = p_product_id and seller_profile_id = seller.id and status = 'approved' for share;
  if not found then raise exception 'Choose your approved product.' using errcode = '42501'; end if;
  select * into media from public.product_images where product_id = product.id order by sort_order, id limit 1;
  if not found then raise exception 'Product media required.' using errcode = '22023'; end if;
  if audience is null or audience not in ('general', 'reward') or fulfillment_kind is null or fulfillment_kind not in ('branch', 'online')
    or kind is null or kind not in ('discount', 'free_item', 'meal', 'other')
    or benefit is null or length(benefit) not between 3 and 1000
    or valid_from is null or valid_until is null or valid_from < timezone('Europe/London', now())::date
    or valid_until < valid_from or valid_until > valid_from + 30
    or coalesce((p_payload ->> 'accept_terms')::boolean, false) is not true then
    raise exception 'Check offer details and dates (maximum 31 days).' using errcode = '22023';
  end if;
  if not exists (select 1 from public.supported_cities c join public.supported_countries country using (country_code)
    where c.city_id = city and c.country_code = 'GB' and c.is_enabled and country.is_enabled) then
    raise exception 'Choose an enabled UK city.' using errcode = '22023';
  end if;
  if kind = 'discount' and (discount is null or discount <= 0 or discount > 100) then
    raise exception 'Enter a discount between 0 and 100 percent.' using errcode = '22023';
  end if;
  if fulfillment_kind = 'online' and (audience <> 'general' or product.external_url is null or product.external_url !~* '^https://'
    or length(coalesce(p_payload ->> 'external_code', '')) > 80) then
    raise exception 'Online offers must be free and use the product shop link.' using errcode = '22023';
  end if;
  if fulfillment_kind = 'branch' and (starts_at is null or ends_at is null or ends_at <= starts_at
    or daily_capacity is null or daily_capacity not between 1 and 1000
    or total_capacity is null or total_capacity not between 1 and 1000
    or postcode is null or postcode !~ '^(GIR 0AA|[A-PR-UWYZ]([0-9]{1,2}|[A-HK-Y][0-9]{1,2}|[0-9][A-HJKPSTUW]|[A-HK-Y][0-9][ABEHMNPRVWXY]) [0-9][ABD-HJLNP-UW-Z]{2})$') then
    raise exception 'Add branch postcode, times, and capacity from 1 to 1000.' using errcode = '22023';
  end if;
  if (select count(*) from public.seller_offers live_offer where live_offer.seller_profile_id = seller.id and live_offer.status in ('published', 'paused')
    and live_offer.valid_until >= timezone('Europe/London', now())::date) >= 10 then
    raise exception 'End an existing offer before publishing more (10 active offers maximum).' using errcode = '55000';
  end if;
  points := case when audience = 'reward' then 100 else 0 end;
  final_terms := case when fulfillment_kind = 'online' then
    'Use the offer on the seller website. No points are charged. Payment, delivery and returns are handled by the seller. RonTab cannot verify external code usage.'
    else 'One voucher per account per offer each UK date. Non-transferable. Cancel before the time window for a points refund. Unused vouchers expire without a refund. If the offer is cancelled by the seller or platform, active unused vouchers are cancelled and their points returned. Payment and fulfillment are handled by the seller.' end;
  insert into public.seller_offer_requests (id, seller_profile_id, status, offer_kind, title, description, benefit_details,
    discount_percent, product_media_path, media_type, valid_from, valid_until, capacity_acknowledged,
    seller_terms_accepted_at, submitted_at, request_payload_hash)
  values (p_request_id, seller.id, 'approved', kind, left(product.name, 120),
    case when length(btrim(coalesce(product.description, ''))) >= 10 then left(product.description, 2000) else 'Offer for ' || product.name end,
    benefit, discount, media.storage_path, media.media_type, valid_from, valid_until, true, now(), now(), payload_hash);
  insert into public.seller_offers (request_id, seller_profile_id, product_id, status, offer_kind, title, description,
    benefit_details, discount_percent, product_media_path, media_type, points_cost, terms, valid_from, valid_until,
    auto_published, approved_by, published_at, fulfillment, external_url, external_code, max_claims)
  select p_request_id, seller.id, product.id, 'published', kind, request.title, request.description,
    benefit, discount, media.storage_path, media.media_type, points, final_terms, publish_offer.valid_from, publish_offer.valid_until,
    true, null, now(), fulfillment_kind, case when fulfillment_kind = 'online' then product.external_url else null end,
    case when fulfillment_kind = 'online' then nullif(btrim(p_payload ->> 'external_code'), '') else null end,
    case when fulfillment_kind = 'branch' then total_capacity else null end
  from public.seller_offer_requests request where request.id = p_request_id
  returning id into new_offer_id;
  insert into public.seller_offer_request_locations(request_id, city_id, branch_name, branch_address)
  values(p_request_id, city, seller.shop_name, case when fulfillment_kind = 'branch' then postcode else null end)
  returning id into request_location_id;
  insert into public.seller_offer_locations(offer_id, city_id, branch_name, branch_address)
  values(new_offer_id, city, seller.shop_name, case when fulfillment_kind = 'branch' then postcode else null end)
  returning id into new_location_id;
  if fulfillment_kind = 'branch' then
    for offer_day in select generate_series(valid_from, valid_until, interval '1 day')::date loop
      insert into public.seller_offer_daily_quotas(location_id, offer_date, starts_at, ends_at, capacity)
      values(new_location_id, offer_day, starts_at, ends_at, least(daily_capacity, total_capacity));
    end loop;
  end if;
  return new_offer_id;
end;
$$;

alter function public.reserve_seller_offer_coupon(uuid, uuid, date, time, uuid) rename to reserve_seller_offer_coupon_legacy;
revoke all on function public.reserve_seller_offer_coupon_legacy(uuid, uuid, date, time, uuid) from public, anon, authenticated;
create function public.reserve_seller_offer_coupon(p_offer_id uuid, p_location_id uuid, p_offer_date date, p_starts_at time, p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  offer public.seller_offers%rowtype;
  v_visitor_id uuid := (select auth.uid());
begin
  if v_visitor_id is null or not public.is_supported_loyalty_visitor(v_visitor_id) then
    raise exception 'Verified visitor required.' using errcode = '42501';
  end if;
  select * into offer from public.seller_offers where id = p_offer_id for update;
  if not found or offer.fulfillment <> 'branch' then raise exception 'Voucher offer unavailable.' using errcode = '55000'; end if;
  if offer.max_claims is not null and not exists (
    select 1 from public.seller_offer_coupons coupon where coupon.visitor_id = v_visitor_id
      and (coupon.idempotency_key = p_idempotency_key or (coupon.offer_id = p_offer_id and coupon.offer_date = p_offer_date and coupon.status = 'reserved'))
  ) and (select count(*) from public.seller_offer_coupons where offer_id = p_offer_id and status <> 'cancelled') >= offer.max_claims then
    raise exception 'This offer has reached its total capacity.' using errcode = '55000';
  end if;
  insert into public.loyalty_accounts(visitor_id) values(v_visitor_id) on conflict do nothing;
  return public.reserve_seller_offer_coupon_legacy(p_offer_id, p_location_id, p_offer_date, p_starts_at, p_idempotency_key);
end;
$$;

create or replace function public.prevent_ending_seller_offer_with_reserved_coupons()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  candidate record;
  coupon public.seller_offer_coupons%rowtype;
begin
  for candidate in select id, visitor_id, location_id, offer_date, starts_at from public.seller_offer_coupons
    where offer_id = old.id and status = 'reserved' and now() < ((offer_date + ends_at) at time zone 'Europe/London')
    order by visitor_id, id loop
    perform 1 from public.loyalty_accounts where visitor_id = candidate.visitor_id for update;
    perform 1 from public.seller_offer_daily_quotas where location_id = candidate.location_id
      and offer_date = candidate.offer_date and starts_at = candidate.starts_at for update;
    select * into coupon from public.seller_offer_coupons where id = candidate.id for update;
    if coupon.status <> 'reserved' then continue; end if;
    update public.seller_offer_coupons set status = 'cancelled', cancelled_at = now() where id = coupon.id;
    update public.seller_offer_daily_quotas set reserved_count = reserved_count - 1
      where location_id = coupon.location_id and offer_date = coupon.offer_date and starts_at = coupon.starts_at;
    update public.loyalty_accounts set points_balance = points_balance + coupon.points_cost, updated_at = now()
      where visitor_id = coupon.visitor_id;
    insert into public.seller_offer_point_transactions(visitor_id, coupon_id, points_delta, transaction_type, idempotency_key)
      values(coupon.visitor_id, coupon.id, coupon.points_cost, 'refund', 'coupon:' || coupon.id::text || ':refund');
  end loop;
  return new;
end;
$$;

create function public.seller_cancel_product_offer(p_offer_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.seller_offers offer set status = 'ended'
  where offer.id = p_offer_id and offer.status in ('published', 'paused')
    and exists(select 1 from public.seller_profiles seller where seller.id = offer.seller_profile_id and seller.user_id = (select auth.uid()));
  if not found and not exists(select 1 from public.seller_offers offer join public.seller_profiles seller on seller.id = offer.seller_profile_id
    where offer.id = p_offer_id and offer.status = 'ended' and seller.user_id = (select auth.uid())) then
    raise exception 'Offer not found.' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.seller_get_product_offer_audience() from public, anon;
revoke all on function public.seller_publish_product_offer(uuid, uuid, jsonb) from public, anon;
revoke all on function public.reserve_seller_offer_coupon(uuid, uuid, date, time, uuid) from public, anon;
revoke all on function public.seller_cancel_product_offer(uuid) from public, anon;
grant execute on function public.seller_get_product_offer_audience() to authenticated;
grant execute on function public.seller_publish_product_offer(uuid, uuid, jsonb) to authenticated;
grant execute on function public.reserve_seller_offer_coupon(uuid, uuid, date, time, uuid) to authenticated;
grant execute on function public.seller_cancel_product_offer(uuid) to authenticated;

create function public.get_public_seller_offer_availability(p_offer_ids uuid[])
returns table(offer_id uuid, remaining_claims bigint)
language sql stable security definer set search_path = '' as $$
  select offer.id, greatest(0, offer.max_claims - count(coupon.id))
  from public.seller_offers offer left join public.seller_offer_coupons coupon
    on coupon.offer_id = offer.id and coupon.status <> 'cancelled'
  where offer.id = any(p_offer_ids) and offer.status = 'published' and offer.max_claims is not null
  group by offer.id;
$$;
revoke all on function public.get_public_seller_offer_availability(uuid[]) from public;
grant execute on function public.get_public_seller_offer_availability(uuid[]) to anon, authenticated;

create function public.seller_inspect_offer_coupon(p_coupon_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
begin
  if p_coupon_code is null or p_coupon_code !~ '^[A-Fa-f0-9]{20}$' then
    raise exception 'Enter the 20-character voucher code.' using errcode = '22023';
  end if;
  select jsonb_build_object(
    'code', coupon.coupon_code, 'title', offer.title, 'benefit', offer.benefit_details,
    'branch', location.branch_name, 'postcode', location.branch_address,
    'date', coupon.offer_date, 'startsAt', coupon.starts_at, 'endsAt', coupon.ends_at,
    'status', case when coupon.status = 'reserved' and now() >= ((coupon.offer_date + coupon.ends_at) at time zone 'Europe/London') then 'expired' else coupon.status end,
    'canRedeem', coupon.status = 'reserved' and offer.status in ('published', 'paused')
      and now() >= ((coupon.offer_date + coupon.starts_at) at time zone 'Europe/London')
      and now() < ((coupon.offer_date + coupon.ends_at) at time zone 'Europe/London')
  ) into result
  from public.seller_offer_coupons coupon join public.seller_offers offer on offer.id = coupon.offer_id
    join public.seller_profiles seller on seller.id = offer.seller_profile_id
    join public.seller_offer_locations location on location.id = coupon.location_id
  where coupon.coupon_code = upper(p_coupon_code) and seller.user_id = (select auth.uid()) and seller.status = 'active';
  if result is null then raise exception 'Voucher not found for your shop.' using errcode = 'P0002'; end if;
  return result;
end;
$$;
revoke all on function public.seller_inspect_offer_coupon(text) from public, anon;
grant execute on function public.seller_inspect_offer_coupon(text) to authenticated;