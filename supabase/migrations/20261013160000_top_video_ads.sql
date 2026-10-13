create table public.top_video_ads (
	id uuid primary key default gen_random_uuid(),
	title text not null check (char_length(title) between 1 and 120),
	storage_path text not null unique check (char_length(storage_path) between 1 and 300),
	target_url text check (target_url is null or target_url ~ '^https://'),
	is_active boolean not null default true,
	sort_order integer not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

alter table public.top_video_ads enable row level security;
revoke all on public.top_video_ads from anon, authenticated;
grant select on public.top_video_ads to anon, authenticated;

create policy "Everyone reads active top video ads"
	on public.top_video_ads for select to anon, authenticated
	using (is_active or (select public.is_admin()));

create or replace function public.admin_create_top_video_ad(
	p_title text,
	p_storage_path text,
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

	insert into public.top_video_ads (title, storage_path, target_url, is_active, sort_order)
	values (p_title, p_storage_path, p_target_url, p_is_active, p_sort_order)
	returning id into saved_id;

	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values ((select auth.uid()), 'top_video_ad_created', 'top_video_ad', saved_id, jsonb_build_object('title', p_title, 'is_active', p_is_active));

	return saved_id;
end;
$$;

create or replace function public.admin_update_top_video_ad(
	p_ad_id uuid,
	p_title text,
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

create or replace function public.admin_delete_top_video_ad(p_ad_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
	deleted_path text;
begin
	if not public.is_admin() then
		raise exception 'Administrator access required.' using errcode = '42501';
	end if;

	delete from public.top_video_ads where id = p_ad_id returning storage_path into deleted_path;

	if not found then
		raise exception 'Video ad not found.' using errcode = 'P0002';
	end if;

	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values ((select auth.uid()), 'top_video_ad_deleted', 'top_video_ad', p_ad_id, jsonb_build_object('storage_path', deleted_path));

	return deleted_path;
end;
$$;

revoke all on function public.admin_create_top_video_ad(text, text, text, boolean, integer) from anon, public;
revoke all on function public.admin_update_top_video_ad(uuid, text, text, boolean, integer) from anon, public;
revoke all on function public.admin_delete_top_video_ad(uuid) from anon, public;
grant execute on function public.admin_create_top_video_ad(text, text, text, boolean, integer) to authenticated;
grant execute on function public.admin_update_top_video_ad(uuid, text, text, boolean, integer) to authenticated;
grant execute on function public.admin_delete_top_video_ad(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('top-video-ads', 'top-video-ads', true, 52428800, array['video/mp4', 'video/webm']::text[])
on conflict (id) do update
set public = true,
	file_size_limit = excluded.file_size_limit,
	allowed_mime_types = excluded.allowed_mime_types;

create policy "Admins read top video ad files"
	on storage.objects for select to authenticated
	using (bucket_id = 'top-video-ads' and (select public.is_admin()));

create policy "Admins upload top video ad files"
	on storage.objects for insert to authenticated
	with check (bucket_id = 'top-video-ads' and (select public.is_admin()));

create policy "Admins delete top video ad files"
	on storage.objects for delete to authenticated
	using (bucket_id = 'top-video-ads' and (select public.is_admin()));
