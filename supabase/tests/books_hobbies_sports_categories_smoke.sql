begin;

do $$
declare
  department record;
  section record;
  category_count integer;
  books_id uuid;
  hobbies_id uuid;
  sports_id uuid;
  cycling_id uuid;
  bike_id uuid;
begin
  for department in select * from (values
    ('books-media', 22, 4), ('hobbies-collectables', 67, 12), ('sports', 125, 12)
  ) as expected(slug, total, groups)
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
    ('books-media-books', 6), ('books-media-magazines', 0), ('books-media-music', 4), ('books-media-video', 7),
    ('hobbies-collectables-trading-cards', 6), ('hobbies-collectables-board-games', 0), ('hobbies-collectables-puzzles', 0),
    ('hobbies-collectables-tabletop-miniature-gaming', 0), ('hobbies-collectables-memorabilia', 4),
    ('hobbies-collectables-coins-banknotes', 5), ('hobbies-collectables-stamps', 5), ('hobbies-collectables-postcards', 0),
    ('hobbies-collectables-musical-instruments-gear', 10), ('hobbies-collectables-arts-crafts', 11),
    ('hobbies-collectables-collectables-storage', 9), ('hobbies-collectables-gaming-accessories', 4),
    ('sports-cycling', 8), ('sports-fitness-running-yoga', 6), ('sports-outdoor-sports', 13), ('sports-water-sports', 14),
    ('sports-team-sports', 16), ('sports-racket-sports', 8), ('sports-golf', 7), ('sports-equestrian', 5),
    ('sports-skateboards-scooters', 7), ('sports-boxing-martial-arts', 10), ('sports-casual-sports-games', 9), ('sports-winter-sports', 9)
  ) as expected(slug, total)
  loop
    assert exists (
      select 1 from public.categories parent join public.categories root on root.id = parent.parent_id
      where parent.slug = section.slug and section.slug like root.slug || '-%'
        and root.slug in ('books-media', 'hobbies-collectables', 'sports') and root.parent_id is null
    ), 'Missing or misplaced group ' || section.slug;
    select count(*) into category_count from public.categories child
    join public.categories parent on parent.id = child.parent_id where parent.slug = section.slug;
    if section.total = 0 then
      assert category_count = 0, 'Unspecified defaults must not be invented for ' || section.slug;
    else
      assert category_count >= section.total, 'Missing subcategories in ' || section.slug;
    end if;
  end loop;

  assert exists (select 1 from public.categories where slug = 'sports-cycling-kids-bikes' and name = 'Kids'' bikes'), 'Apostrophes must be preserved';
  assert exists (select 1 from public.categories where slug = 'books-media-video-4k-blu-ray'), '4K Blu-ray must have a valid slug';
  select id into books_id from public.categories where slug = 'books-media';
  select id into hobbies_id from public.categories where slug = 'hobbies-collectables';
  select id into sports_id from public.categories where slug = 'sports';
  select id into cycling_id from public.categories where slug = 'sports-cycling';
  select id into bike_id from public.categories where slug = 'sports-cycling-bikes';
  update public.categories set is_active = true where id in (books_id, hobbies_id, sports_id, cycling_id, bike_id);
  assert public.is_category_visible(bike_id), 'Active Sports branch must be visible';
  update public.categories set is_active = false where id = cycling_id;
  assert not public.is_category_visible(bike_id), 'Hidden Cycling must hide Bikes';
  assert public.is_category_visible(sports_id), 'Hiding Cycling must not hide Sports';
  assert public.is_category_visible(books_id) and public.is_category_visible(hobbies_id), 'Other departments must remain visible';
  update public.categories set is_active = true where id = cycling_id;
  update public.categories set is_active = false where id = sports_id;
  assert not public.is_category_visible(bike_id), 'Hidden Sports must hide the entire branch';
end;
$$;

rollback;