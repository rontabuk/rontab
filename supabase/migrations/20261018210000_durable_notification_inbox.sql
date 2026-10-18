create table public.notification_events (
	notification_id text primary key,
	recipient_id uuid references auth.users (id) on delete cascade,
	audience text not null check (audience in ('everyone', 'visitors', 'sellers', 'personal')),
	kind text not null check (kind in ('welcome', 'announcement', 'new-product', 'loyalty-offer', 'reward-result', 'support-case', 'creator-programme')),
	title text not null,
	body text not null,
	href text,
	link_url text,
	created_at timestamptz not null,
	city_ids text[],
	random_draw boolean not null default false,
	check ((audience = 'personal') = (recipient_id is not null))
);

create index notification_events_broadcast_page_idx on public.notification_events (created_at desc, notification_id desc) where recipient_id is null;
create index notification_events_recipient_page_idx on public.notification_events (recipient_id, created_at desc, notification_id desc) where recipient_id is not null;

create function public.can_read_notification_event(p_event public.notification_events)
returns boolean language sql stable security definer set search_path = '' as $$
	select exists (
		select 1 from auth.users account
		where account.id = (select auth.uid())
			and p_event.created_at <= now()
			and (
				p_event.recipient_id = account.id
				or (p_event.recipient_id is null and p_event.created_at >= account.created_at
					and (p_event.audience = 'everyone'
						or public.is_admin()
						or (p_event.audience = 'sellers' and exists (select 1 from public.seller_profiles seller where seller.user_id = account.id))
						or (p_event.audience = 'visitors' and not exists (select 1 from public.seller_profiles seller where seller.user_id = account.id))))
			)
			and (p_event.kind <> 'loyalty-offer' or (
				public.is_point_earning_visitor(account.id)
				and (p_event.city_ids is null or exists (select 1 from public.profiles profile where profile.id = account.id and profile.city_id::text = any(p_event.city_ids)))
				and (not p_event.random_draw or exists (select 1 from public.marketplace_settings where singleton and loyalty_random_draws_enabled))
			))
	);
$$;
revoke all on function public.can_read_notification_event(public.notification_events) from public, anon;
grant execute on function public.can_read_notification_event(public.notification_events) to authenticated;

alter table public.notification_events enable row level security;
revoke all on public.notification_events from public, anon, authenticated;
grant select on public.notification_events to authenticated;
create policy "Members read eligible inbox events" on public.notification_events for select to authenticated
	using (public.can_read_notification_event(notification_events));

create function public.capture_notification_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
	event_id text;
	event_kind text;
	event_title text;
	event_body text;
	event_href text;
	event_link text;
	event_audience text := 'personal';
	event_recipient uuid;
	event_time timestamptz;
	event_cities text[];
	event_random boolean := false;
begin
	if tg_table_schema = 'auth' and tg_table_name = 'users' then
		event_id := 'welcome-' || new.id::text;
		event_kind := 'welcome';
		event_title := 'Welcome to RonTab';
		event_body := 'Your RonTab account is ready. Find products, discover shops, and keep your account updates here.';
		event_href := '/products';
		event_recipient := new.id;
		event_time := new.created_at;
	elsif tg_table_name = 'site_announcements' then
		if not new.is_active then return new; end if;
		event_id := 'announcement-' || new.id::text;
		event_kind := 'announcement';
		event_title := new.title;
		event_body := new.body;
		event_href := '/notifications/' || new.id::text;
		event_link := new.link_url;
		event_audience := new.audience;
		event_time := new.created_at;
	elsif tg_table_name = 'products' then
		if new.status <> 'approved' or new.published_at is null then return new; end if;
		event_id := 'product-' || new.id::text;
		event_kind := 'new-product';
		event_title := 'New products';
		event_body := new.name;
		event_href := '/products/' || new.slug;
		event_audience := 'everyone';
		event_time := new.published_at;
	elsif tg_table_name = 'loyalty_offers' then
		if new.status <> 'published' then return new; end if;
		event_id := 'offer-' || new.id::text;
		event_kind := 'loyalty-offer';
		event_title := 'New reward offer';
		event_body := new.title;
		event_href := '/visitor/rewards#offer-' || new.id::text;
		event_audience := 'visitors';
		event_time := new.starts_at;
		event_random := new.selection_method = 'random';
		select array_agg(quota.city_id::text) into event_cities from public.loyalty_offer_city_quotas quota where quota.offer_id = new.id;
	elsif tg_table_name = 'loyalty_offer_claims' then
		if new.status not in ('won', 'lost', 'redeemed') then return new; end if;
		event_id := 'result-' || new.id::text;
		event_kind := 'reward-result';
		event_title := case new.status when 'won' then 'You were selected' when 'lost' then 'Draw result' else 'Reward claimed' end;
		select offer.title into event_body from public.loyalty_offers offer where offer.id = new.offer_id;
		event_href := '/visitor/rewards?history=offers';
		event_recipient := new.visitor_id;
		event_time := coalesce(new.result_at, now());
	elsif tg_table_name = 'marketplace_support_cases' then
		if new.updated_at <= new.created_at then return new; end if;
		event_id := 'support-marketplace-' || new.id::text || '-' || floor(extract(epoch from new.updated_at) * 1000000)::bigint::text;
		event_kind := 'support-case';
		event_title := case when new.status = 'resolved' then 'Your report was resolved' else 'Your report is being reviewed' end;
		event_body := coalesce(new.resolution_note, replace(new.status, '_', ' '));
		event_href := '/visitor/support';
		event_recipient := new.reporter_id;
		event_time := new.updated_at;
	elsif tg_table_name = 'creator_notification_events' then
		event_id := 'creator-event-' || new.id::text;
		event_kind := 'creator-programme';
		event_title := new.title;
		event_body := new.body;
		event_href := new.href;
		event_recipient := new.recipient_id;
		event_time := new.created_at;
	end if;
	insert into public.notification_events (notification_id, recipient_id, audience, kind, title, body, href, link_url, created_at, city_ids, random_draw)
	values (event_id, event_recipient, event_audience, event_kind, event_title, coalesce(event_body, ''), event_href, event_link, event_time, event_cities, event_random)
	on conflict (notification_id) do nothing;
	return new;
