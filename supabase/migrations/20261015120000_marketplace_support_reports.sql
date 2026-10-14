create table public.marketplace_support_cases (
	id uuid primary key default gen_random_uuid(),
	reporter_id uuid not null references auth.users (id) on delete cascade,
	target_type text not null check (target_type in ('product', 'seller_account')),
	target_id uuid not null,
	issue_type text not null check (issue_type in ('misleading', 'prohibited', 'counterfeit', 'seller_conduct', 'other')),
	description text not null check (length(btrim(description)) between 10 and 2000),
	status text not null default 'open' check (status in ('open', 'in_review', 'resolved')),
	resolution_note text,
	resolved_by uuid references auth.users (id) on delete set null,
	resolved_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	check (
		(status = 'resolved' and resolved_at is not null and resolved_by is not null and length(btrim(coalesce(resolution_note, ''))) >= 5)
		or (status <> 'resolved' and resolved_at is null and resolved_by is null)
	)
);

create index marketplace_support_cases_queue_idx
	on public.marketplace_support_cases (status, created_at, id);

create unique index marketplace_support_cases_one_open_report_idx
	on public.marketplace_support_cases (reporter_id, target_type, target_id)
	where status <> 'resolved';

alter table public.marketplace_support_cases enable row level security;
revoke all on public.marketplace_support_cases from public, anon, authenticated;
grant select on public.marketplace_support_cases to authenticated;

create policy "Visitors and admins read marketplace support cases"
	on public.marketplace_support_cases for select to authenticated
	using (reporter_id = (select auth.uid()) or (select public.is_admin()));

create function public.visitor_report_marketplace_item(
	p_target_type text,
	p_target_id uuid,
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
	target_owner_id uuid;
	case_id uuid;
begin
	if current_visitor_id is null
		or not exists (
			select 1 from auth.users account_user
			join public.profiles profile on profile.id = account_user.id
			where account_user.id = current_visitor_id
				and account_user.email_confirmed_at is not null
				and profile.email_verified_at is not null
		)
		or exists (select 1 from public.seller_profiles seller where seller.user_id = current_visitor_id)
		or (select public.is_admin()) then
		raise exception 'A verified visitor account is required.' using errcode = '42501';
	end if;
	if p_target_type is null or p_target_type not in ('product', 'seller_account')
		or p_target_id is null
		or p_issue_type is null or p_issue_type not in ('misleading', 'prohibited', 'counterfeit', 'seller_conduct', 'other')
		or length(btrim(coalesce(p_description, ''))) not between 10 and 2000 then
		raise exception 'Describe the marketplace issue.' using errcode = '22023';
	end if;

	if p_target_type = 'product' then
		select seller.user_id into target_owner_id
		from public.products product
		join public.seller_profiles seller on seller.id = product.seller_profile_id
		where product.id = p_target_id and product.status = 'approved'
			and seller.status = 'active' and seller.is_public;
	else
		select seller.user_id into target_owner_id
		from public.seller_profiles seller
		where seller.id = p_target_id and seller.status = 'active' and seller.is_public;
	end if;
	if target_owner_id is null then
		raise exception 'This item is not available for reporting.' using errcode = '55000';
	end if;
	if target_owner_id = current_visitor_id then
		raise exception 'You cannot report your own listing or seller account.' using errcode = '55000';
	end if;

	insert into public.marketplace_support_cases (reporter_id, target_type, target_id, issue_type, description)
	values (current_visitor_id, p_target_type, p_target_id, p_issue_type, btrim(p_description))
	on conflict (reporter_id, target_type, target_id) where status <> 'resolved' do nothing
	returning id into case_id;
	if case_id is null then
		select support_case.id into case_id from public.marketplace_support_cases support_case
		where support_case.reporter_id = current_visitor_id
			and support_case.target_type = p_target_type
			and support_case.target_id = p_target_id
			and support_case.status <> 'resolved';
	end if;
	return case_id;
end;
$$;

create function public.admin_get_marketplace_support_cases(p_limit integer, p_offset integer)
returns table (
	case_id uuid,
	target_type text,
	target_id uuid,
	target_name text,
	target_url text,
	reporter_id uuid,
	reporter_email text,
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
	if p_limit is null or p_limit not between 1 and 100
		or p_offset is null or p_offset not between 0 and 100000 then
		raise exception 'Invalid marketplace report page.' using errcode = '22023';
	end if;
	return query
	select support_case.id, support_case.target_type, support_case.target_id,
		coalesce(product.name, seller.shop_name, 'Removed marketplace item')::text,
		case when product.id is not null then '/products/' || product.slug else seller.shop_url end::text,
		support_case.reporter_id, account_user.email::text, support_case.issue_type,
		support_case.description, support_case.status, support_case.resolution_note,
		support_case.created_at, support_case.updated_at, count(*) over ()::bigint
	from public.marketplace_support_cases support_case
	left join public.products product on support_case.target_type = 'product' and product.id = support_case.target_id
	left join public.seller_profiles seller on support_case.target_type = 'seller_account' and seller.id = support_case.target_id
	join auth.users account_user on account_user.id = support_case.reporter_id
	where support_case.status <> 'resolved'
	order by support_case.created_at asc, support_case.id asc
	limit p_limit offset p_offset;
end;
$$;

create function public.admin_update_marketplace_support_case(
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
begin
	if not (select public.is_admin()) then
		raise exception 'Administrator access is required.' using errcode = '42501';
	end if;
	if p_case_id is null or p_status not in ('open', 'in_review', 'resolved')
		or (p_status = 'resolved' and length(note_text) not between 5 and 1000)
		or length(note_text) > 1000 then
		raise exception 'Add a resolution note and choose a valid case status.' using errcode = '22023';
	end if;
	select * into current_case from public.marketplace_support_cases
	where id = p_case_id for update;
	if not found then raise exception 'Marketplace report not found.' using errcode = 'P0002'; end if;
	update public.marketplace_support_cases
	set status = p_status,
		resolution_note = case when p_status = 'resolved' then note_text else null end,
		resolved_by = case when p_status = 'resolved' then (select auth.uid()) else null end,
		resolved_at = case when p_status = 'resolved' then now() else null end,
		updated_at = now()
	where id = p_case_id;
	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values (
		(select auth.uid()), 'marketplace_support_case_updated',
		'marketplace_support_case', p_case_id,
		jsonb_build_object('target_type', current_case.target_type, 'target_id', current_case.target_id,
			'issue_type', current_case.issue_type, 'from_status', current_case.status,
			'to_status', p_status, 'resolution_note', case when p_status = 'resolved' then note_text else null end)
	);
end;
$$;

revoke all on function public.visitor_report_marketplace_item(text, uuid, text, text) from public, anon;
revoke all on function public.admin_get_marketplace_support_cases(integer, integer) from public, anon;
revoke all on function public.admin_update_marketplace_support_case(uuid, text, text) from public, anon;
grant execute on function public.visitor_report_marketplace_item(text, uuid, text, text) to authenticated;
grant execute on function public.admin_get_marketplace_support_cases(integer, integer) to authenticated;
grant execute on function public.admin_update_marketplace_support_case(uuid, text, text) to authenticated;