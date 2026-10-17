alter table public.creator_profiles
	add column profile_image_path text,
	add column cover_image_path text,
	add column published_profile_image_path text,
	add column published_cover_image_path text,
	add constraint creator_profile_image_path_length_check
		check (profile_image_path is null or length(profile_image_path) <= 500),
	add constraint creator_cover_image_path_length_check
		check (cover_image_path is null or length(cover_image_path) <= 500),
	add constraint creator_published_profile_image_path_length_check
		check (published_profile_image_path is null or length(published_profile_image_path) <= 500),
	add constraint creator_published_cover_image_path_length_check
		check (published_cover_image_path is null or length(published_cover_image_path) <= 500);

grant select (profile_image_path, cover_image_path) on public.creator_profiles to authenticated;
grant select (published_profile_image_path, published_cover_image_path)
	on public.creator_profiles to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
	'creator-profile-media',
	'creator-profile-media',
	false,
	5242880,
	array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = false,
	file_size_limit = excluded.file_size_limit,
	allowed_mime_types = excluded.allowed_mime_types;

create policy "Creators read their own profile media"
	on storage.objects for select to authenticated
	using (
		bucket_id = 'creator-profile-media'
		and exists (
			select 1 from public.creator_profiles profile
			where profile.id::text = (storage.foldername(name))[2]
				and profile.owner_id = (select auth.uid())
				and profile.owner_id::text = (storage.foldername(name))[1]
		)
	);

create policy "Visitors read published creator profile media"
	on storage.objects for select to anon, authenticated
	using (
		bucket_id = 'creator-profile-media'
		and exists (
			select 1 from public.creator_profiles profile
			where profile.is_public
				and profile.id::text = (storage.foldername(name))[2]
				and profile.owner_id::text = (storage.foldername(name))[1]
				and (
					profile.published_profile_image_path = storage.objects.name
					or profile.published_cover_image_path = storage.objects.name
				)
		)
	);

create policy "Admins read creator profile media"
	on storage.objects for select to authenticated
	using (bucket_id = 'creator-profile-media' and (select public.is_admin()));

create policy "Creators upload their own profile media"
	on storage.objects for insert to authenticated
	with check (
		bucket_id = 'creator-profile-media'
		and (storage.foldername(name))[1] = (select auth.uid())::text
		and exists (
			select 1 from public.creator_profiles profile
			where profile.id::text = (storage.foldername(name))[2]
				and profile.owner_id = (select auth.uid())
				and profile.status not in ('suspended', 'withdrawn')
		)
		and (storage.foldername(name))[3] in ('profile', 'cover')
	);

create policy "Creators delete unpublished profile media"
	on storage.objects for delete to authenticated
	using (
		bucket_id = 'creator-profile-media'
		and (storage.foldername(name))[1] = (select auth.uid())::text
		and exists (
			select 1 from public.creator_profiles profile
			where profile.id::text = (storage.foldername(name))[2]
				and profile.owner_id = (select auth.uid())
				and profile.published_profile_image_path is distinct from storage.objects.name
				and profile.published_cover_image_path is distinct from storage.objects.name
		)
	);

create policy "Admins delete creator profile media"
	on storage.objects for delete to authenticated
	using (bucket_id = 'creator-profile-media' and (select public.is_admin()));

create function public.creator_save_profile_media_paths(
	p_profile_image_path text,
	p_cover_image_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	current_user_id uuid := (select auth.uid());
	creator_profile_id uuid;
	creator_status text;
begin
	if current_user_id is null then
		raise exception 'A signed-in creator account is required.' using errcode = '42501';
	end if;

	select profile.id, profile.status
	into creator_profile_id, creator_status
	from public.creator_profiles profile
	where profile.owner_id = current_user_id
	for update;

	if creator_profile_id is null then
		raise exception 'A creator application is required.' using errcode = 'P0002';
	end if;
	if creator_status = 'suspended' then
		raise exception 'This creator profile is suspended.' using errcode = '55000';
	end if;

	if p_profile_image_path is not null and (
		length(p_profile_image_path) > 500
		or (storage.foldername(p_profile_image_path))[1] <> current_user_id::text
		or (storage.foldername(p_profile_image_path))[2] <> creator_profile_id::text
		or (storage.foldername(p_profile_image_path))[3] <> 'profile'
		or not exists (
			select 1 from storage.objects object
			where object.bucket_id = 'creator-profile-media' and object.name = p_profile_image_path
		)
	) then
		raise exception 'The creator profile image is invalid.' using errcode = '22023';
	end if;
	if p_cover_image_path is not null and (
		length(p_cover_image_path) > 500
		or (storage.foldername(p_cover_image_path))[1] <> current_user_id::text
		or (storage.foldername(p_cover_image_path))[2] <> creator_profile_id::text
		or (storage.foldername(p_cover_image_path))[3] <> 'cover'
		or not exists (
			select 1 from storage.objects object
			where object.bucket_id = 'creator-profile-media' and object.name = p_cover_image_path
		)
	) then
		raise exception 'The creator cover image is invalid.' using errcode = '22023';
	end if;

	update public.creator_profiles
	set profile_image_path = p_profile_image_path,
		cover_image_path = p_cover_image_path
	where id = creator_profile_id;
end;
$$;

revoke all on function public.creator_save_profile_media_paths(text, text) from public, anon;
grant execute on function public.creator_save_profile_media_paths(text, text) to authenticated;

create function public.publish_creator_profile_media()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	if new.status = 'approved' and old.status is distinct from 'approved' then
		new.published_profile_image_path := new.profile_image_path;
		new.published_cover_image_path := new.cover_image_path;
	end if;
	return new;
end;
$$;

create trigger publish_creator_profile_media_before_approval
	before update of status on public.creator_profiles
	for each row execute function public.publish_creator_profile_media();