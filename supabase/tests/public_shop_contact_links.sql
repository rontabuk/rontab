begin;
do $$
declare
  admin_user uuid := gen_random_uuid();
  seller_user uuid := gen_random_uuid();
  shop_id uuid;
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(admin_user,'authenticated','authenticated',admin_user || '@contacts-test.invalid','',now(),'{"role":"admin"}','{}',now(),now());
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(seller_user,'authenticated','authenticated',seller_user || '@contacts-test.invalid','',now(),'{}',
    jsonb_build_object('account_type','seller','shop_name','Contact privacy test','shop_slug','contacts-' || seller_user),now(),now());
  perform set_config('request.jwt.claim.sub',admin_user::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_user,'role','authenticated','app_metadata','{"role":"admin"}'::jsonb)::text,true);
  update public.seller_profiles set status = 'active', is_public = true, shop_url = 'https://shop.example.invalid' where user_id = seller_user returning id into shop_id;
  insert into public.seller_contact_details(seller_profile_id,registered_email,phone,phone_visibility,phone_contact_confirmed_at,instagram_url,facebook_url,business_postcode)
  values(shop_id,'private@example.invalid','+447700900123','collaborations',now(),'https://www.instagram.com/test-shop','https://www.facebook.com/test-shop','SW1A 1AA')
  on conflict(seller_profile_id) do update set registered_email = excluded.registered_email, phone = excluded.phone, phone_visibility = excluded.phone_visibility,
    phone_contact_confirmed_at = excluded.phone_contact_confirmed_at, instagram_url = excluded.instagram_url, facebook_url = excluded.facebook_url, business_postcode = excluded.business_postcode;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  if (select count(*) from public.get_public_seller_contact_links(shop_id)) <> 4
    or exists(select 1 from public.get_public_seller_contact_links(shop_id) where kind in ('phone','email')) then
    raise exception 'Public social links/map missing or private contacts leaked.';
  end if;
  update public.seller_contact_details set phone_visibility = 'public' where seller_profile_id = shop_id;
  if not exists(select 1 from public.get_public_seller_contact_links(shop_id) where kind = 'phone' and href = 'tel:+447700900123') then
    raise exception 'Consented, confirmed public phone missing.';
  end if;
  update public.seller_contact_details set phone_contact_confirmed_at = null where seller_profile_id = shop_id;
  if exists(select 1 from public.get_public_seller_contact_links(shop_id) where kind = 'phone') then raise exception 'Unconfirmed phone leaked.'; end if;
  insert into public.member_contact_preferences(user_id,contact_visibility) values(seller_user,'private');
  insert into public.member_social_links(user_id,position,platform,profile_url) values(seller_user,1,'other','https://private.example.invalid');
  if exists(select 1 from public.get_public_seller_contact_links(shop_id) where href = 'https://private.example.invalid') then raise exception 'Private member social link leaked.'; end if;
  update public.member_contact_preferences set contact_visibility = 'public' where user_id = seller_user;
  if not exists(select 1 from public.get_public_seller_contact_links(shop_id) where href = 'https://private.example.invalid') then raise exception 'Consented member social link missing.'; end if;
  perform set_config('request.jwt.claim.sub',admin_user::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_user,'role','authenticated','app_metadata','{"role":"admin"}'::jsonb)::text,true);
  update public.seller_profiles set is_public = false where id = shop_id;
  if exists(select 1 from public.get_public_seller_contact_links(shop_id)) then raise exception 'Hidden shop contacts leaked.'; end if;
  update public.seller_profiles set is_public = true, status = 'suspended' where id = shop_id;
  if exists(select 1 from public.get_public_seller_contact_links(shop_id)) then raise exception 'Suspended shop contacts leaked.'; end if;
  if not has_function_privilege('anon','public.get_public_seller_contact_links(uuid)','EXECUTE') then raise exception 'Guest access missing.'; end if;
  raise notice 'PASS: public socials and postcode, phone consent/confirmation, no private email/member links, hidden and suspended shops excluded.';
end;
$$;
rollback;