alter table public.top_video_ads
	add column media_type text not null default 'video' check (media_type in ('video', 'image')),
	add column display_seconds integer not null default 8 check (display_seconds between 3 and 60);

drop function public.admin_create_top_video_ad(text, text, text, boolean, integer);
drop function public.admin_update_top_video_ad(uuid, text, text, boolean, integer);

create function public.admin_create_top_video_ad(
	p_title text,
	p_storage_path text,
	p_media_type text,
	p_display_seconds integer,
	p_target_url text,
	p_is_active boolean,
	p_sort_order integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	saved_id uuid;
begin
	if not public.is_admin() then
		raise exception 'Administrator access required.' using errcode = '42501';
	end if;

	insert into public.top_video_ads (title, storage_path, media_type, display_seconds, target_url, is_active, sort_order)
	values (p_title, p_storage_path, p_media_type, p_display_seconds, p_target_url, p_is_active, p_sort_order)
	returning id into saved_id;

	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values ((select auth.uid()), 'top_video_ad_created', 'top_video_ad', saved_id, jsonb_build_object('title', p_title, 'media_type', p_media_type, 'is_active', p_is_active));

	return saved_id;
end;
$$;

create function public.admin_update_top_video_ad(
	p_ad_id uuid,
	p_title text,
	p_display_seconds integer,
	p_target_url text,
	p_is_active boolean,
	p_sort_order integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not public.is_admin() then
		raise exception 'Administrator access required.' using errcode = '42501';
	end if;

	update public.top_video_ads
	set title = p_title,
		display_seconds = p_display_seconds,
		target_url = p_target_url,
		is_active = p_is_active,
		sort_order = p_sort_order,
		updated_at = now()
	where id = p_ad_id;

	if not found then
		raise exception 'Video ad not found.' using errcode = 'P0002';
	end if;

	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values ((select auth.uid()), 'top_video_ad_updated', 'top_video_ad', p_ad_id, jsonb_build_object('title', p_title, 'is_active', p_is_active));
end;
$$;

revoke all on function public.admin_create_top_video_ad(text, text, text, integer, text, boolean, integer) from anon, public;
revoke all on function public.admin_update_top_video_ad(uuid, text, integer, text, boolean, integer) from anon, public;
grant execute on function public.admin_create_top_video_ad(text, text, text, integer, text, boolean, integer) to authenticated;
grant execute on function public.admin_update_top_video_ad(uuid, text, integer, text, boolean, integer) to authenticated;

update storage.buckets
set allowed_mime_types = array['video/mp4', 'video/webm', 'image/jpeg', 'image/png', 'image/webp']::text[]
where id = 'top-video-ads';
