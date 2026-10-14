alter table public.loyalty_offer_claims
	add column fulfillment_evidence_path text
		check (
			fulfillment_evidence_path is null
			or fulfillment_evidence_path ~* '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|jpeg|png|webp)$'
		);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
	'loyalty-fulfilment-evidence',
	'loyalty-fulfilment-evidence',
	false,
	10485760,
	array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
	file_size_limit = excluded.file_size_limit,
	allowed_mime_types = excluded.allowed_mime_types;

create policy "Admins read loyalty fulfilment evidence"
	on storage.objects for select to authenticated
	using (bucket_id = 'loyalty-fulfilment-evidence' and (select public.is_admin()));

create policy "Admins upload loyalty fulfilment evidence"
	on storage.objects for insert to authenticated
	with check (bucket_id = 'loyalty-fulfilment-evidence' and (select public.is_admin()));

drop function public.admin_set_loyalty_claim_fulfilled(uuid, text, text);

create function public.admin_set_loyalty_claim_fulfilled(
	p_claim_id uuid,
	p_note text,
	p_reference text,
	p_evidence_path text
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
	evidence_path text := nullif(btrim(coalesce(p_evidence_path, '')), '');
begin
	if not (select public.is_admin()) then
		raise exception 'Administrator access is required.' using errcode = '42501';
	end if;
	if p_claim_id is null or length(note_text) not between 5 and 1000
		or length(coalesce(reference_text, '')) > 500 then
		raise exception 'Add a fulfilment note and a valid optional reference.' using errcode = '22023';
	end if;
	if evidence_path is not null and (
		evidence_path !~* ('^' || p_claim_id::text || '/[0-9a-f-]{36}\.(pdf|jpg|jpeg|png|webp)$')
		or not exists (
			select 1 from storage.objects object
			where object.bucket_id = 'loyalty-fulfilment-evidence' and object.name = evidence_path
		)
	) then
		raise exception 'The fulfilment evidence file is invalid or unavailable.' using errcode = '22023';
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
		fulfillment_evidence_path = evidence_path,
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
			'reference', reference_text,
			'evidence_attached', evidence_path is not null
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
	fulfillment_evidence_path text,
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
		claim.fulfillment_note, claim.fulfillment_reference, claim.fulfillment_evidence_path,
		claim.fulfilled_at, fulfilled_by.email::text
	from public.loyalty_offer_claims claim
	join auth.users account_user on account_user.id = claim.visitor_id
	left join public.profiles profile on profile.id = claim.visitor_id
	left join auth.users fulfilled_by on fulfilled_by.id = claim.fulfilled_by
	where claim.offer_id = p_offer_id and claim.status in ('won', 'redeemed')
	order by claim.created_at asc;
end;
$$;

revoke all on function public.admin_set_loyalty_claim_fulfilled(uuid, text, text, text) from public, anon;
revoke all on function public.admin_get_loyalty_offer_recipients(uuid) from public, anon;
grant execute on function public.admin_set_loyalty_claim_fulfilled(uuid, text, text, text) to authenticated;
grant execute on function public.admin_get_loyalty_offer_recipients(uuid) to authenticated;