end;
$$;
revoke all on function public.capture_notification_event() from public, anon, authenticated;

create trigger inbox_welcome after insert on auth.users for each row execute function public.capture_notification_event();
create trigger inbox_announcement after insert or update of is_active on public.site_announcements for each row execute function public.capture_notification_event();
create trigger inbox_product after insert or update of status, published_at on public.products for each row execute function public.capture_notification_event();
create trigger inbox_offer after insert or update of status on public.loyalty_offers for each row execute function public.capture_notification_event();
create trigger inbox_result after insert or update of status on public.loyalty_offer_claims for each row execute function public.capture_notification_event();
create trigger inbox_support after update of status, resolution_note on public.marketplace_support_cases for each row execute function public.capture_notification_event();
create trigger inbox_creator after insert on public.creator_notification_events for each row execute function public.capture_notification_event();

create function public.sync_notification_offer_cities()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
	target_offer_id uuid;
begin
	if tg_op = 'DELETE' then target_offer_id := old.offer_id; else target_offer_id := new.offer_id; end if;
	update public.notification_events event set city_ids = (
		select array_agg(quota.city_id::text) from public.loyalty_offer_city_quotas quota where quota.offer_id = target_offer_id
	) where event.notification_id = 'offer-' || target_offer_id::text;
	return null;
end;
$$;
revoke all on function public.sync_notification_offer_cities() from public, anon, authenticated;
create trigger inbox_offer_cities after insert or update or delete on public.loyalty_offer_city_quotas for each row execute function public.sync_notification_offer_cities();

insert into public.notification_events (notification_id, recipient_id, audience, kind, title, body, href, created_at)
select 'welcome-' || account.id::text, account.id, 'personal', 'welcome', 'Welcome to RonTab',
	'Your RonTab account is ready. Find products, discover shops, and keep your account updates here.', '/products', account.created_at
from auth.users account;
insert into public.notification_events (notification_id, audience, kind, title, body, href, link_url, created_at)
select 'announcement-' || item.id::text, item.audience, 'announcement', item.title, item.body, '/notifications/' || item.id::text, item.link_url, item.created_at
from public.site_announcements item where item.is_active;
insert into public.notification_events (notification_id, audience, kind, title, body, href, created_at)
select 'product-' || item.id::text, 'everyone', 'new-product', 'New products', item.name, '/products/' || item.slug, item.published_at
from public.products item where item.status = 'approved' and item.published_at is not null;
insert into public.notification_events (notification_id, audience, kind, title, body, href, created_at, city_ids, random_draw)
select 'offer-' || item.id::text, 'visitors', 'loyalty-offer', 'New reward offer', item.title, '/visitor/rewards#offer-' || item.id::text, item.starts_at,
	(select array_agg(quota.city_id::text) from public.loyalty_offer_city_quotas quota where quota.offer_id = item.id), item.selection_method = 'random'
from public.loyalty_offers item where item.status in ('published', 'completed');
insert into public.notification_events (notification_id, recipient_id, audience, kind, title, body, href, created_at)
select 'result-' || claim.id::text, claim.visitor_id, 'personal', 'reward-result',
	case claim.status when 'won' then 'You were selected' when 'lost' then 'Draw result' else 'Reward claimed' end,
	offer.title, '/visitor/rewards?history=offers', coalesce(claim.result_at, claim.created_at)
