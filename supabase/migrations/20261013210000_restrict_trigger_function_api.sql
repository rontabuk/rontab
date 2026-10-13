revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.normalize_and_lock_profile_city() from public, anon, authenticated;
revoke all on function public.reject_unsupported_profile_city() from public, anon, authenticated;
revoke all on function public.reject_unsupported_seller_city() from public, anon, authenticated;
revoke all on function public.sync_seller_contact_email() from public, anon, authenticated;