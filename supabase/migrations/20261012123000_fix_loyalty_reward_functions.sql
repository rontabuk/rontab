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
	visitor_city text;
	visitor_country text;
	claim_status text;
	claim_id uuid;
	claim_count bigint;
begin
	if not (select public.is_eligible_visitor()) then
		raise exception 'A confirmed visitor account is required.' using errcode = '42501';
	end if;

	select * into offer
	from public.loyalty_offers
	where id = p_offer_id
	for update;
	if not found
		or offer.status <> 'published'
		or offer.starts_at > now()
		or offer.ends_at <= now() then
		raise exception 'This offer is not available.' using errcode = '55000';
	end if;
	if offer.selection_method = 'random'
		and not exists (
			select 1 from public.marketplace_settings
			where singleton = true and loyalty_random_draws_enabled
		) then
		raise exception 'This offer is not available.' using errcode = '55000';
	end if;

	select profile.city, profile.country_code into visitor_city, visitor_country
	from public.profiles profile where profile.id = current_visitor_id;
	if offer.city is not null and (
		lower(btrim(visitor_city)) is distinct from lower(btrim(offer.city))
		or visitor_country is distinct from offer.country_code
	) then
		raise exception 'This offer is only available in its listed location.' using errcode = '42501';
	end if;

	select claim.id, claim.status into claim_id, claim_status
	from public.loyalty_offer_claims claim
	where claim.offer_id = offer.id and claim.visitor_id = current_visitor_id;
	if claim_id is not null then
		select account.points_balance into account_balance
		from public.loyalty_accounts account
		where account.visitor_id = current_visitor_id;
		return jsonb_build_object(
			'alreadyJoined', true,
			'claimId', claim_id,
			'status', claim_status,
			'pointsBalance', account_balance
		);
	end if;

	select account.points_balance into account_balance
	from public.loyalty_accounts account
	where account.visitor_id = current_visitor_id
	for update;
	if account_balance is null or account_balance < offer.minimum_points or account_balance < offer.points_cost then
		raise exception 'You do not have enough points for this offer.' using errcode = '23514';
	end if;

	if offer.offer_type = 'redemption' then
		select count(*) into claim_count
		from public.loyalty_offer_claims claim
		where claim.offer_id = offer.id and claim.claim_type = 'redemption';
		if claim_count >= offer.capacity then
			raise exception 'This offer has been fully claimed.' using errcode = '55000';
		end if;
		claim_status := 'redeemed';
	else
		if offer.selection_method = 'first_come' then
			select count(*) into claim_count
			from public.loyalty_offer_claims claim
			where claim.offer_id = offer.id and claim.status = 'won';
			if claim_count >= offer.capacity then
				raise exception 'This offer has been fully claimed.' using errcode = '55000';
			end if;
			claim_status := 'won';
		else
			claim_status := 'entered';
		end if;
	end if;

	insert into public.loyalty_offer_claims (
		offer_id, visitor_id, claim_type, status, points_spent, city, country_code
	)
	values (
		offer.id, current_visitor_id, offer.offer_type, claim_status, offer.points_cost, visitor_city, visitor_country
	)
	on conflict (offer_id, visitor_id) do nothing
	returning id into claim_id;

	if claim_id is null then
		return jsonb_build_object('alreadyJoined', true, 'pointsBalance', account_balance);
	end if;

	update public.loyalty_accounts
	set points_balance = points_balance - offer.points_cost,
		updated_at = now()
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

create or replace function public.admin_run_loyalty_offer_draw(p_offer_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
	offer public.loyalty_offers%rowtype;
	winner_count integer;
begin
	if not (select public.is_admin()) then
		raise exception 'Administrator access is required.' using errcode = '42501';
	end if;
	select * into offer
	from public.loyalty_offers
	where id = p_offer_id
	for update;
	if not found
		or offer.offer_type <> 'participation'
		or offer.selection_method <> 'random'
		or offer.status not in ('published', 'paused')
		or offer.ends_at > now() then
		raise exception 'This offer is not ready for a draw.' using errcode = '55000';
	end if;
	if not exists (
		select 1 from public.marketplace_settings
		where singleton = true and loyalty_random_draws_enabled
	) then
		raise exception 'Random draws are disabled.' using errcode = '55000';
	end if;

	with chosen as materialized (
		select claim.id
		from public.loyalty_offer_claims claim
		where claim.offer_id = p_offer_id and claim.status = 'entered'
		order by gen_random_uuid()
		limit offer.capacity
	), updated as (
		update public.loyalty_offer_claims claim
		set status = case when chosen.id is null then 'lost' else 'won' end
		from (
			select entry.id as entry_id
			from public.loyalty_offer_claims entry
			where entry.offer_id = p_offer_id and entry.status = 'entered'
		) entrants
		left join chosen on chosen.id = entrants.entry_id
		where claim.id = entrants.entry_id
		returning claim.status
	)
	select count(*) filter (where status = 'won')::integer
	into winner_count
	from updated;

	update public.loyalty_offers
	set status = 'completed', updated_at = now()
	where id = p_offer_id;

	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values (
		(select auth.uid()),
		'loyalty_offer_draw_completed',
		'loyalty_offer',
		p_offer_id,
		jsonb_build_object('winner_count', winner_count, 'capacity', offer.capacity)
	);
	return winner_count;
end;
$$;

create or replace function public.admin_get_loyalty_offer_recipients(p_offer_id uuid)
returns table (
	visitor_id uuid,
	email text,
	display_name text,
	status text,
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