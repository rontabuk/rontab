alter table public.loyalty_offer_claims add column result_at timestamptz;

update public.loyalty_offer_claims
set result_at = created_at
where status in ('won', 'lost', 'redeemed');

create function public.set_loyalty_claim_result_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	if new.status in ('won', 'lost', 'redeemed') then
		if tg_op = 'INSERT' or old.status is distinct from new.status then
			new.result_at := now();
		end if;
	else
		new.result_at := null;
	end if;
	return new;
end;
$$;

create trigger set_loyalty_claim_result_at
	before insert or update of status on public.loyalty_offer_claims
	for each row execute function public.set_loyalty_claim_result_at();

alter table public.notification_item_reads
	drop constraint notification_item_reads_notification_id_check,
	add constraint notification_item_reads_notification_id_check
		check (notification_id ~ '^(announcement|product|offer|result)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

create table public.loyalty_claim_support_cases (
	id uuid primary key default gen_random_uuid(),
	claim_id uuid not null unique references public.loyalty_offer_claims (id) on delete cascade,
	visitor_id uuid not null references auth.users (id) on delete cascade,
	issue_type text not null check (issue_type in ('not_received', 'incorrect_reward', 'damaged', 'other')),
	description text not null check (length(btrim(description)) between 10 and 2000),
	status text not null default 'open' check (status in ('open', 'in_review', 'resolved')),
	resolution_note text,
	resolved_by uuid references auth.users (id) on delete set null,
	resolved_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	check ((status = 'resolved' and resolved_at is not null and resolved_by is not null and length(btrim(coalesce(resolution_note, ''))) >= 5)
		or (status <> 'resolved' and resolved_at is null and resolved_by is null))
);

create index loyalty_claim_support_cases_queue_idx
	on public.loyalty_claim_support_cases (status, created_at, id);

alter table public.loyalty_claim_support_cases enable row level security;
revoke all on public.loyalty_claim_support_cases from public, anon, authenticated;
grant select on public.loyalty_claim_support_cases to authenticated;

create policy "Visitors and admins read loyalty claim support cases"
	on public.loyalty_claim_support_cases for select to authenticated
	using (visitor_id = (select auth.uid()) or (select public.is_admin()));

create function public.visitor_report_loyalty_claim_issue(
	p_claim_id uuid,
	p_issue_type text,
	p_description text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	current_visitor_id uuid := (select auth.uid());
	claim public.loyalty_offer_claims%rowtype;
	case_id uuid;
begin
	if current_visitor_id is null or not public.is_supported_loyalty_visitor(current_visitor_id) then
		raise exception 'A verified visitor account is required.' using errcode = '42501';
	end if;
	if p_claim_id is null or p_issue_type not in ('not_received', 'incorrect_reward', 'damaged', 'other')
		or length(btrim(coalesce(p_description, ''))) not between 10 and 2000 then
		raise exception 'Describe the reward issue.' using errcode = '22023';
	end if;
	select * into claim from public.loyalty_offer_claims
	where id = p_claim_id and visitor_id = current_visitor_id;
	if not found or claim.status not in ('won', 'redeemed') then
		raise exception 'This reward is not eligible for a support report.' using errcode = '55000';
	end if;

	insert into public.loyalty_claim_support_cases (claim_id, visitor_id, issue_type, description)
	values (claim.id, current_visitor_id, p_issue_type, btrim(p_description))
	on conflict (claim_id) do nothing
	returning id into case_id;
	if case_id is null then
		select id into case_id from public.loyalty_claim_support_cases where claim_id = p_claim_id;
	end if;
	return case_id;
end;
$$;

create function public.get_visitor_loyalty_result_notifications()
returns table (
	claim_id uuid,
	offer_title text,
	claim_type text,
	claim_status text,
	points_spent integer,
	city text,
	country_code text,
	result_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	current_visitor_id uuid := (select auth.uid());
begin
	if current_visitor_id is null or not public.is_supported_loyalty_visitor(current_visitor_id) then
		raise exception 'A verified visitor account is required.' using errcode = '42501';
	end if;
	return query
	select claim.id, offer.title, claim.claim_type, claim.status,
		claim.points_spent, claim.city, claim.country_code, claim.result_at
	from public.loyalty_offer_claims claim
	join public.loyalty_offers offer on offer.id = claim.offer_id
	where claim.visitor_id = current_visitor_id
		and claim.status in ('won', 'lost', 'redeemed')
	order by claim.result_at desc, claim.id desc
	limit 50;
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

create function public.admin_get_loyalty_claim_support_cases(p_limit integer, p_offset integer)
returns table (
	case_id uuid,
	claim_id uuid,
	offer_title text,
	visitor_id uuid,
	visitor_email text,
	visitor_name text,
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
begin
	if not (select public.is_admin()) then
		raise exception 'Administrator access is required.' using errcode = '42501';
	end if;
	if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 100000 then
		raise exception 'Invalid support case page.' using errcode = '22023';
	end if;
	return query
	select support_case.id, claim.id, offer.title, support_case.visitor_id,
		account_user.email::text,
		coalesce(profile.display_name, account_user.raw_user_meta_data ->> 'display_name')::text,
		support_case.issue_type, support_case.description, support_case.status,
		support_case.resolution_note, support_case.created_at, support_case.updated_at,
		count(*) over ()::bigint
	from public.loyalty_claim_support_cases support_case
	join public.loyalty_offer_claims claim on claim.id = support_case.claim_id
	join public.loyalty_offers offer on offer.id = claim.offer_id
	join auth.users account_user on account_user.id = support_case.visitor_id
	left join public.profiles profile on profile.id = support_case.visitor_id
	where support_case.status <> 'resolved'
	order by support_case.created_at asc, support_case.id asc
	limit p_limit offset p_offset;
end;
$$;

create function public.admin_update_loyalty_claim_support_case(
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
	current_case public.loyalty_claim_support_cases%rowtype;
	note_text text := btrim(coalesce(p_resolution_note, ''));
begin
	if not (select public.is_admin()) then
		raise exception 'Administrator access is required.' using errcode = '42501';
	end if;
	if p_case_id is null or p_status not in ('open', 'in_review', 'resolved')
		or (p_status = 'resolved' and length(note_text) not between 5 and 1000)
		or length(note_text) > 1000 then
		raise exception 'Add a resolution note and choose a valid case status.' using errcode = '22023';
	end if;
	select * into current_case from public.loyalty_claim_support_cases
	where id = p_case_id for update;
	if not found then raise exception 'Support case not found.' using errcode = 'P0002'; end if;
	update public.loyalty_claim_support_cases
	set status = p_status,
		resolution_note = case when p_status = 'resolved' then note_text else null end,
		resolved_by = case when p_status = 'resolved' then (select auth.uid()) else null end,
		resolved_at = case when p_status = 'resolved' then now() else null end,
		updated_at = now()
	where id = p_case_id;
	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values (
		(select auth.uid()), 'loyalty_claim_support_case_updated',
		'loyalty_claim_support_case', p_case_id,
		jsonb_build_object('claim_id', current_case.claim_id, 'from_status', current_case.status,
			'to_status', p_status, 'resolution_note', case when p_status = 'resolved' then note_text else null end)
	);
end;
$$;

revoke all on function public.set_loyalty_claim_result_at() from public, anon, authenticated;
revoke all on function public.visitor_report_loyalty_claim_issue(uuid, text, text) from public, anon;
revoke all on function public.get_visitor_loyalty_result_notifications() from public, anon;
revoke all on function public.admin_get_loyalty_claim_support_cases(integer, integer) from public, anon;
revoke all on function public.admin_update_loyalty_claim_support_case(uuid, text, text) from public, anon;
grant execute on function public.visitor_report_loyalty_claim_issue(uuid, text, text) to authenticated;
grant execute on function public.get_visitor_loyalty_result_notifications() to authenticated;
grant execute on function public.admin_get_loyalty_claim_support_cases(integer, integer) to authenticated;
grant execute on function public.admin_update_loyalty_claim_support_case(uuid, text, text) to authenticated;