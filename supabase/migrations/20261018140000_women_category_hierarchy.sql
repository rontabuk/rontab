begin;

create or replace function public.is_category_visible(p_category_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with recursive ancestors as (
    select id, parent_id, is_active from public.categories where id = p_category_id
    union
    select parent.id, parent.parent_id, parent.is_active
    from public.categories parent
    join ancestors child on parent.id = child.parent_id
  )
  select coalesce(bool_and(is_active) and bool_or(parent_id is null), false) from ancestors;
$$;

revoke all on function public.is_category_visible(uuid) from public;
grant execute on function public.is_category_visible(uuid) to anon, authenticated;

drop policy "Anyone reads active categories; admins read all" on public.categories;
create policy "Anyone reads active categories; admins read all"
  on public.categories for select to anon, authenticated
  using ((select public.is_admin()) or public.is_category_visible(id));

create or replace function public.admin_save_category_with_parent(
  p_category_id uuid,
  p_slug text,
  p_name text,
  p_description text,
  p_image_url text,
  p_is_active boolean,
  p_sort_order integer,
  p_parent_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_category_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  lock table public.categories in share row exclusive mode;

  if p_parent_id is not null then
    if not exists (select 1 from public.categories where id = p_parent_id) then
      raise exception 'Parent category not found.' using errcode = '23503';
    end if;

    if exists (
      with recursive ancestors as (
        select id, parent_id from public.categories where id = p_parent_id
        union
        select parent.id, parent.parent_id
        from public.categories parent join ancestors child on parent.id = child.parent_id
      )
      select 1 from ancestors where id = p_category_id
    ) then
      raise exception 'A category cannot be placed inside itself or its descendants.' using errcode = '23514';
    end if;
  end if;

  saved_category_id := public.admin_save_category(
    p_category_id, p_slug, p_name, p_description, p_image_url, p_is_active, p_sort_order
  );

  update public.categories set parent_id = p_parent_id where id = saved_category_id;

  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'category_parent_saved', 'category', saved_category_id,
    jsonb_build_object('parent_id', p_parent_id));

  return saved_category_id;
end;
$$;

revoke all on function public.admin_save_category_with_parent(uuid, text, text, text, text, boolean, integer, uuid) from public, anon;
grant execute on function public.admin_save_category_with_parent(uuid, text, text, text, text, boolean, integer, uuid) to authenticated;

insert into public.categories (slug, name, is_active, sort_order)
values ('women', 'Women', true, -100)
on conflict (slug) do nothing;

insert into public.categories (slug, name, parent_id, is_active, sort_order)
select 'women-' || groups.slug, groups.name, root.id, true, groups.sort_order
from (values
  ('clothing', 'Clothing', 10),
  ('shoes', 'Shoes', 20),
  ('bags', 'Bags', 30),
  ('accessories', 'Accessories', 40),
  ('beauty', 'Beauty', 50)
) as groups(slug, name, sort_order)
join public.categories root on root.slug = 'women'
on conflict (slug) do nothing;

insert into public.categories (slug, name, parent_id, is_active, sort_order)
select parent.slug || '-' || (item.value->>'slug'), item.value->>'name', parent.id, true, item.ordinality::integer
from (values
  ('women-clothing', '[
    {"slug":"jumpers-sweaters","name":"Jumpers & sweaters"},
    {"slug":"outerwear","name":"Outerwear"},
    {"slug":"dresses","name":"Dresses"},
    {"slug":"suits-blazers","name":"Suits & blazers"},
    {"slug":"shorts","name":"Shorts"},
    {"slug":"skirts","name":"Skirts"},
    {"slug":"jeans","name":"Jeans"},
    {"slug":"tops-t-shirts","name":"Tops & t-shirts"},
    {"slug":"shorts-cropped-trousers","name":"Shorts & cropped trousers"},
    {"slug":"trousers-leggings","name":"Trousers & leggings"},
    {"slug":"swimwear","name":"Swimwear"},
    {"slug":"jumpsuits-playsuits","name":"Jumpsuits & playsuits"},
    {"slug":"maternity-clothes","name":"Maternity clothes"},
    {"slug":"lingerie-nightwear","name":"Lingerie & nightwear"},
    {"slug":"costumes-special-outfits","name":"Costumes & special outfits"},
    {"slug":"activewear","name":"Activewear"},
    {"slug":"other-clothing","name":"Other clothing"}
  ]'::jsonb),
  ('women-shoes', '[
    {"slug":"ballerinas","name":"Ballerinas"},
    {"slug":"boat-shoes-loafers-moccasins","name":"Boat shoes, loafers & moccasins"},
    {"slug":"boots","name":"Boots"},
    {"slug":"clogs-mules","name":"Clogs & mules"},
    {"slug":"espadrilles","name":"Espadrilles"},
    {"slug":"flip-flops-slides","name":"Flip-flops & slides"},
    {"slug":"heels","name":"Heels"},
    {"slug":"lace-up-shoes","name":"Lace-up shoes"},
    {"slug":"mary-janes-t-bar-shoes","name":"Mary Janes & T-bar shoes"},
    {"slug":"sandals","name":"Sandals"},
    {"slug":"slippers","name":"Slippers"},
    {"slug":"sports-shoes","name":"Sports shoes"},
    {"slug":"trainers","name":"Trainers"}
  ]'::jsonb),
  ('women-bags', '[
    {"slug":"backpacks","name":"Backpacks"},
    {"slug":"beach-bags","name":"Beach bags"},
    {"slug":"briefcases","name":"Briefcases"},
    {"slug":"bucket-bags","name":"Bucket bags"},
    {"slug":"bum-bags","name":"Bum bags"},
    {"slug":"clutches","name":"Clutches"},
    {"slug":"garment-bags","name":"Garment bags"},
    {"slug":"gym-bags","name":"Gym bags"},
    {"slug":"handbags","name":"Handbags"},
    {"slug":"hobo-bags","name":"Hobo bags"},
    {"slug":"holdalls-duffel-bags","name":"Holdalls & duffel bags"},
    {"slug":"luggage-suitcases","name":"Luggage & suitcases"},
    {"slug":"makeup-bags","name":"Makeup bags"},
    {"slug":"satchels-messenger-bags","name":"Satchels & messenger bags"},
    {"slug":"shoulder-bags","name":"Shoulder bags"},
    {"slug":"tote-bags","name":"Tote bags"},
    {"slug":"wallets-purses","name":"Wallets & purses"},
    {"slug":"wristlets","name":"Wristlets"}
  ]'::jsonb),
  ('women-accessories', '[
    {"slug":"bandanas-headscarves","name":"Bandanas & headscarves"},
    {"slug":"belts","name":"Belts"},
    {"slug":"gloves","name":"Gloves"},
    {"slug":"hair-accessories","name":"Hair accessories"},
    {"slug":"handkerchiefs","name":"Handkerchiefs"},
    {"slug":"hats-caps","name":"Hats & caps"},
    {"slug":"jewellery","name":"Jewellery"},
    {"slug":"keyrings","name":"Keyrings"},
    {"slug":"scarves-shawls","name":"Scarves & shawls"},
    {"slug":"sunglasses","name":"Sunglasses"},
    {"slug":"umbrellas","name":"Umbrellas"},
    {"slug":"watches","name":"Watches"},
    {"slug":"other-accessories","name":"Other accessories"}
  ]'::jsonb),
  ('women-beauty', '[
    {"slug":"make-up","name":"Make-up"},
    {"slug":"perfume","name":"Perfume"},
    {"slug":"facial-care","name":"Facial care"},
    {"slug":"beauty-tools","name":"Beauty tools"},
    {"slug":"hand-care","name":"Hand care"},
    {"slug":"nail-care","name":"Nail care"},
    {"slug":"body-care","name":"Body care"},
    {"slug":"hair-care","name":"Hair care"},
    {"slug":"other-beauty-items","name":"Other beauty items"}
  ]'::jsonb)
) as presets(parent_slug, children)
join public.categories parent on parent.slug = presets.parent_slug
cross join lateral jsonb_array_elements(presets.children) with ordinality as item(value, ordinality)
on conflict (slug) do nothing;

commit;