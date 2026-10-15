alter table public.notification_item_reads
	drop constraint notification_item_reads_notification_id_check,
	add constraint notification_item_reads_notification_id_check
	check (
		notification_id ~ '^(announcement|product|offer|result)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
		or notification_id ~ '^support-(marketplace|reward|voucher)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9]{16}$'
		or notification_id ~ '^creator-(request|response|event)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
	);

create table public.creator_notification_events (
	id uuid primary key default gen_random_uuid(),
	recipient_id uuid not null references auth.users (id) on delete cascade,
	event_type text not null check (event_type in (
		'collaboration_request_received',
		'collaboration_request_accepted',
		'collaboration_request_declined',
		'collaboration_request_withdrawn',
		'creator_profile_approved',
		'creator_profile_changes_requested',
		'creator_profile_rejected',
		'creator_profile_suspended',
		'creator_profile_reinstated',
		'creator_profile_unavailable',
		'creator_profile_restored'
	)),
	title text not null check (length(btrim(title)) between 1 and 120),
	body text not null check (length(btrim(body)) between 1 and 2000),
	href text not null check (href ~ '^/'),
	created_at timestamptz not null default now()
);
create index creator_notification_events_recipient_idx
	on public.creator_notification_events (recipient_id, created_at desc);

alter table public.creator_notification_events enable row level security;
revoke all on public.creator_notification_events from public, anon, authenticated;

create function public.record_creator_profile_review_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	creator public.creator_profiles%rowtype;
	notification_title text;
	notification_body text;
begin
	select * into creator
	from public.creator_profiles
	where id = new.creator_profile_id;
	if not found then return new; end if;

	notification_title := case new.decision
		when 'approved' then 'Creator profile approved'
		when 'changes_requested' then 'Changes requested for your profile'
		when 'rejected' then 'Creator application not approved'
		when 'suspended' then 'Creator profile suspended'
		when 'reinstated' then 'Creator profile restored'
	end;
	notification_body := case new.decision
		when 'approved' then 'Your creator profile is now public.'
		when 'changes_requested' then 'Please update your application. ' || coalesce(new.review_note, '')
		when 'rejected' then 'Your application was not approved. ' || coalesce(new.review_note, '')
		when 'suspended' then 'Your profile is hidden while this issue is reviewed. ' || coalesce(new.review_note, '')
		when 'reinstated' then 'Your profile has been restored to its previous status.'
	end;
	insert into public.creator_notification_events (recipient_id, event_type, title, body, href)
	values (
		creator.owner_id,
		'creator_profile_' || new.decision,
		notification_title,
		notification_body,
		'/visitor/creator'
	);
	return new;
end;
$$;

create trigger creator_profile_review_notification_after_insert
	after insert on public.creator_profile_reviews
	for each row execute function public.record_creator_profile_review_notification();

create function public.record_creator_collaboration_request_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	creator_owner_id uuid;
	shop_name text;
begin
	select creator.owner_id, seller.shop_name into creator_owner_id, shop_name
	from public.creator_profiles creator
	join public.seller_profiles seller on seller.id = new.seller_profile_id
	where creator.id = new.creator_profile_id;
	if creator_owner_id is null then return new; end if;

	insert into public.creator_notification_events (recipient_id, event_type, title, body, href)
	values (
		creator_owner_id,
		'collaboration_request_received',
		'New collaboration request',
		coalesce(shop_name, 'A Rontab seller') || ': ' || new.title,
		'/visitor/creator#creator-collaboration-title'
	);
	return new;
end;
$$;

create trigger creator_collaboration_request_notification_after_insert
	after insert on public.creator_collaboration_requests
	for each row execute function public.record_creator_collaboration_request_notification();

create function public.record_creator_collaboration_status_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	notification_recipient uuid;
	creator_name text;
	shop_name text;
	notification_type text;
	notification_title text;
	notification_body text;
	notification_href text;
