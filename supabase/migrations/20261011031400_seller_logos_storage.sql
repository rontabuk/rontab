insert into storage.buckets (
	id,
	name,
	public,
	file_size_limit,
	allowed_mime_types
)
values (
	'seller-logos',
	'seller-logos',
	true,
	5242880,
	array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = true,
	file_size_limit = excluded.file_size_limit,
	allowed_mime_types = excluded.allowed_mime_types;

create policy "Shop owners upload their logos"
	on storage.objects for insert to authenticated
	with check (
		bucket_id = 'seller-logos'
		and exists (
			select 1
			from public.seller_profiles s
			where s.id::text = (storage.foldername(name))[1]
				and s.user_id = (select auth.uid())
				and s.status in ('pending', 'active')
		)
	);

create policy "Shop owners update their logos"
	on storage.objects for update to authenticated
	using (
		bucket_id = 'seller-logos'
		and exists (
			select 1
			from public.seller_profiles s
			where s.id::text = (storage.foldername(name))[1]
				and s.user_id = (select auth.uid())
				and s.status in ('pending', 'active')
		)
	)
	with check (
		bucket_id = 'seller-logos'
		and exists (
			select 1
			from public.seller_profiles s
			where s.id::text = (storage.foldername(name))[1]
				and s.user_id = (select auth.uid())
				and s.status in ('pending', 'active')
		)
	);

create policy "Shop owners delete their logos"
	on storage.objects for delete to authenticated
	using (
		bucket_id = 'seller-logos'
		and exists (
			select 1
			from public.seller_profiles s
			where s.id::text = (storage.foldername(name))[1]
				and s.user_id = (select auth.uid())
				and s.status in ('pending', 'active')
		)
	);
