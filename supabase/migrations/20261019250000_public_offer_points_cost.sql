alter table public.seller_offers add column audience text;

update public.seller_offers
set audience = case when points_cost > 0 then 'reward' else 'general' end;

alter table public.seller_offers alter column audience set default 'general';
alter table public.seller_offers alter column audience set not null;
alter table public.seller_offers add constraint seller_offers_audience_check check (audience in ('general', 'reward'));

update public.seller_offers offer
set points_cost = settings.default_reward_points
from public.seller_offer_settings settings
where settings.singleton and offer.auto_published and offer.fulfillment = 'branch'
  and offer.status in ('approved', 'published', 'paused') and offer.points_cost = 0;

alter function public.seller_publish_product_offer(uuid, uuid, jsonb)
  rename to seller_publish_product_offer_before_audience_points;
revoke all on function public.seller_publish_product_offer_before_audience_points(uuid, uuid, jsonb) from public, anon, authenticated;

create function public.seller_publish_product_offer(p_request_id uuid, p_product_id uuid, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  was_published boolean;
  published_offer_id uuid;
  requested_audience text := p_payload ->> 'audience';
  requested_fulfillment text := p_payload ->> 'fulfillment';
begin
  select exists(select 1 from public.seller_offers where request_id = p_request_id) into was_published;
  published_offer_id := public.seller_publish_product_offer_before_audience_points(p_request_id, p_product_id, p_payload);

  if not was_published then
    update public.seller_offers offer
    set audience = requested_audience,
        points_cost = case when requested_fulfillment = 'branch'
          then (select settings.default_reward_points from public.seller_offer_settings settings where settings.singleton)
          else 0 end
    where offer.id = published_offer_id;
  end if;

  return published_offer_id;
end;
$$;

revoke all on function public.seller_publish_product_offer(uuid, uuid, jsonb) from public, anon;
grant execute on function public.seller_publish_product_offer(uuid, uuid, jsonb) to authenticated;

alter function public.seller_publish_product_offer_in_cities(uuid, uuid, jsonb, text[])
  rename to seller_publish_product_offer_in_cities_before_audience_points;
revoke all on function public.seller_publish_product_offer_in_cities_before_audience_points(uuid, uuid, jsonb, text[]) from public, anon, authenticated;

create function public.seller_publish_product_offer_in_cities(
  p_request_id uuid, p_product_id uuid, p_payload jsonb, p_city_ids text[]
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  was_published boolean;
  published_offer_id uuid;
  requested_audience text := p_payload ->> 'audience';
  requested_fulfillment text := p_payload ->> 'fulfillment';
begin
  select exists(select 1 from public.seller_offers where request_id = p_request_id) into was_published;
  published_offer_id := public.seller_publish_product_offer_in_cities_before_audience_points(
    p_request_id, p_product_id, p_payload, p_city_ids
  );

  if not was_published then
    update public.seller_offers offer
    set audience = requested_audience,
        points_cost = case when requested_fulfillment = 'branch'
          then (select settings.default_reward_points from public.seller_offer_settings settings where settings.singleton)
          else 0 end
    where offer.id = published_offer_id;
  end if;

  return published_offer_id;
end;
$$;

revoke all on function public.seller_publish_product_offer_in_cities(uuid, uuid, jsonb, text[]) from public, anon;
grant execute on function public.seller_publish_product_offer_in_cities(uuid, uuid, jsonb, text[]) to authenticated;