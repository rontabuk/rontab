drop policy "Visitors read published creator profile media" on storage.objects;
create policy "Visitors read published creator profile media"
	on storage.objects for select to anon, authenticated
	using (
		bucket_id = 'creator-profile-media'
		and exists (
			select 1 from public.creator_profiles profile
			where profile.is_public
				and profile.id::text = (storage.foldername(name))[2]
				and (
					profile.published_profile_image_path = storage.objects.name
					or profile.published_cover_image_path = storage.objects.name
				)
		)
	);