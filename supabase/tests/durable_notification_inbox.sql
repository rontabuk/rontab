insert into auth.users (id, email, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, email_confirmed_at)
values
  ('a1000000-0000-4000-8000-000000000001', 'inbox-existing@example.test', 'authenticated', 'authenticated', '{}', '{}', now() - interval '120 days', now(), now()),
  ('a1000000-0000-4000-8000-000000000002', 'inbox-new@example.test', 'authenticated', 'authenticated', '{}', '{}', now(), now(), now());

insert into public.site_announcements (id, title, body, audience, created_at)
select ('b1000000-0000-4000-8000-' || lpad(sequence::text, 12, '0'))::uuid,
  'Historical message ' || sequence, 'Saved message content', 'everyone', now() - interval '90 days'
from generate_series(1, 65) sequence;

update public.site_announcements set is_active = false where id = 'b1000000-0000-4000-8000-000000000001';

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
set local role authenticated;

do $$
declare
  first_page text[];
  next_page text[];
  cursor_time timestamptz;
  cursor_id text;
begin
  assert (select count(*) from public.notification_events where kind = 'welcome') = 1, 'A member must see exactly their own welcome message';
  assert (select count(*) from public.notification_events where notification_id like 'announcement-b1000000%') = 65, 'Old unread messages must survive the old 60-day window and withdrawal';
  assert (select unread_count from public.get_notification_inbox_counts() where channel = 'messages') = 66, 'Unread counts must include messages beyond the loaded page';
  select array_agg(notification_id order by created_at desc, notification_id desc) into first_page from public.get_notification_inbox('messages', null, null, 21);
  assert cardinality(first_page) = 21, 'The first page must be bounded';
  select created_at, notification_id into cursor_time, cursor_id from public.get_notification_inbox('messages', null, null, 21) offset 20 limit 1;
  select array_agg(notification_id) into next_page from public.get_notification_inbox('messages', cursor_time, cursor_id, 21);
  assert not first_page && next_page, 'Tied timestamps must not repeat between pages';
  perform public.mark_notification_items_read(array['announcement-b1000000-0000-4000-8000-000000000001']);
  perform public.mark_notification_items_read(array['announcement-b1000000-0000-4000-8000-000000000001']);
  assert (select unread_count from public.get_notification_inbox_counts() where channel = 'messages') = 65, 'Repeated reads must be idempotent';
  assert (select count(*) from public.notification_item_reads where notification_id = 'announcement-b1000000-0000-4000-8000-000000000001') = 1;
  begin
    perform public.mark_notification_items_read(array['welcome-a1000000-0000-4000-8000-000000000002']);
    raise exception 'A member must not mark another member message as read';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.get_notification_inbox('messages', now(), null, 21);
    raise exception 'An incomplete cursor must not be accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true);
set local role authenticated;

do $$
begin
  assert (select count(*) from public.notification_events) = 1, 'New members must not receive historical broadcasts or another member welcome';
  assert (select notification_id from public.get_notification_inbox('messages')) = 'welcome-a1000000-0000-4000-8000-000000000002';
  assert not exists (select 1 from public.notification_item_reads), 'Read receipts must not cross accounts';
end;
$$;

reset role;
insert into public.creator_notification_events (id, recipient_id, event_type, title, body, href)
values ('c1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'collaboration_request_received', 'Private collaboration', 'Only for the existing member', '/creators');
set local role authenticated;
do $$ begin
  assert not exists (select 1 from public.notification_events where notification_id = 'creator-event-c1000000-0000-4000-8000-000000000001'), 'Private events must not leak to another account';
end; $$;

reset role;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
set local role authenticated;
do $$ begin
  assert (select is_read from public.get_notification_inbox('messages', null, null, 100) where notification_id = 'announcement-b1000000-0000-4000-8000-000000000001'), 'A later session must observe the saved read receipt';
  assert exists (select 1 from public.notification_events where notification_id = 'creator-event-c1000000-0000-4000-8000-000000000001'), 'An offline member must receive a captured personal event';
  assert exists (select 1 from public.get_notification_inbox('messages') where is_read = false), 'Reading one message must not read the entire inbox';
end; $$;
reset role;

do $$
begin
  assert not has_table_privilege('anon', 'public.notification_events', 'select'), 'Guests must not read durable inbox events';
  assert not has_table_privilege('authenticated', 'public.notification_events', 'insert'), 'Members must not forge delivered notifications';
  assert not has_function_privilege('authenticated', 'public.capture_notification_event()', 'execute'), 'Notification capture must remain trigger-only';
end;
$$;

insert into public.notification_events (notification_id, audience, kind, title, body, href, created_at)
values ('product-d1000000-0000-4000-8000-000000000001', 'everyone', 'new-product', 'Future product', 'Not available yet', '/products/future', now() + interval '1 day');
set local role authenticated;
do $$ begin
  assert not exists (select 1 from public.notification_events where notification_id = 'product-d1000000-0000-4000-8000-000000000001'), 'Future events must not be delivered early';
end; $$;
reset role;