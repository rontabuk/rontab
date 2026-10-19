create function public.get_public_seller_contact_links(p_seller_profile_id uuid)
returns table(kind text, href text)
language sql stable security definer set search_path = '' as $$
  with shop as (
    select seller.id, seller.user_id, seller.shop_url from public.seller_profiles seller
    where seller.id = p_seller_profile_id and seller.status = 'active' and seller.is_public
  ), links as (
    select entry.kind, entry.href, entry.position from shop
    left join public.seller_contact_details contact on contact.seller_profile_id = shop.id
    cross join lateral (values
      ('shop', shop.shop_url, 1),
      ('location', case when contact.business_postcode is not null then 'https://www.google.com/maps/search/?api=1&query=' || replace(contact.business_postcode, ' ', '%20') || '%2C%20United%20Kingdom' end, 2),
      ('phone', case when contact.phone_visibility = 'public' and contact.phone_contact_confirmed_at is not null then 'tel:' || contact.phone end, 3),
      ('website', contact.website_url, 4), ('instagram', contact.instagram_url, 5),
      ('facebook', contact.facebook_url, 6), ('x', contact.twitter_url, 7),
      ('youtube', contact.youtube_url, 8), ('tiktok', contact.tiktok_url, 9)
    ) entry(kind, href, position)
    union all
    select social.platform, social.profile_url, 10 + social.position from shop
    join public.member_contact_preferences preferences on preferences.user_id = shop.user_id and preferences.contact_visibility = 'public'
    join public.member_social_links social on social.user_id = shop.user_id
  )
  select distinct on (links.href) links.kind, links.href from links
  where links.href is not null and btrim(links.href) <> ''
    and (links.href ~* '^https?://' or (links.kind = 'phone' and links.href ~ '^tel:\+?[0-9() -]{7,32}$'))
  order by links.href, links.position;
$$;
revoke all on function public.get_public_seller_contact_links(uuid) from public;
grant execute on function public.get_public_seller_contact_links(uuid) to anon, authenticated;