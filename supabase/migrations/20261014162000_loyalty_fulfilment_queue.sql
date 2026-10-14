alter table public.loyalty_offer_claims
	add column fulfillment_note text,
	add column fulfillment_reference text,
	add column fulfilled_at timestamptz,
	add column fulfilled_by uuid references auth.users (id) on delete set null;

create index loyalty_offer_claims_pending_fulfillment_idx
	on public.loyalty_offer_claims (created_at, id)
	where fulfillment_status = 'pending' and status in ('won', 'redeemed');

drop function public.admin_set_loyalty_claim_fulfilled(uuid);

create function public.admin_set_loyalty_claim_fulfilled(
	p_claim_id uuid,
	p_note text,
	p_reference text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	claim public.loyalty_offer_claims%rowtype;
	note_text text := btrim(coalesce(p_note, ''));
	reference_text text := nullif(btrim(coalesce(p_reference, '')), '');
begin
	if not (select public.is_admin()) then
		raise exception 'Administrator access is required.' using errcode = '42501';
	end if;
	if p_claim_id is null or length(note_text) not between 5 and 1000 or length(coalesce(reference_text, '')) > 500 then
		raise exception 'Add a fulfilment note and a valid optional reference.' using errcode = '22023';
	end if;

	select * into claim
	from public.loyalty_offer_claims
	where id = p_claim_id
	for update;
	if not found or claim.status not in ('won', 'redeemed') then
		raise exception 'This claim is not eligible for fulfilment.' using errcode = '55000';
	end if;
	if claim.fulfillment_status = 'fulfilled' then
		return;
	end if;

	update public.loyalty_offer_claims
	set fulfillment_status = 'fulfilled',
		fulfillment_note = note_text,
		fulfillment_reference = reference_text,
		fulfilled_at = now(),
		fulfilled_by = (select auth.uid())
	where id = p_claim_id;

	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values (
		(select auth.uid()),
		'loyalty_reward_fulfilled',
		'loyalty_claim',
		p_claim_id,
		jsonb_build_object(
			'offer_id', claim.offer_id,
			'visitor_id', claim.visitor_id,
			'claim_type', claim.claim_type,
			'note', note_text,
			'reference', reference_text
		)
	);
end;
$$;

drop function public.admin_get_loyalty_offer_recipients(uuid);

create function public.admin_get_loyalty_offer_recipients(p_offer_id uuid)
returns table (
	claim_id uuid,
	visitor_id uuid,
	email text,
	display_name text,
	status text,
	fulfillment_status text,
	points_spent integer,
	city text,
	country_code text,
	created_at timestamptz,
	fulfillment_note text,
	fulfillment_reference text,
	fulfilled_at timestamptz,
	fulfilled_by_email text
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
	return query
	select claim.id, claim.visitor_id, account_user.email::text,
		coalesce(profile.display_name, account_user.raw_user_meta_data ->> 'display_name')::text,
		claim.status, claim.fulfillment_status, claim.points_spent,
		claim.city, claim.country_code, claim.created_at,
		claim.fulfillment_note, claim.fulfillment_reference, claim.fulfilled_at,
		fulfilled_by.email::text
	from public.loyalty_offer_claims claim
	join auth.users account_user on account_user.id = claim.visitor_id
	left join public.profiles profile on profile.id = claim.visitor_id
	left join auth.users fulfilled_by on fulfilled_by.id = claim.fulfilled_by
	where claim.offer_id = p_offer_id and claim.status in ('won', 'redeemed')
	order by claim.created_at asc;
end;
$$;

drop function if exists public.admin_get_loyalty_pending_fulfillments(integer, integer);

create function public.admin_get_loyalty_pending_fulfillments(p_limit integer, p_offset integer)
returns table (
	claim_id uuid,
	offer_id uuid,
	offer_title text,
	visitor_id uuid,
	visitor_email text,
	visitor_name text,
	claim_type text,
	claim_status text,
	points_spent integer,
	city text,
	country_code text,
	created_at timestamptz,
	total_pending_count bigint
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
		raise exception 'Invalid fulfilment queue page.' using errcode = '22023';
	end if;

	return query
	select claim.id, claim.offer_id, offer.title, claim.visitor_id,
		account_user.email::text,
		coalesce(profile.display_name, account_user.raw_user_meta_data ->> 'display_name')::text,
		claim.claim_type, claim.status, claim.points_spent, claim.city,
		claim.country_code, claim.created_at,
		count(*) over ()::bigint
	from public.loyalty_offer_claims claim
	join public.loyalty_offers offer on offer.id = claim.offer_id
	join auth.users account_user on account_user.id = claim.visitor_id
	left join public.profiles profile on profile.id = claim.visitor_id
	where claim.fulfillment_status = 'pending' and claim.status in ('won', 'redeemed')
	order by claim.created_at asc, claim.id asc
	limit p_limit offset p_offset;
end;
$$;

revoke all on function public.admin_set_loyalty_claim_fulfilled(uuid, text, text) from public, anon;
revoke all on function public.admin_get_loyalty_offer_recipients(uuid) from public, anon;
revoke all on function public.admin_get_loyalty_pending_fulfillments(integer, integer) from public, anon;
grant execute on function public.admin_set_loyalty_claim_fulfilled(uuid, text, text) to authenticated;
grant execute on function public.admin_get_loyalty_offer_recipients(uuid) to authenticated;
grant execute on function public.admin_get_loyalty_pending_fulfillments(integer, integer) to authenticated;
