create or replace function public.admin_decide_seller_offer_request(
	p_request_id uuid,
	p_decision text,
	p_review_note text,
	p_points_cost integer,
	p_final_terms text,
	p_daily_capacity integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	request public.seller_offer_requests%rowtype;
	new_offer_id uuid;
	request_location record;
	new_location_id uuid;
	admin_id uuid := (select auth.uid());
	v_review_note text := nullif(btrim(p_review_note), '');
begin
	if not (select public.is_admin()) then
		raise exception 'Administrator access is required.' using errcode = '42501';
	end if;
	if p_request_id is null or p_decision is null or p_decision not in ('approve', 'changes_requested', 'reject')
		or length(coalesce(p_review_note, '')) > 2000 then
		raise exception 'Offer review decision is invalid.' using errcode = '22023';
	end if;
	if p_decision <> 'approve' and v_review_note is null then
		raise exception 'Add a review note when requesting changes or rejecting an offer.' using errcode = '22023';
	end if;
	if p_decision = 'approve' and (
		p_points_cost is null or p_points_cost not between 1 and 1000000
		or length(btrim(coalesce(p_final_terms, ''))) not between 10 and 5000
		or p_daily_capacity is null or p_daily_capacity not between 1 and 1000
	) then
		raise exception 'Approved offers need valid points, final terms, and a daily capacity.' using errcode = '22023';
	end if;

	select * into request
	from public.seller_offer_requests
	where id = p_request_id
	for update;
	if not found then
		raise exception 'Offer request not found.' using errcode = 'P0002';
	end if;
	if request.status <> 'submitted' then
		raise exception 'Only submitted offer requests can be reviewed.' using errcode = '55000';
	end if;
	if p_decision = 'approve' and exists (
		select 1 from public.seller_offer_requests request_row
		join public.seller_offer_request_locations location on location.request_id = request_row.id
		join public.seller_offer_request_schedules schedule on schedule.location_id = location.id
		where request_row.id = p_request_id
			and not exists (
				select 1 from generate_series(request_row.valid_from, request_row.valid_until, interval '1 day') offer_day
				where extract(dow from offer_day)::smallint = schedule.weekday
			)
	) then
		raise exception 'The requested schedule has no matching date in the validity period.' using errcode = '22023';
	end if;

	if p_decision = 'approve' then
		insert into public.seller_offers (
			request_id, seller_profile_id, offer_kind, title, description, benefit_details,
			discount_percent, media_url, media_type, points_cost, terms, valid_from, valid_until, approved_by
		)
		values (
			request.id, request.seller_profile_id, request.offer_kind, request.title, request.description,
			request.benefit_details, request.discount_percent, request.media_url, request.media_type,
			p_points_cost, btrim(p_final_terms), request.valid_from, request.valid_until, admin_id
		)
		returning id into new_offer_id;

		for request_location in
			select * from public.seller_offer_request_locations where request_id = p_request_id order by id
		loop
			insert into public.seller_offer_locations (offer_id, city_id, branch_name, branch_address)
			values (new_offer_id, request_location.city_id, request_location.branch_name, request_location.branch_address)
			returning id into new_location_id;
			insert into public.seller_offer_schedules (location_id, weekday, starts_at, ends_at, daily_capacity)
			select new_location_id, schedule.weekday, schedule.starts_at, schedule.ends_at, p_daily_capacity
			from public.seller_offer_request_schedules schedule
			where schedule.location_id = request_location.id;
		end loop;
	else
		new_offer_id := null;
	end if;

	update public.seller_offer_requests request_row
	set status = case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' else 'changes_requested' end,
		review_note = v_review_note,
		reviewed_by = admin_id,
		reviewed_at = now()
	where request_row.id = p_request_id;

	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values (
		admin_id,
		'seller_offer_request_' || p_decision,
		'seller_offer_request',
		p_request_id,
		jsonb_build_object(
			'decision', p_decision,
			'review_note', v_review_note,
			'offer_id', new_offer_id,
			'points_cost', case when p_decision = 'approve' then p_points_cost else null end,
			'daily_capacity', case when p_decision = 'approve' then p_daily_capacity else null end
		)
	);
	return new_offer_id;
end;
$$;