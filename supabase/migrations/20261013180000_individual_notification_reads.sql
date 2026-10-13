create table public.notification_item_reads (
	user_id uuid not null references auth.users (id) on delete cascade,
	notification_id text not null check (notification_id ~ '^(announcement|product)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	read_at timestamptz not null default now(),
	primary key (user_id, notification_id)
);

alter table public.notification_item_reads enable row level security;
revoke all on public.notification_item_reads from public, anon, authenticated;
grant select, insert on public.notification_item_reads to authenticated;

create policy "Users read only their own notification receipts"
	on public.notification_item_reads for select to authenticated
	using (user_id = (select auth.uid()));

create policy "Users add only their own notification receipts"
	on public.notification_item_reads for insert to authenticated
	with check (user_id = (select auth.uid()));

create function public.mark_notification_items_read(p_notification_ids text[])
returns text[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
	reader_id uuid := (select auth.uid());
	valid_ids text[];
	requested_count integer;
begin
	if reader_id is null then
		raise exception 'Sign in to save notification read status.' using errcode = '42501';
	end if;
	if p_notification_ids is null or cardinality(p_notification_ids) not between 1 and 100 then
		raise exception 'Provide between 1 and 100 notification IDs.' using errcode = '22023';
	end if;
	if exists (select 1 from unnest(p_notification_ids) notification_id where notification_id is null or notification_id !~ '^(announcement|product)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
		raise exception 'Invalid notification ID.' using errcode = '22023';
	end if;
	select count(distinct notification_id) into requested_count from unnest(p_notification_ids) notification_id;
	select array_agg(notification_id) into valid_ids from (
		select 'announcement-' || announcement.id::text as notification_id
		from public.site_announcements announcement
		where announcement.is_active and 'announcement-' || announcement.id::text = any(p_notification_ids)
		union
		select 'product-' || product.id::text
		from public.products product
		where product.status = 'approved' and product.published_at is not null
			and 'product-' || product.id::text = any(p_notification_ids)
	) visible_notifications;
	if coalesce(cardinality(valid_ids), 0) <> requested_count then
		raise exception 'Notification unavailable.' using errcode = '42501';
	end if;
	insert into public.notification_item_reads (user_id, notification_id)
	select reader_id, notification_id from unnest(valid_ids) notification_id
	on conflict (user_id, notification_id) do nothing;
	return valid_ids;
end;
$$;

revoke all on function public.mark_notification_items_read(text[]) from public, anon;
grant execute on function public.mark_notification_items_read(text[]) to authenticated;