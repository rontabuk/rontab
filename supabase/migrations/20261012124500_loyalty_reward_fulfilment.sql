alter table public.loyalty_offer_claims
	add column fulfillment_status text not null default 'not_required'
		check (fulfillment_status in ('not_required', 'pending', 'fulfilled'));

update public.loyalty_offer_claims
set fulfillment_status = 'pending'
where status in ('won', 'redeemed');

create or replace function public.set_loyalty_claim_fulfillment_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	if new.status in ('won', 'redeemed') then
		if tg_op = 'INSERT' or old.status not in ('won', 'redeemed') then
			new.fulfillment_status := 'pending';
		end if;
	else
		new.fulfillment_status := 'not_required';
	end if;
	return new;
end;
$$;

create trigger set_loyalty_claim_fulfillment_state
	before insert or update of status on public.loyalty_offer_claims
	for each row execute function public.set_loyalty_claim_fulfillment_state();

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
		p_claim_id::text,
		jsonb_build_object('offer_id', claim.offer_id, 'visitor_id', claim.visitor_id, 'claim_type', claim.claim_type)
	);
end;
$$;

drop function public.admin_get_loyalty_offer_recipients(uuid);

create function public.admin_get_loyalty_offer_recipients(p_offer_id uuid)
returns table (
	visitor_id uuid,
	email text,
	display_name text,
	status text,
	fulfillment_status text,
	points_spent integer,
	city text,
	country_code text,
	created_at timestamptz
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
	select
		claim.visitor_id,
		account_user.email::text,
		coalesce(profile.display_name, account_user.raw_user_meta_data ->> 'display_name')::text,
		claim.status,
		claim.fulfillment_status,
		claim.points_spent,
		claim.city,
		claim.country_code,
		claim.created_at
	from public.loyalty_offer_claims claim
	join auth.users account_user on account_user.id = claim.visitor_id
	left join public.profiles profile on profile.id = claim.visitor_id
	where claim.offer_id = p_offer_id
		and claim.status in ('won', 'redeemed')
	order by claim.created_at asc;
end;
$$;

revoke all on function public.set_loyalty_claim_fulfillment_state() from public, anon, authenticated;
revoke all on function public.admin_set_loyalty_claim_fulfilled(uuid) from public, anon;
revoke all on function public.admin_get_loyalty_offer_recipients(uuid) from public, anon;
grant execute on function public.admin_set_loyalty_claim_fulfilled(uuid) to authenticated;
grant execute on function public.admin_get_loyalty_offer_recipients(uuid) to authenticated;