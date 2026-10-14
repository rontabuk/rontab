create table public.seller_voucher_support_cases (
	id uuid primary key default gen_random_uuid(),
	coupon_id uuid not null unique references public.seller_offer_coupons (id) on delete cascade,
	visitor_id uuid not null references auth.users (id) on delete cascade,
	issue_type text not null check (issue_type in ('not_honored', 'incorrect_offer', 'quality_issue', 'other')),
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

create index seller_voucher_support_cases_queue_idx
	on public.seller_voucher_support_cases (status, created_at, id);

alter table public.seller_voucher_support_cases enable row level security;
revoke all on public.seller_voucher_support_cases from public, anon, authenticated;
grant select on public.seller_voucher_support_cases to authenticated;

create policy "Visitors and admins read seller voucher support cases"
	on public.seller_voucher_support_cases for select to authenticated
	using (visitor_id = (select auth.uid()) or (select public.is_admin()));

create function public.visitor_report_seller_voucher_issue(
	p_coupon_id uuid,
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
	coupon public.seller_offer_coupons%rowtype;
	offer public.seller_offers%rowtype;
	seller_status public.seller_status;
	window_start timestamptz;
	case_id uuid;
begin
	if current_visitor_id is null or not public.is_supported_loyalty_visitor(current_visitor_id) then
		raise exception 'A verified visitor account is required.' using errcode = '42501';
	end if;
	if p_coupon_id is null or p_issue_type not in ('not_honored', 'incorrect_offer', 'quality_issue', 'other')
		or length(btrim(coalesce(p_description, ''))) not between 10 and 2000 then
		raise exception 'Describe the voucher issue.' using errcode = '22023';
	end if;
	select * into coupon from public.seller_offer_coupons coupon_row
	where coupon_row.id = p_coupon_id and coupon_row.visitor_id = current_visitor_id;
	if not found or coupon.status = 'cancelled' then
		raise exception 'This voucher is not eligible for a support report.' using errcode = '55000';
	end if;
	select * into offer from public.seller_offers seller_offer where seller_offer.id = coupon.offer_id;
	select seller.status into seller_status from public.seller_profiles seller where seller.id = offer.seller_profile_id;
	window_start := (coupon.offer_date + coupon.starts_at) at time zone 'Europe/London';
	if coupon.status = 'reserved' and now() < window_start and seller_status = 'active' and offer.status = 'published' then
		raise exception 'This voucher can still be cancelled before its window.' using errcode = '55000';
	end if;

	insert into public.seller_voucher_support_cases (coupon_id, visitor_id, issue_type, description)
	values (coupon.id, current_visitor_id, p_issue_type, btrim(p_description))
	on conflict (coupon_id) do nothing
	returning id into case_id;
	if case_id is null then
		select id into case_id from public.seller_voucher_support_cases where coupon_id = p_coupon_id;
	end if;
	return case_id;
end;
$$;

create function public.admin_get_seller_voucher_support_cases(p_limit integer, p_offset integer)
returns table (
	case_id uuid,
	coupon_id uuid,
	offer_id uuid,
	offer_title text,
	seller_profile_id uuid,
	shop_name text,
	visitor_id uuid,
	visitor_email text,
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
		raise exception 'Invalid voucher support page.' using errcode = '22023';
	end if;
	return query
	select support_case.id, support_case.coupon_id, offer.id, offer.title,
		offer.seller_profile_id, seller.shop_name, support_case.visitor_id,
		account_user.email::text, support_case.issue_type, support_case.description,
		support_case.status, support_case.resolution_note, support_case.created_at,
		support_case.updated_at, count(*) over ()::bigint
	from public.seller_voucher_support_cases support_case
	join public.seller_offer_coupons coupon on coupon.id = support_case.coupon_id
	join public.seller_offers offer on offer.id = coupon.offer_id
	join public.seller_profiles seller on seller.id = offer.seller_profile_id
	join auth.users account_user on account_user.id = support_case.visitor_id
	where support_case.status <> 'resolved'
	order by support_case.created_at asc, support_case.id asc
	limit p_limit offset p_offset;
end;
$$;

create function public.admin_update_seller_voucher_support_case(
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
	current_case public.seller_voucher_support_cases%rowtype;
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
	select * into current_case from public.seller_voucher_support_cases where id = p_case_id for update;
	if not found then raise exception 'Voucher support case not found.' using errcode = 'P0002'; end if;
	update public.seller_voucher_support_cases
	set status = p_status,
		resolution_note = case when p_status = 'resolved' then note_text else null end,
		resolved_by = case when p_status = 'resolved' then (select auth.uid()) else null end,
		resolved_at = case when p_status = 'resolved' then now() else null end,
		updated_at = now()
	where id = p_case_id;
	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values (
		(select auth.uid()), 'seller_voucher_support_case_updated',
		'seller_voucher_support_case', p_case_id,
		jsonb_build_object('coupon_id', current_case.coupon_id, 'from_status', current_case.status,
			'to_status', p_status, 'resolution_note', case when p_status = 'resolved' then note_text else null end)
	);
end;
$$;

revoke all on function public.visitor_report_seller_voucher_issue(uuid, text, text) from public, anon;
revoke all on function public.admin_get_seller_voucher_support_cases(integer, integer) from public, anon;
revoke all on function public.admin_update_seller_voucher_support_case(uuid, text, text) from public, anon;
grant execute on function public.visitor_report_seller_voucher_issue(uuid, text, text) to authenticated;
grant execute on function public.admin_get_seller_voucher_support_cases(integer, integer) to authenticated;
grant execute on function public.admin_update_seller_voucher_support_case(uuid, text, text) to authenticated;