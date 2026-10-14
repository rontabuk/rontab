alter table public.seller_offer_requests
	add column request_payload_hash text;

revoke all on public.seller_offer_requests from authenticated;
grant select on public.seller_offer_requests to authenticated;
revoke all on public.seller_offer_request_locations from authenticated;
revoke all on public.seller_offer_request_schedules from authenticated;

create function public.seller_save_offer_request(p_request_id uuid, p_payload jsonb, p_submit boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	seller_id uuid;
	existing_request public.seller_offer_requests%rowtype;
	payload_hash text;
	location_data jsonb;
	schedule_data jsonb;
	location_id uuid;
	selected_city_id text;
	v_valid_from date;
	v_valid_until date;
	location_count integer;
	schedule_count integer;
	matching_days integer;
	request_status text := 'draft';
begin
	if p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' or p_submit is null then
		raise exception 'Offer request is invalid.' using errcode = '22023';
	end if;

	select profile.id into seller_id
	from public.seller_profiles profile
	where profile.user_id = (select auth.uid()) and profile.status = 'active';
	if seller_id is null then
		raise exception 'An active seller account is required.' using errcode = '42501';
	end if;

	v_valid_from := (p_payload ->> 'valid_from')::date;
	v_valid_until := (p_payload ->> 'valid_until')::date;
	if v_valid_until < v_valid_from
		or p_payload ->> 'offer_kind' not in ('discount', 'meal', 'free_item', 'other')
		or jsonb_typeof(p_payload -> 'locations') is distinct from 'array'
		or jsonb_array_length(p_payload -> 'locations') not between 1 and 20 then
		raise exception 'Offer details, dates, or locations are invalid.' using errcode = '22023';
	end if;
	if p_submit and (
		coalesce((p_payload ->> 'capacity_acknowledged')::boolean, false) is not true
		or nullif(btrim(p_payload ->> 'media_url'), '') is null
		or p_payload ->> 'media_type' not in ('image', 'video')
	) then
		raise exception 'Confirm daily capacity and provide offer media before submitting.' using errcode = '22023';
	end if;

	payload_hash := md5(p_payload::text);
	select * into existing_request
	from public.seller_offer_requests request
	where request.id = p_request_id
	for update;

	if found then
		if existing_request.seller_profile_id <> seller_id then
			raise exception 'Offer request is unavailable.' using errcode = '42501';
		end if;
		if existing_request.status = 'submitted' and p_submit and existing_request.request_payload_hash = payload_hash then
			return jsonb_build_object('id', p_request_id, 'status', existing_request.status, 'alreadySubmitted', true);
		end if;
		if existing_request.status not in ('draft', 'changes_requested') then
			raise exception 'This offer request can no longer be edited.' using errcode = '55000';
		end if;
		request_status := existing_request.status;
		update public.seller_offer_requests request
		set offer_kind = p_payload ->> 'offer_kind',
			title = p_payload ->> 'title',
			description = p_payload ->> 'description',
			benefit_details = p_payload ->> 'benefit_details',
			discount_percent = nullif(p_payload ->> 'discount_percent', '')::numeric,
			media_url = nullif(p_payload ->> 'media_url', ''),
			media_type = nullif(p_payload ->> 'media_type', ''),
			valid_from = v_valid_from,
			valid_until = v_valid_until,
			capacity_acknowledged = coalesce((p_payload ->> 'capacity_acknowledged')::boolean, false),
			request_payload_hash = payload_hash,
			review_note = case when p_submit then null else request.review_note end
		where request.id = p_request_id;
	else
		insert into public.seller_offer_requests (
			id, seller_profile_id, offer_kind, title, description, benefit_details,
			discount_percent, media_url, media_type, valid_from, valid_until,
			capacity_acknowledged, request_payload_hash
		)
		values (
			p_request_id, seller_id, p_payload ->> 'offer_kind', p_payload ->> 'title',
			p_payload ->> 'description', p_payload ->> 'benefit_details',
			nullif(p_payload ->> 'discount_percent', '')::numeric,
			nullif(p_payload ->> 'media_url', ''), nullif(p_payload ->> 'media_type', ''),
			v_valid_from, v_valid_until, coalesce((p_payload ->> 'capacity_acknowledged')::boolean, false), payload_hash
		);
	end if;

	delete from public.seller_offer_request_locations where request_id = p_request_id;
	for location_data in select value from jsonb_array_elements(p_payload -> 'locations') loop
		if jsonb_typeof(location_data -> 'schedules') is distinct from 'array'
			or jsonb_array_length(location_data -> 'schedules') not between 1 and 14 then
			raise exception 'Each branch needs at least one weekly opening schedule.' using errcode = '22023';
		end if;

		select city.city_id into selected_city_id
		from public.supported_cities city
		join public.supported_countries country on country.country_code = city.country_code
		where city.city_id = location_data ->> 'city_id'
			and city.country_code = 'GB' and city.is_enabled and country.is_enabled;
		if selected_city_id is null then
			raise exception 'Choose an enabled United Kingdom city for every branch.' using errcode = '22023';
		end if;

		insert into public.seller_offer_request_locations (request_id, city_id, branch_name, branch_address)
		values (
			p_request_id, selected_city_id, location_data ->> 'branch_name',
			nullif(btrim(location_data ->> 'branch_address'), '')
		)
		returning id into location_id;

		for schedule_data in select value from jsonb_array_elements(location_data -> 'schedules') loop
			insert into public.seller_offer_request_schedules (
				location_id, weekday, starts_at, ends_at, requested_daily_capacity
			)
			values (
				location_id, (schedule_data ->> 'weekday')::smallint,
				(schedule_data ->> 'starts_at')::time, (schedule_data ->> 'ends_at')::time,
				(schedule_data ->> 'daily_capacity')::integer
			);
		end loop;
	end loop;

	if p_submit then
		select count(*) into location_count
		from public.seller_offer_request_locations location
		where location.request_id = p_request_id;
		select count(*) into schedule_count
		from public.seller_offer_request_schedules schedule
		join public.seller_offer_request_locations location on location.id = schedule.location_id
		where location.request_id = p_request_id;
		select count(*) into matching_days
		from generate_series(v_valid_from, v_valid_until, interval '1 day') offer_day
		join public.seller_offer_request_schedules schedule
			on schedule.weekday = extract(dow from offer_day)::smallint
		join public.seller_offer_request_locations location on location.id = schedule.location_id
		where location.request_id = p_request_id;
		if location_count = 0 or schedule_count = 0 or matching_days = 0 then
			raise exception 'The submitted date range must include at least one scheduled opening time.' using errcode = '22023';
		end if;
		update public.seller_offer_requests
		set status = 'submitted', submitted_at = now(), seller_terms_accepted_at = now()
		where id = p_request_id;
		return jsonb_build_object('id', p_request_id, 'status', 'submitted', 'alreadySubmitted', false);
	end if;

	return jsonb_build_object('id', p_request_id, 'status', request_status, 'alreadySubmitted', false);
end;
$$;

revoke all on function public.seller_save_offer_request(uuid, jsonb, boolean) from public, anon;
grant execute on function public.seller_save_offer_request(uuid, jsonb, boolean) to authenticated;