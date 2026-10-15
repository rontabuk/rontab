alter table public.notification_item_reads
	drop constraint notification_item_reads_notification_id_check,
	add constraint notification_item_reads_notification_id_check
	check (
		notification_id ~ '^(announcement|product|offer|result)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
		or notification_id ~ '^support-(marketplace|reward|voucher)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9]{16}$'
		or notification_id ~ '^creator-(request|response)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
	);

create function public.get_creator_collaboration_notifications()
returns table (
	notification_id text,
	title text,
	body text,
	href text,
	created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
	select
		case when request.status = 'pending'
			then 'creator-request-' || request.id::text
			else 'creator-response-' || request.id::text end,
		case when request.status = 'pending' then 'New collaboration request' else 'Collaboration request updated' end,
		case when request.status = 'pending'
			then coalesce(seller.shop_name, 'A Rontab seller') || ': ' || request.title
			else coalesce(seller.shop_name, 'A Rontab seller') || ' · ' || request.title || ' · ' || request.status end,
		'/visitor/creator#creator-collaboration-title',
		case when request.status = 'pending' then request.created_at else request.responded_at end
	from public.creator_collaboration_requests request
	join public.creator_profiles creator on creator.id = request.creator_profile_id
	join public.seller_profiles seller on seller.id = request.seller_profile_id
	where creator.owner_id = (select auth.uid())
		and request.status in ('pending', 'accepted', 'declined')
	order by case when request.status = 'pending' then request.created_at else request.responded_at end desc
	limit 50;
$$;

create function public.seller_withdraw_creator_collaboration_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	request public.creator_collaboration_requests%rowtype;
begin
	if (select auth.uid()) is null or p_request_id is null then
		raise exception 'Sign in as the seller who created this request.' using errcode = '42501';
	end if;
	select * into request
	from public.creator_collaboration_requests
	where id = p_request_id
	for update;
	if not found or not exists (
		select 1 from public.seller_profiles seller
		where seller.id = request.seller_profile_id and seller.user_id = (select auth.uid())
	) then
		raise exception 'Collaboration request not found.' using errcode = '42501';
	end if;
	if request.status <> 'pending' then
		raise exception 'Only pending collaboration requests can be withdrawn.' using errcode = '55000';
	end if;
	update public.creator_collaboration_requests
	set status = 'withdrawn', responded_at = now()
	where id = p_request_id;
end;
$$;

create or replace function public.mark_notification_items_read(p_notification_ids text[])
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
	if exists (
		select 1 from unnest(p_notification_ids) notification_id
		where notification_id is null
			or notification_id !~ '^(announcement|product|offer|result)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
			and notification_id !~ '^support-(marketplace|reward|voucher)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9]{16}$'
			and notification_id !~ '^creator-(request|response)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
	) then
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
		union
		select 'offer-' || offer.id::text
		from public.get_visitor_loyalty_offers() offer
		where 'offer-' || offer.id::text = any(p_notification_ids)
		union
		select 'result-' || claim.id::text
		from public.loyalty_offer_claims claim
		where claim.visitor_id = reader_id and claim.status in ('won', 'lost', 'redeemed')
			and 'result-' || claim.id::text = any(p_notification_ids)
		union
		select support.notification_id
		from public.get_visitor_marketplace_support_notifications() support
		where support.notification_id = any(p_notification_ids)
		union
		select creator_request.notification_id
		from public.get_creator_collaboration_notifications() creator_request
		where creator_request.notification_id = any(p_notification_ids)
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

revoke all on function public.get_creator_collaboration_notifications() from public, anon;
revoke all on function public.seller_withdraw_creator_collaboration_request(uuid) from public, anon;
grant execute on function public.get_creator_collaboration_notifications() to authenticated;
grant execute on function public.seller_withdraw_creator_collaboration_request(uuid) to authenticated;
revoke all on function public.mark_notification_items_read(text[]) from public, anon;
grant execute on function public.mark_notification_items_read(text[]) to authenticated;