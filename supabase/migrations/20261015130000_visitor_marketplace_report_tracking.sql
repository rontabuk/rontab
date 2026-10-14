alter table public.notification_item_reads
	drop constraint notification_item_reads_notification_id_check,
	add constraint notification_item_reads_notification_id_check
		check (
			notification_id ~ '^(announcement|product|offer|result)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
			or notification_id ~ '^support-(marketplace|reward|voucher)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9]{16}$'
		);

create or replace function public.get_visitor_marketplace_support_cases(p_limit integer, p_offset integer)
returns table (
	case_id uuid,
	target_type text,
	target_name text,
	issue_type text,
	description text,
	status text,
	resolution_note text,
	created_at timestamptz,
	updated_at timestamptz,
	total_case_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	current_visitor_id uuid := (select auth.uid());
begin
	if current_visitor_id is null then
		raise exception 'Sign in to view your reports.' using errcode = '42501';
	end if;
	if p_limit is null or p_limit not between 1 and 100
		or p_offset is null or p_offset not between 0 and 100000 then
		raise exception 'Invalid marketplace report page.' using errcode = '22023';
	end if;
	return query
	select support_case.id, support_case.target_type,
		coalesce(product.name, seller.shop_name, 'Removed marketplace item')::text,
		support_case.issue_type, support_case.description, support_case.status,
		support_case.resolution_note, support_case.created_at, support_case.updated_at,
		count(*) over ()::bigint
	from public.marketplace_support_cases support_case
	left join public.products product on support_case.target_type = 'product' and product.id = support_case.target_id
	left join public.seller_profiles seller on support_case.target_type = 'seller_account' and seller.id = support_case.target_id
	where support_case.reporter_id = current_visitor_id
	order by support_case.created_at desc, support_case.id desc
	limit p_limit offset p_offset;
end;
$$;

create function public.get_visitor_marketplace_support_notifications()
returns table (
	notification_id text,
	target_name text,
	status text,
	resolution_note text,
	updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	current_visitor_id uuid := (select auth.uid());
begin
	if current_visitor_id is null then
		return;
	end if;
	return query
	with changed_cases as (
		select 'marketplace'::text as case_type, support_case.id, support_case.status,
			support_case.resolution_note, support_case.created_at, support_case.updated_at,
			coalesce(product.name, seller.shop_name, 'Removed marketplace item')::text as target_name
		from public.marketplace_support_cases support_case
		left join public.products product on support_case.target_type = 'product' and product.id = support_case.target_id
		left join public.seller_profiles seller on support_case.target_type = 'seller_account' and seller.id = support_case.target_id
		where support_case.reporter_id = current_visitor_id
	)
	select ('support-' || changed_cases.case_type || '-' || changed_cases.id::text || '-'
		|| floor(extract(epoch from changed_cases.updated_at) * 1000000)::bigint::text),
		changed_cases.target_name, changed_cases.status, changed_cases.resolution_note, changed_cases.updated_at
	from changed_cases
	where changed_cases.updated_at > changed_cases.created_at
	order by changed_cases.updated_at desc, changed_cases.id desc
	limit 30;
end;
$$;

create or replace function public.admin_update_marketplace_support_case(
	p_case_id uuid,
	p_status text,
	p_resolution_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	current_case public.marketplace_support_cases%rowtype;
	note_text text := btrim(coalesce(p_resolution_note, ''));
	next_note text;
begin
	if not (select public.is_admin()) then
		raise exception 'Administrator access is required.' using errcode = '42501';
	end if;
	if p_case_id is null or p_status is null or p_status not in ('open', 'in_review', 'resolved')
		or (p_status = 'resolved' and length(note_text) not between 5 and 1000)
		or length(note_text) > 1000 then
		raise exception 'Add a resolution note and choose a valid case status.' using errcode = '22023';
	end if;
	select * into current_case from public.marketplace_support_cases
	where id = p_case_id for update;
	if not found then raise exception 'Marketplace report not found.' using errcode = 'P0002'; end if;
	next_note := case when p_status = 'resolved' then note_text else null end;
	if current_case.status = p_status and current_case.resolution_note is not distinct from next_note then
		return;
	end if;
	update public.marketplace_support_cases
	set status = p_status,
		resolution_note = next_note,
		resolved_by = case when p_status = 'resolved' then (select auth.uid()) else null end,
		resolved_at = case when p_status = 'resolved' then now() else null end,
		updated_at = greatest(clock_timestamp(), current_case.updated_at + interval '1 microsecond')
	where id = p_case_id;
	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values (
		(select auth.uid()), 'marketplace_support_case_updated',
		'marketplace_support_case', p_case_id,
		jsonb_build_object('target_type', current_case.target_type, 'target_id', current_case.target_id,
			'issue_type', current_case.issue_type, 'from_status', current_case.status,
			'to_status', p_status, 'resolution_note', next_note)
	);
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

revoke all on function public.get_visitor_marketplace_support_cases(integer, integer) from public, anon;
revoke all on function public.get_visitor_marketplace_support_notifications() from public, anon;
grant execute on function public.get_visitor_marketplace_support_cases(integer, integer) to authenticated;
grant execute on function public.get_visitor_marketplace_support_notifications() to authenticated;