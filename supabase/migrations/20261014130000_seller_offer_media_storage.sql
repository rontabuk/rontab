insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
	'seller-offer-media',
	'seller-offer-media',
	true,
	52428800,
	array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']::text[]
)
on conflict (id) do update
set public = excluded.public,
	file_size_limit = excluded.file_size_limit,
	allowed_mime_types = excluded.allowed_mime_types;

create policy "Active sellers upload media for editable offer requests"
	on storage.objects for insert to authenticated
	with check (
		bucket_id = 'seller-offer-media'
		and exists (
			select 1
			from public.seller_profiles seller
			join public.seller_offer_requests request on request.seller_profile_id = seller.id
			where seller.user_id = (select auth.uid())
				and seller.status = 'active'
				and seller.id::text = (storage.foldername(name))[1]
				and request.id::text = (storage.foldername(name))[2]
				and request.status in ('draft', 'changes_requested')
		)
	);

create policy "Active sellers remove media for editable offer requests"
	on storage.objects for delete to authenticated
	using (
		bucket_id = 'seller-offer-media'
		and exists (
			select 1
			from public.seller_profiles seller
			join public.seller_offer_requests request on request.seller_profile_id = seller.id
			where seller.user_id = (select auth.uid())
				and seller.status = 'active'
				and seller.id::text = (storage.foldername(name))[1]
				and request.id::text = (storage.foldername(name))[2]
				and request.status in ('draft', 'changes_requested')
		)
	);