from public.loyalty_offer_claims claim join public.loyalty_offers offer on offer.id = claim.offer_id where claim.status in ('won', 'lost', 'redeemed');
insert into public.notification_events (notification_id, recipient_id, audience, kind, title, body, href, created_at)
select 'creator-event-' || item.id::text, item.recipient_id, 'personal', 'creator-programme', item.title, item.body, item.href, item.created_at
from public.creator_notification_events item;
insert into public.notification_events (notification_id, recipient_id, audience, kind, title, body, href, created_at)
select 'support-marketplace-' || item.id::text || '-' || floor(extract(epoch from item.updated_at) * 1000000)::bigint::text,
	item.reporter_id, 'personal', 'support-case', case when item.status = 'resolved' then 'Your report was resolved' else 'Your report is being reviewed' end,
	coalesce(item.resolution_note, replace(item.status, '_', ' ')), '/visitor/support', item.updated_at
from public.marketplace_support_cases item where item.updated_at > item.created_at;

alter table public.notification_item_reads drop constraint notification_item_reads_notification_id_check;
alter table public.notification_item_reads add constraint notification_item_reads_notification_id_check check (
	notification_id ~ '^(welcome|announcement|product|offer|result|creator-request|creator-response|creator-event)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
	or notification_id ~ '^support-(marketplace|reward|voucher)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9]{16}$'
);

create function public.get_notification_inbox(p_channel text, p_before_time timestamptz default null, p_before_id text default null, p_limit integer default 21)
returns table (notification_id text, kind text, title text, body text, href text, created_at timestamptz, is_read boolean)
language plpgsql stable security invoker set search_path = '' as $$
begin
	if p_channel is null or p_channel not in ('messages', 'ads') or p_limit is null or p_limit not between 1 and 101
		or ((p_before_time is null) <> (p_before_id is null)) then
		raise exception 'Invalid inbox page.' using errcode = '22023';
	end if;
	return query select event.notification_id, event.kind, event.title, event.body, event.href, event.created_at,
		(receipt.notification_id is not null or coalesce(event.created_at <= marker.last_seen_at, false))
	from public.notification_events event
	left join public.notification_item_reads receipt on receipt.user_id = (select auth.uid()) and receipt.notification_id = event.notification_id
	left join public.notification_reads marker on marker.user_id = (select auth.uid())
	where (case when event.kind in ('new-product', 'loyalty-offer') then 'ads' else 'messages' end) = p_channel
		and (p_before_time is null or (event.created_at, event.notification_id) < (p_before_time, p_before_id))
	order by event.created_at desc, event.notification_id desc limit p_limit;
end;
$$;

create function public.get_notification_inbox_counts()
returns table (channel text, unread_count bigint)
language sql stable security invoker set search_path = '' as $$
	select case when event.kind in ('new-product', 'loyalty-offer') then 'ads' else 'messages' end,
		count(*)::bigint
	from public.notification_events event
	left join public.notification_item_reads receipt on receipt.user_id = (select auth.uid()) and receipt.notification_id = event.notification_id
	left join public.notification_reads marker on marker.user_id = (select auth.uid())
	where receipt.notification_id is null and (marker.last_seen_at is null or event.created_at > marker.last_seen_at)
	group by 1;
$$;

create or replace function public.mark_notification_items_read(p_notification_ids text[])
returns text[] language plpgsql security invoker set search_path = '' as $$
declare
	reader_id uuid := (select auth.uid());
	valid_ids text[];
begin
	if reader_id is null then raise exception 'Sign in to save notification read status.' using errcode = '42501'; end if;
	if p_notification_ids is null or cardinality(p_notification_ids) not between 1 and 100
		or exists (select 1 from unnest(p_notification_ids) item where item is null) then
		raise exception 'Provide between 1 and 100 notification IDs.' using errcode = '22023';
	end if;
	select array_agg(event.notification_id) into valid_ids from public.notification_events event where event.notification_id = any(p_notification_ids);
	if coalesce(cardinality(valid_ids), 0) <> (select count(distinct item) from unnest(p_notification_ids) item) then
		raise exception 'Notification unavailable.' using errcode = '42501';
	end if;
	insert into public.notification_item_reads (user_id, notification_id)
	select reader_id, item from unnest(valid_ids) item on conflict (user_id, notification_id) do nothing;
	return valid_ids;
end;
$$;

revoke all on function public.get_notification_inbox(text, timestamptz, text, integer), public.get_notification_inbox_counts() from public, anon;
grant execute on function public.get_notification_inbox(text, timestamptz, text, integer), public.get_notification_inbox_counts() to authenticated;