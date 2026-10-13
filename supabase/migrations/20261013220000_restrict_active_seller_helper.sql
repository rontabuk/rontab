revoke all on function public.is_active_seller_owner(uuid) from public, anon, authenticated;
grant execute on function public.is_active_seller_owner(uuid) to authenticated;