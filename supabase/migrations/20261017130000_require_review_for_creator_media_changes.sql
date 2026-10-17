create function public.submit_creator_profile_media_changes_for_review()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	if old.status = 'approved'
		and old.is_public
		and (
			new.profile_image_path is distinct from old.profile_image_path
			or new.cover_image_path is distinct from old.cover_image_path
		) then
		new.status := 'submitted';
		new.submitted_at := now();
		new.reviewed_at := null;
	end if;
	return new;
end;
$$;

create trigger creator_profile_media_changes_require_review
	before update of profile_image_path, cover_image_path on public.creator_profiles
	for each row execute function public.submit_creator_profile_media_changes_for_review();