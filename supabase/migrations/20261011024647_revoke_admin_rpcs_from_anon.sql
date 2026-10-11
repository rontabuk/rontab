revoke all on function public.admin_review_product(uuid, public.product_status) from anon, public;
revoke all on function public.admin_set_seller_status(uuid, public.seller_status, boolean) from anon, public;
revoke all on function public.admin_save_category(uuid, text, text, text, text, boolean, integer) from anon, public;

grant execute on function public.admin_review_product(uuid, public.product_status) to authenticated;
grant execute on function public.admin_set_seller_status(uuid, public.seller_status, boolean) to authenticated;
grant execute on function public.admin_save_category(uuid, text, text, text, text, boolean, integer) to authenticated;
