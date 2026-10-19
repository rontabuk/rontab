alter table public.marketplace_settings
  add column seller_reel_upload_enabled boolean not null default true;

create function public.get_seller_reel_upload_enabled()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select settings.seller_reel_upload_enabled
    from public.marketplace_settings settings where settings.singleton), false);
$$;
revoke all on function public.get_seller_reel_upload_enabled() from public, anon;
grant execute on function public.get_seller_reel_upload_enabled() to authenticated;

create function public.admin_update_marketplace_settings(
  p_product_approval_mode text,
  p_seller_approval_mode text,
  p_featured_duration_minutes integer,
  p_new_products_duration_minutes integer,
  p_click_price_pence_per_1000 integer,
  p_visitor_daily_visit_points_cap integer,
  p_seller_reel_upload_enabled boolean
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  previous_reel_upload_enabled boolean;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  if p_product_approval_mode not in ('manual', 'automatic')
    or p_seller_approval_mode not in ('manual', 'automatic')
    or p_featured_duration_minutes not between 1 and 10080
    or p_new_products_duration_minutes not between 1 and 10080
    or p_click_price_pence_per_1000 not between 1 and 100000
    or p_visitor_daily_visit_points_cap not between 1 and 250
    or p_seller_reel_upload_enabled is null then
    raise exception 'Invalid marketplace setting.' using errcode = '22023';
  end if;

  select seller_reel_upload_enabled into previous_reel_upload_enabled
  from public.marketplace_settings where singleton for update;

  update public.marketplace_settings
  set product_approval_mode = p_product_approval_mode,
      seller_approval_mode = p_seller_approval_mode,
      featured_duration_minutes = p_featured_duration_minutes,
      new_products_duration_minutes = p_new_products_duration_minutes,
      click_price_pence_per_1000 = p_click_price_pence_per_1000,
      visitor_daily_visit_points_cap = p_visitor_daily_visit_points_cap,
      seller_reel_upload_enabled = p_seller_reel_upload_enabled
  where singleton = true;

  insert into public.admin_audit_logs (actor_id, action, entity_type, details)
  values (
    (select auth.uid()),
    'marketplace_settings_updated',
    'marketplace_settings',
    jsonb_build_object(
      'product_approval_mode', p_product_approval_mode,
      'seller_approval_mode', p_seller_approval_mode,
      'featured_duration_minutes', p_featured_duration_minutes,
      'new_products_duration_minutes', p_new_products_duration_minutes,
      'click_price_pence_per_1000', p_click_price_pence_per_1000,
      'visitor_daily_visit_points_cap', p_visitor_daily_visit_points_cap,
      'previous_seller_reel_upload_enabled', previous_reel_upload_enabled,
      'seller_reel_upload_enabled', p_seller_reel_upload_enabled
    )
  );
end;
$$;
revoke all on function public.admin_update_marketplace_settings(text, text, integer, integer, integer, integer, boolean) from public, anon;
grant execute on function public.admin_update_marketplace_settings(text, text, integer, integer, integer, integer, boolean) to authenticated;

create function public.enforce_seller_reel_upload_setting()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  reels_enabled boolean;
begin
  if new.media_type <> 'video' or public.is_admin() then
    return new;
  end if;

  select seller_reel_upload_enabled into reels_enabled
  from public.marketplace_settings where singleton;
  if not coalesce(reels_enabled, false) then
    raise exception 'Seller Reel uploads are currently disabled.' using errcode = '55000';
  end if;

  return new;
end;
$$;
revoke all on function public.enforce_seller_reel_upload_setting() from public, anon, authenticated;
create trigger enforce_seller_reel_upload_setting
  before insert or update on public.product_images
  for each row execute function public.enforce_seller_reel_upload_setting();

drop policy "Active sellers upload images to editable products" on storage.objects;
create policy "Active sellers upload images to editable products"
  on storage.objects for insert to authenticated
  with check (
    storage.objects.bucket_id = 'product-images'
    and (
      lower(coalesce(storage.extension(storage.objects.name), '')) not in ('mp4', 'webm')
        and lower(coalesce(storage.objects.metadata ->> 'mimetype', '')) not in ('video/mp4', 'video/webm')
      or public.get_seller_reel_upload_enabled()
    )
    and exists (
      select 1
      from public.seller_profiles seller
      join public.products product on product.seller_profile_id = seller.id
      where seller.user_id = (select auth.uid())
        and seller.status = 'active'
        and seller.id::text = (storage.foldername(storage.objects.name))[1]
        and product.id::text = (storage.foldername(storage.objects.name))[2]
        and product.status in ('draft', 'pending')
    )
  );