alter table public.seller_contact_details
  add column business_postcode text check (
    business_postcode is null or business_postcode ~ '^(GIR 0AA|[A-PR-UWYZ]([0-9]{1,2}|[A-HK-Y][0-9]{1,2}|[0-9][A-HJKPSTUW]|[A-HK-Y][0-9][ABEHMNPRVWXY]) [0-9][ABD-HJLNP-UW-Z]{2})$'
  );

create function public.seller_save_business_postcode(p_business_postcode text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  seller_id uuid;
begin
  select id into seller_id from public.seller_profiles
  where user_id = (select auth.uid()) and status in ('pending', 'active');
  if seller_id is null then
    raise exception 'Active or pending seller account required.' using errcode = '42501';
  end if;

  update public.seller_contact_details
  set business_postcode = nullif(upper(btrim(p_business_postcode)), ''), updated_at = now()
  where seller_profile_id = seller_id;
  if not found then
    raise exception 'Save shop contact details first.' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.seller_save_business_postcode(text) from public, anon;
grant execute on function public.seller_save_business_postcode(text) to authenticated;