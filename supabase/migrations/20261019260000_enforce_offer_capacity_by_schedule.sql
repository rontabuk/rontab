alter function public.seller_publish_product_offer(uuid, uuid, jsonb)
  rename to seller_publish_product_offer_before_capacity_limit;
revoke all on function public.seller_publish_product_offer_before_capacity_limit(uuid, uuid, jsonb) from public, anon, authenticated;

create function public.seller_publish_product_offer(p_request_id uuid, p_product_id uuid, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  was_published boolean;
  published_offer_id uuid;
  requested_fulfillment text := p_payload ->> 'fulfillment';
begin
  select exists(select 1 from public.seller_offers where request_id = p_request_id) into was_published;
  published_offer_id := public.seller_publish_product_offer_before_capacity_limit(p_request_id, p_product_id, p_payload);

  if not was_published and requested_fulfillment = 'branch'
    and (p_payload ->> 'max_claims')::integer > least(
      (p_payload ->> 'daily_capacity')::integer
        * ((p_payload ->> 'valid_until')::date - (p_payload ->> 'valid_from')::date + 1),
      1000
    ) then
    raise exception 'Total vouchers cannot exceed daily vouchers multiplied by the inclusive offer dates.' using errcode = '22023';
  end if;

  return published_offer_id;
end;
$$;

revoke all on function public.seller_publish_product_offer(uuid, uuid, jsonb) from public, anon;
grant execute on function public.seller_publish_product_offer(uuid, uuid, jsonb) to authenticated;

alter function public.seller_publish_product_offer_in_cities(uuid, uuid, jsonb, text[])
  rename to seller_publish_product_offer_in_cities_before_capacity_limit;
revoke all on function public.seller_publish_product_offer_in_cities_before_capacity_limit(uuid, uuid, jsonb, text[]) from public, anon, authenticated;

create function public.seller_publish_product_offer_in_cities(
  p_request_id uuid, p_product_id uuid, p_payload jsonb, p_city_ids text[]
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  was_published boolean;
  published_offer_id uuid;
  requested_fulfillment text := p_payload ->> 'fulfillment';
begin
  select exists(select 1 from public.seller_offers where request_id = p_request_id) into was_published;
  published_offer_id := public.seller_publish_product_offer_in_cities_before_capacity_limit(
    p_request_id, p_product_id, p_payload, p_city_ids
  );

  if not was_published and requested_fulfillment = 'branch'
    and (p_payload ->> 'max_claims')::integer > least(
      (p_payload ->> 'daily_capacity')::integer
        * ((p_payload ->> 'valid_until')::date - (p_payload ->> 'valid_from')::date + 1),
      1000
    ) then
    raise exception 'Total vouchers cannot exceed daily vouchers multiplied by the inclusive offer dates.' using errcode = '22023';
  end if;

  return published_offer_id;
end;
$$;

revoke all on function public.seller_publish_product_offer_in_cities(uuid, uuid, jsonb, text[]) from public, anon;
grant execute on function public.seller_publish_product_offer_in_cities(uuid, uuid, jsonb, text[]) to authenticated;