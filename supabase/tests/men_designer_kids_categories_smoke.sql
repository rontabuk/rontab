begin;

do $$
declare
  department record;
  section record;
  category_count integer;
  kids_id uuid;
  men_id uuid;
  toys_id uuid;
  toy_id uuid;
begin
  for department in select * from (values ('men', 51), ('designer', 10), ('kids', 124)) as expected(slug, total)
  loop
    with recursive branch as (
      select id from public.categories where slug = department.slug
      union
      select child.id from public.categories child join branch parent on child.parent_id = parent.id
    ) select count(*) into category_count from branch;
    assert category_count >= department.total, 'Missing defaults in department ' || department.slug;
  end loop;

  for section in select * from (values
    ('men-clothing', 13), ('men-shoes', 10), ('men-accessories', 14), ('men-grooming', 9),
    ('designer-women', 4), ('designer-men', 3),
    ('kids-girls-clothing', 19), ('kids-boys-clothing', 17), ('kids-toys', 13),
    ('kids-pushchairs-carriers-car-seats', 6), ('kids-furniture-decor', 12), ('kids-bathing-changing', 8),
    ('kids-childproofing-safety-equipment', 4), ('kids-health-pregnancy', 7),
    ('kids-nursing-feeding', 12), ('kids-sleep-bedding', 10), ('kids-school-supplies', 3)
  ) as expected(slug, total)
  loop
    select count(*) into category_count from public.categories child
    join public.categories parent on parent.id = child.parent_id where parent.slug = section.slug;
    assert category_count >= section.total, 'Missing subcategories in ' || section.slug;
  end loop;

  assert exists (select 1 from public.categories where slug = 'kids-other-items' and name = 'Other kids'' items'), 'Other kids items must exist';
  assert exists (select 1 from public.categories where slug = 'kids-girls-clothing-baby-girls-clothing' and name = 'Baby girls'' clothing'), 'Apostrophes in category names must be preserved';

  select id into kids_id from public.categories where slug = 'kids';
  select id into men_id from public.categories where slug = 'men';
  select id into toys_id from public.categories where slug = 'kids-toys';
  select id into toy_id from public.categories where slug = 'kids-toys-educational-toys';
  update public.categories set is_active = true where id in (kids_id, men_id, toys_id, toy_id);
  assert public.is_category_visible(toy_id), 'Active Kids branch must be visible';
  update public.categories set is_active = false where id = toys_id;
  assert not public.is_category_visible(toy_id), 'Hidden Toys must hide its descendants';
  assert public.is_category_visible(kids_id), 'Hiding Toys must not hide Kids';
  assert public.is_category_visible(men_id), 'Hiding Toys must not affect Men';
  update public.categories set is_active = true where id = toys_id;
  update public.categories set is_active = false where id = kids_id;
  assert not public.is_category_visible(toy_id), 'Hidden Kids must hide the entire branch';
end;
$$;

rollback;