begin;

do $$
begin
  assert not has_function_privilege('anon', 'public.admin_set_category_visibility(uuid,boolean)', 'execute'), 'Anonymous users must not change category visibility';
  assert has_function_privilege('authenticated', 'public.admin_set_category_visibility(uuid,boolean)', 'execute'), 'Authenticated requests require the RPC admin check';
end;
$$;

do $$
declare
  women_id uuid;
  shoes_id uuid;
  boots_id uuid;
  original_root_active boolean;
  original_shoes_active boolean;
  original_boots_active boolean;
begin
  select id, is_active into women_id, original_root_active from public.categories where slug = 'women';
  select id, is_active into shoes_id, original_shoes_active from public.categories where slug = 'women-shoes';
  select id, is_active into boots_id, original_boots_active from public.categories where slug = 'women-shoes-boots';
  assert women_id is not null and shoes_id is not null and boots_id is not null, 'Women defaults must be seeded';
  assert (select count(*) from public.categories where slug = 'women' or slug like 'women-%') >= 76, 'All Women defaults must exist';
  assert (select parent_id = women_id from public.categories where id = shoes_id), 'Shoes must belong to Women';
  assert (select parent_id = shoes_id from public.categories where id = boots_id), 'Boots must belong to Shoes';

  update public.categories set is_active = true where id in (women_id, shoes_id, boots_id);
  assert public.is_category_visible(boots_id), 'Active descendants must be visible';
  update public.categories set is_active = false where id = boots_id;
  assert not public.is_category_visible(boots_id), 'A hidden leaf must not be visible';
  assert public.is_category_visible(shoes_id), 'Hiding a leaf must not hide its parent';
  update public.categories set is_active = true where id = boots_id;
  update public.categories set is_active = false where id = shoes_id;
  assert not public.is_category_visible(boots_id), 'A hidden parent must hide its descendants';
  assert public.is_category_visible(women_id), 'Hiding a group must not hide Women';
  update public.categories set is_active = true where id = shoes_id;
  update public.categories set is_active = false where id = women_id;
  assert not public.is_category_visible(boots_id), 'A hidden root must hide the whole branch';
  update public.categories set is_active = original_root_active where id = women_id;
  update public.categories set is_active = original_shoes_active where id = shoes_id;
  update public.categories set is_active = original_boots_active where id = boots_id;
end;
$$;

rollback;