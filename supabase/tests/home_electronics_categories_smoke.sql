begin;

do $$
declare
  department record;
  section record;
  category_count integer;
  home_id uuid;
  electronics_id uuid;
  computers_id uuid;
  laptop_id uuid;
begin
  for department in select * from (values ('home', 143, 14), ('electronics', 102, 10)) as expected(slug, total, groups)
  loop
    with recursive branch as (
      select id from public.categories where slug = department.slug
      union
      select child.id from public.categories child join branch parent on child.parent_id = parent.id
    ) select count(*) into category_count from branch;
    assert category_count >= department.total, 'Missing defaults in department ' || department.slug;
    select count(*) into category_count from public.categories child
    join public.categories root on root.id = child.parent_id where root.slug = department.slug;
    assert category_count >= department.groups, 'Missing groups in department ' || department.slug;
  end loop;

  for section in select * from (values
    ('home-small-kitchen-appliances', 13), ('home-large-appliances', 10), ('home-cookware-bakeware', 8),
    ('home-kitchen-tools', 10), ('home-tableware', 3), ('home-household-care', 3), ('home-textiles', 9),
    ('home-accessories', 13), ('home-office-supplies', 14), ('home-celebrations-holidays', 8),
    ('home-tools-diy', 13), ('home-outdoor-garden', 10), ('home-furniture', 8), ('home-pet-care', 6),
    ('electronics-video-games-consoles', 7), ('electronics-computers-accessories', 18),
    ('electronics-mobile-phones-communication', 6), ('electronics-audio-headphones-hi-fi', 8),
    ('electronics-cameras-accessories', 11), ('electronics-tablets-e-readers-accessories', 5),
    ('electronics-tv-home-cinema', 12), ('electronics-beauty-personal-care', 7),
    ('electronics-wearables', 6), ('electronics-other-devices-accessories', 11)
  ) as expected(slug, total)
  loop
    select count(*) into category_count from public.categories child
    join public.categories parent on parent.id = child.parent_id
    join public.categories root on root.id = parent.parent_id
    where parent.slug = section.slug and root.slug = split_part(section.slug, '-', 1);
    assert category_count >= section.total, 'Missing or misplaced subcategories in ' || section.slug;
  end loop;

  assert exists (select 1 from public.categories where slug = 'home-tools-diy-electricians-tools' and name = 'Electrician''s tools'), 'Apostrophes must be preserved';
  assert exists (select 1 from public.categories where slug = 'electronics-other-devices-accessories-3d-printing-scanning'), '3D printing must have a valid slug';
  select id into home_id from public.categories where slug = 'home';
  select id into electronics_id from public.categories where slug = 'electronics';
  select id into computers_id from public.categories where slug = 'electronics-computers-accessories';
  select id into laptop_id from public.categories where slug = 'electronics-computers-accessories-laptops';
  update public.categories set is_active = true where id in (home_id, electronics_id, computers_id, laptop_id);
  assert public.is_category_visible(laptop_id), 'Active Electronics branch must be visible';
  update public.categories set is_active = false where id = computers_id;
  assert not public.is_category_visible(laptop_id), 'Hidden Computers must hide Laptops';
  assert public.is_category_visible(electronics_id), 'Hiding Computers must not hide Electronics';
  assert public.is_category_visible(home_id), 'Hiding Computers must not affect Home';
  update public.categories set is_active = true where id = computers_id;
  update public.categories set is_active = false where id = electronics_id;
  assert not public.is_category_visible(laptop_id), 'Hidden Electronics must hide the entire branch';
end;
$$;

rollback;