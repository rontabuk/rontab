drop policy "Public reads approved products; sellers read their own"
	on public.products;

create policy "Public reads approved products; sellers read their own"
	on public.products for select to anon, authenticated
	using (
		(
			status = 'approved'
			and exists (
				select 1
				from public.categories c
				where c.id = category_id
					and c.is_active
			)
			and exists (
				select 1
				from public.seller_profiles s
				where s.id = seller_profile_id
					and s.status = 'active'
					and s.is_public
			)
		)
		or (select public.is_seller_owner(seller_profile_id))
		or (select public.is_admin())
	);
