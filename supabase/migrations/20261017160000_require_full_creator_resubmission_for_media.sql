create or replace function public.submit_creator_profile_media_changes_for_review()
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
		raise exception 'Resubmit the full creator profile before changing its published images.' using errcode = '55000';
	end if;
	return new;
end;
$$;