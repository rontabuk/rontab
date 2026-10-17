drop policy "Creators read their own profile media" on storage.objects;
create policy "Creators read their own profile media"
	on storage.objects for select to authenticated
	using (
		bucket_id = 'creator-profile-media'
		and (storage.foldername(name))[1] = (select auth.uid())::text
		and exists (
			select 1 from public.creator_profiles profile
			where profile.id::text = (storage.foldername(name))[2]
				and (select public.is_creator_profile_owner(profile.id))
		)
	);

drop policy "Creators upload their own profile media" on storage.objects;
create policy "Creators upload their own profile media"
	on storage.objects for insert to authenticated
	with check (
		bucket_id = 'creator-profile-media'
		and (storage.foldername(name))[1] = (select auth.uid())::text
		and (storage.foldername(name))[3] in ('profile', 'cover')
		and exists (
			select 1 from public.creator_profiles profile
			where profile.id::text = (storage.foldername(name))[2]
				and profile.status not in ('suspended', 'withdrawn')
				and (select public.is_creator_profile_owner(profile.id))
		)
	);

drop policy "Creators delete unpublished profile media" on storage.objects;
create policy "Creators delete unpublished profile media"
	on storage.objects for delete to authenticated
	using (
		bucket_id = 'creator-profile-media'
		and (storage.foldername(name))[1] = (select auth.uid())::text
		and exists (
			select 1 from public.creator_profiles profile
			where profile.id::text = (storage.foldername(name))[2]
				and profile.published_profile_image_path is distinct from storage.objects.name
				and profile.published_cover_image_path is distinct from storage.objects.name
				and (select public.is_creator_profile_owner(profile.id))
		)
	);