begin
	if new.status is not distinct from old.status then return new; end if;
	select creator.owner_id, coalesce(creator.published_display_name, creator.display_name), seller.shop_name
	into notification_recipient, creator_name, shop_name
	from public.creator_profiles creator
	join public.seller_profiles seller on seller.id = new.seller_profile_id
	where creator.id = new.creator_profile_id;

	if new.status in ('accepted', 'declined') then
		select user_id into notification_recipient
		from public.seller_profiles where id = new.seller_profile_id;
		notification_type := 'collaboration_request_' || new.status;
		notification_title := case new.status
			when 'accepted' then 'Creator accepted your request'
			else 'Creator declined your request'
		end;
		notification_body := creator_name || ': ' || new.title;
		if new.creator_response is not null then
			notification_body := notification_body || ' · ' || new.creator_response;
		end if;
		notification_href := '/seller/creator-requests';
	elsif new.status = 'withdrawn' then
		notification_type := 'collaboration_request_withdrawn';
		notification_title := 'Seller withdrew a collaboration request';
		notification_body := coalesce(shop_name, 'A Rontab seller') || ': ' || new.title;
		notification_href := '/visitor/creator#creator-collaboration-title';
	else
		return new;
	end if;

	if notification_recipient is not null then
		insert into public.creator_notification_events (recipient_id, event_type, title, body, href)
		values (notification_recipient, notification_type, notification_title, notification_body, notification_href);
	end if;
	return new;
end;
$$;

create trigger creator_collaboration_status_notification_after_update
	after update of status on public.creator_collaboration_requests
	for each row execute function public.record_creator_collaboration_status_notification();

create function public.record_creator_public_availability_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	request record;
	event_type text;
	notification_title text;
	notification_body text;
begin
	if new.is_public is not distinct from old.is_public then return new; end if;
	if new.is_public then
		event_type := 'creator_profile_restored';
		notification_title := 'Creator profile is available again';
		notification_body := coalesce(new.published_display_name, new.display_name) || ' is available again. Your pending request remains open.';
	else
		event_type := 'creator_profile_unavailable';
		notification_title := 'Creator profile is temporarily unavailable';
		notification_body := coalesce(new.published_display_name, new.display_name) || ' is unavailable. Your pending request remains open.';
	end if;

	for request in
		select seller.user_id, collaboration.title
		from public.creator_collaboration_requests collaboration
		join public.seller_profiles seller on seller.id = collaboration.seller_profile_id
		where collaboration.creator_profile_id = new.id and collaboration.status = 'pending'
	loop
		insert into public.creator_notification_events (recipient_id, event_type, title, body, href)
		values (request.user_id, event_type, notification_title, notification_body || ' Request: ' || request.title, '/seller/creator-requests');
	end loop;
	return new;
end;
$$;

create trigger creator_public_availability_notification_after_update
	after update of is_public on public.creator_profiles
	for each row execute function public.record_creator_public_availability_notification();

create or replace function public.get_creator_collaboration_notifications()
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
	select 'creator-event-' || event.id::text, event.title, event.body, event.href, event.created_at
	from public.creator_notification_events event
	where event.recipient_id = (select auth.uid())
	order by event.created_at desc, event.id desc
	limit 100;
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
			and notification_id !~ '^creator-(request|response|event)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
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
		select creator_event.notification_id
		from public.get_creator_collaboration_notifications() creator_event
		where creator_event.notification_id = any(p_notification_ids)
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

revoke all on function public.record_creator_profile_review_notification() from public, anon, authenticated;
revoke all on function public.record_creator_collaboration_request_notification() from public, anon, authenticated;
revoke all on function public.record_creator_collaboration_status_notification() from public, anon, authenticated;
revoke all on function public.record_creator_public_availability_notification() from public, anon, authenticated;
revoke all on function public.get_creator_collaboration_notifications() from public, anon;
grant execute on function public.get_creator_collaboration_notifications() to authenticated;
revoke all on function public.mark_notification_items_read(text[]) from public, anon;
grant execute on function public.mark_notification_items_read(text[]) to authenticated;