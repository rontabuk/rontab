create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	requested_shop_name text;
	requested_shop_slug text;
begin
	insert into public.profiles (id, display_name)
	values (
		new.id,
		nullif(trim(new.raw_user_meta_data ->> 'display_name'), '')
	)
	on conflict (id) do nothing;

	if new.raw_user_meta_data ->> 'account_type' = 'seller' then
		requested_shop_name := nullif(trim(new.raw_user_meta_data ->> 'shop_name'), '');
		requested_shop_slug := lower(nullif(trim(new.raw_user_meta_data ->> 'shop_slug'), ''));

		if requested_shop_name is not null
			and requested_shop_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
		then
			insert into public.seller_profiles (user_id, shop_name, slug, status, is_public)
			values (new.id, requested_shop_name, requested_shop_slug, 'pending', false)
			on conflict (user_id) do nothing;
		end if;
	end if;

	return new;
end;
$$;

insert into storage.buckets (
	id,
	name,
	public,
	file_size_limit,
	allowed_mime_types
)
values (
	'product-images',
	'product-images',
	false,
	5242880,
	array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = false,
		file_size_limit = excluded.file_size_limit,
		allowed_mime_types = excluded.allowed_mime_types;

create policy "Public reads images for visible approved products"
	on storage.objects for select to anon, authenticated
	using (
		storage.objects.bucket_id = 'product-images'
		and (
			(select public.is_admin())
			or exists (
				select 1
				from public.product_images i
				join public.products p on p.id = i.product_id
				join public.categories c on c.id = p.category_id
				join public.seller_profiles s on s.id = p.seller_profile_id
				where i.storage_path = storage.objects.name
					and p.status = 'approved'
					and c.is_active
					and s.status = 'active'
					and s.is_public
			)
			or exists (
				select 1
				from public.seller_profiles s
				join public.products p on p.seller_profile_id = s.id
				where s.user_id = (select auth.uid())
					and s.status = 'active'
					  and s.id::text = (storage.foldername(storage.objects.name))[1]
					  and p.id::text = (storage.foldername(storage.objects.name))[2]
					and p.status in ('draft', 'pending')
			)
		)
	);

create policy "Active sellers upload images to editable products"
	on storage.objects for insert to authenticated
	with check (
		storage.objects.bucket_id = 'product-images'
		and exists (
			select 1
			from public.seller_profiles s
			join public.products p on p.seller_profile_id = s.id
			where s.user_id = (select auth.uid())
				and s.status = 'active'
				and s.id::text = (storage.foldername(storage.objects.name))[1]
				and p.id::text = (storage.foldername(storage.objects.name))[2]
				and p.status in ('draft', 'pending')
		)
	);

create policy "Owners and admins update product images"
	on storage.objects for update to authenticated
	using (
		storage.objects.bucket_id = 'product-images'
		and (
			(select public.is_admin())
			or exists (
				select 1
				from public.seller_profiles s
				join public.products p on p.seller_profile_id = s.id
				where s.user_id = (select auth.uid())
					and s.status = 'active'
					  and s.id::text = (storage.foldername(storage.objects.name))[1]
					  and p.id::text = (storage.foldername(storage.objects.name))[2]
					and p.status in ('draft', 'pending')
			)
		)
	)
	with check (
		storage.objects.bucket_id = 'product-images'
		and (
			(select public.is_admin())
			or exists (
				select 1
				from public.seller_profiles s
				join public.products p on p.seller_profile_id = s.id
				where s.user_id = (select auth.uid())
					and s.status = 'active'
					  and s.id::text = (storage.foldername(storage.objects.name))[1]
					  and p.id::text = (storage.foldername(storage.objects.name))[2]
					and p.status in ('draft', 'pending')
			)
		)
	);

create policy "Owners and admins delete product images"
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
					and p.status in ('draft', 'pending')
			)
		)
	);
