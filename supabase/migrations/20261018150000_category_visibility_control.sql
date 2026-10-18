create or replace function public.admin_set_category_visibility(p_category_id uuid, p_is_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  if p_is_active is null then
    raise exception 'Visibility is required.' using errcode = '22023';
  end if;

  update public.categories set is_active = p_is_active where id = p_category_id;
  if not found then
    raise exception 'Category not found.' using errcode = 'P0002';
  end if;

  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'category_visibility_updated', 'category', p_category_id,
    jsonb_build_object('is_active', p_is_active));
end;
$$;

revoke all on function public.admin_set_category_visibility(uuid, boolean) from public, anon;
grant execute on function public.admin_set_category_visibility(uuid, boolean) to authenticated;