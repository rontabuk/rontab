revoke insert, update, delete on public.categories from authenticated;
drop policy "Admins manage categories" on public.categories;

drop policy "Owners and admins update seller profiles" on public.seller_profiles;
create policy "Owners update their seller profile"
	on public.seller_profiles for update to authenticated
	using (user_id = (select auth.uid()))
	with check (user_id = (select auth.uid()));

drop policy "Active sellers update their products; admins update all" on public.products;
create policy "Active sellers update their products"
	on public.products for update to authenticated
	using ((select public.is_active_seller_owner(seller_profile_id)))
	with check (
		(select public.is_active_seller_owner(seller_profile_id))
		and status in ('draft', 'pending', 'paused', 'archived')
	);

drop policy "Sellers delete draft or rejected products; admins delete all" on public.products;
create policy "Sellers delete draft or rejected products"
	on public.products for delete to authenticated
	using (
		(select public.is_active_seller_owner(seller_profile_id))
		and status in ('draft', 'rejected')
	);

drop policy "Admins manage product review and publication" on public.products;
drop policy "Admins manage all product images" on public.product_images;

revoke insert on public.admin_audit_logs from authenticated;
drop policy "Admins append audit logs as themselves" on public.admin_audit_logs;
