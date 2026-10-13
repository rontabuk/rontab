drop policy "Sellers delete draft or rejected products" on public.products;

create policy "Active sellers delete their own products"
	on public.products for delete to authenticated
	using ((select public.is_active_seller_owner(seller_profile_id)));

drop policy "Owners and admins delete product images" on storage.objects;

create policy "Owners and admins delete product media"
	on storage.objects for delete to authenticated
	using (
		bucket_id = 'product-images'
		and (
			(select public.is_admin())
			or exists (
				select 1
				from public.seller_profiles s
				join public.products p on p.seller_profile_id = s.id
				where s.user_id = (select auth.uid())
					and s.status = 'active'
					and s.id::text = (storage.foldername(name))[1]
					and p.id::text = (storage.foldername(name))[2]
			)
		)
	);
