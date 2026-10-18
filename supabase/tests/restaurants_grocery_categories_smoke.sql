begin;

do $$
declare
  department record;
  section record;
  category_count integer;
  restaurants_id uuid;
  pizza_id uuid;
  grocery_id uuid;
  dairy_id uuid;
  milk_id uuid;
begin
  for department in select * from (values ('restaurants', 21, 20), ('grocery', 63, 22)) as expected(slug, total, groups)
  loop
    with recursive branch as (
      select id from public.categories where slug = department.slug
      union
      select child.id from public.categories child join branch parent on child.parent_id = parent.id
    ) select count(*) into category_count from branch;
    assert category_count >= department.total, 'Missing defaults in ' || department.slug;
    select count(*) into category_count from public.categories child
    join public.categories root on root.id = child.parent_id where root.slug = department.slug;
    assert category_count >= department.groups, 'Missing groups in ' || department.slug;
  end loop;

  assert not exists (
    select 1 from public.categories child
    join public.categories parent on parent.id = child.parent_id
    join public.categories root on root.id = parent.parent_id where root.slug = 'restaurants'
  ), 'Restaurants should have direct branches only';

  for section in select * from (values
    ('grocery-fruit-vegetables', 3), ('grocery-meat-poultry', 3), ('grocery-fish-seafood', 3),
    ('grocery-dairy-eggs', 5), ('grocery-bread-bakery', 4), ('grocery-rice-pasta-grains', 3),
    ('grocery-pulses-beans', 0), ('grocery-canned-jarred-food', 0), ('grocery-frozen-food', 5),
    ('grocery-ready-meals', 0), ('grocery-oils-cooking-essentials', 3), ('grocery-herbs-spices-seasonings', 0),
    ('grocery-sauces-condiments', 0), ('grocery-breakfast-cereals-spreads', 0), ('grocery-snacks-crisps', 0),
    ('grocery-sweets-chocolate', 0), ('grocery-nuts-dried-fruit', 0), ('grocery-water-juices-soft-drinks', 3),
    ('grocery-tea-coffee', 0), ('grocery-baby-food-essentials', 2), ('grocery-cleaning-laundry', 3),
    ('grocery-paper-household-essentials', 3)
  ) as expected(slug, total)
  loop
    assert exists (
      select 1 from public.categories parent join public.categories root on root.id = parent.parent_id
      where parent.slug = section.slug and root.slug = 'grocery' and root.parent_id is null
    ), 'Missing or misplaced Grocery group ' || section.slug;
    select count(*) into category_count from public.categories child
    join public.categories parent on parent.id = child.parent_id where parent.slug = section.slug;
    if section.total = 0 then
      assert category_count = 0, 'Small Grocery groups should remain directly selectable: ' || section.slug;
    else
      assert category_count >= section.total, 'Missing Grocery subcategories in ' || section.slug;
    end if;
  end loop;

  select id into restaurants_id from public.categories where slug = 'restaurants';
  select id into pizza_id from public.categories where slug = 'restaurants-pizza';
  select id into grocery_id from public.categories where slug = 'grocery';
  select id into dairy_id from public.categories where slug = 'grocery-dairy-eggs';
  select id into milk_id from public.categories where slug = 'grocery-dairy-eggs-milk';
  update public.categories set is_active = true where id in (restaurants_id, pizza_id, grocery_id, dairy_id, milk_id);
  assert public.is_category_visible(pizza_id) and public.is_category_visible(milk_id), 'Active branches must be visible';
  update public.categories set is_active = false where id = dairy_id;
  assert not public.is_category_visible(milk_id), 'Hidden Dairy must hide Milk';
  assert public.is_category_visible(grocery_id) and public.is_category_visible(pizza_id), 'Other groups must remain visible';
  update public.categories set is_active = true where id = dairy_id;
  update public.categories set is_active = false where id = milk_id;
  update public.categories set is_active = false where id = grocery_id;
  update public.categories set is_active = true where id = grocery_id;
  assert not public.is_category_visible(milk_id), 'Restoring Grocery must not reactivate individually hidden Milk';
  update public.categories set is_active = false where id = restaurants_id;
  assert not public.is_category_visible(pizza_id), 'Hidden Restaurants must hide Pizza';
  assert public.is_category_visible(grocery_id), 'Hiding Restaurants must not affect Grocery';
end;
$$;

rollback;