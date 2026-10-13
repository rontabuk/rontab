create or replace function public.join_loyalty_offer(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	current_visitor_id uuid := (select auth.uid());
	offer public.loyalty_offers%rowtype;
	account_balance bigint;
	visitor_city_id text;
	visitor_city text;
	visitor_country text;
	claim_status text;
	claim_id uuid;
	claim_count bigint;
	city_capacity integer;
	has_city_quotas boolean;
begin
	if not (select public.is_eligible_visitor()) then
		raise exception 'A confirmed visitor account is required.' using errcode = '42501';
	end if;
	select * into offer
	from public.loyalty_offers
	where id = p_offer_id
	for update;
	if not found or offer.status <> 'published' or offer.starts_at > now() or offer.ends_at <= now() then
		raise exception 'This offer is not available.' using errcode = '55000';
	end if;
	if offer.selection_method = 'random' and not exists (
		select 1 from public.marketplace_settings where singleton = true and loyalty_random_draws_enabled
	) then
		raise exception 'This offer is not available.' using errcode = '55000';
	end if;

	select profile.city_id, profile.city, profile.country_code
	into visitor_city_id, visitor_city, visitor_country
	from public.profiles profile
	where profile.id = current_visitor_id;

	select exists (
		select 1 from public.loyalty_offer_city_quotas quota where quota.offer_id = offer.id
	) into has_city_quotas;
	if has_city_quotas then
		select quota.capacity into city_capacity
		from public.loyalty_offer_city_quotas quota
		where quota.offer_id = offer.id and quota.city_id = visitor_city_id;
		if city_capacity is null then
			raise exception 'This offer is only available in its listed cities.' using errcode = '42501';
		end if;
	else
		city_capacity := offer.capacity;
	end if;

	select claim.id, claim.status into claim_id, claim_status
	from public.loyalty_offer_claims claim
	where claim.offer_id = offer.id and claim.visitor_id = current_visitor_id;
	if claim_id is not null then
		select account.points_balance into account_balance
		from public.loyalty_accounts account where account.visitor_id = current_visitor_id;
		return jsonb_build_object('alreadyJoined', true, 'claimId', claim_id, 'status', claim_status, 'pointsBalance', account_balance);
	end if;

	select account.points_balance into account_balance
	from public.loyalty_accounts account
	where account.visitor_id = current_visitor_id
	for update;
	if account_balance is null or account_balance < greatest(offer.minimum_points, offer.points_cost) then
		raise exception 'You do not have enough points for this offer.' using errcode = '23514';
	end if;

	if offer.offer_type = 'redemption' or offer.selection_method = 'first_come' then
		select count(*) into claim_count
		from public.loyalty_offer_claims claim
		where claim.offer_id = offer.id
			and claim.claim_type = offer.offer_type
			and (not has_city_quotas or claim.city_id = visitor_city_id);
		if claim_count >= city_capacity then
			raise exception 'This offer has been fully claimed in your city.' using errcode = '55000';
		end if;
		claim_status := case when offer.offer_type = 'redemption' then 'redeemed' else 'won' end;
	else
		claim_status := 'entered';
	end if;

	insert into public.loyalty_offer_claims (
		offer_id, visitor_id, claim_type, status, points_spent, city_id, city, country_code
	)
	values (
		offer.id, current_visitor_id, offer.offer_type, claim_status, offer.points_cost,
		visitor_city_id, visitor_city, visitor_country
	)
	on conflict (offer_id, visitor_id) do nothing
	returning id into claim_id;
	if claim_id is null then
		return jsonb_build_object('alreadyJoined', true, 'pointsBalance', account_balance);
	end if;

	update public.loyalty_accounts
	set points_balance = points_balance - offer.points_cost, updated_at = now()
	where loyalty_accounts.visitor_id = current_visitor_id;
	insert into public.loyalty_point_transactions (
		visitor_id, points_delta, transaction_type, offer_claim_id, idempotency_key
	)
	values (
		current_visitor_id,
		-offer.points_cost,
		case when offer.offer_type = 'participation' then 'participation_spent' else 'redemption_spent' end,
		claim_id,
		'offer:' || claim_id::text
	);

	return jsonb_build_object(
		'alreadyJoined', false,
		'claimId', claim_id,
		'status', claim_status,
		'pointsBalance', account_balance - offer.points_cost
	);
end;
$$;

revoke all on function public.join_loyalty_offer(uuid) from public, anon;
grant execute on function public.join_loyalty_offer(uuid) to authenticated;