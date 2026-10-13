create or replace function public.admin_set_loyalty_claim_fulfilled(p_claim_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	claim public.loyalty_offer_claims%rowtype;
begin
	if not (select public.is_admin()) then
		raise exception 'Administrator access is required.' using errcode = '42501';
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
	set fulfillment_status = 'fulfilled'
	where id = p_claim_id;

	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values (
		(select auth.uid()),
		'loyalty_reward_fulfilled',
		'loyalty_claim',
		p_claim_id,
		jsonb_build_object('offer_id', claim.offer_id, 'visitor_id', claim.visitor_id, 'claim_type', claim.claim_type)
	);
end;
$$;