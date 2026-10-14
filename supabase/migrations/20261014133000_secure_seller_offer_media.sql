alter table public.seller_offer_requests
	add column media_storage_path text
		check (media_storage_path is null or media_storage_path ~* '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}-[^/]+$');
alter table public.seller_offer_requests drop constraint seller_offer_requests_check1;
alter table public.seller_offer_requests
	add constraint seller_offer_requests_media_reference_check
	check (
		(media_type is null and media_url is null and media_storage_path is null)
		or (media_type is not null and num_nonnulls(media_url, media_storage_path) = 1)
	);

alter table public.seller_offers
	add column media_storage_path text
		check (media_storage_path is null or media_storage_path ~* '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}-[^/]+$');
alter table public.seller_offers alter column media_url drop not null;
alter table public.seller_offers
	add constraint seller_offers_media_reference_check
	check (num_nonnulls(media_url, media_storage_path) = 1);

update storage.buckets set public = false where id = 'seller-offer-media';

create policy "Visitors read media for published seller offers"
	on storage.objects for select to anon, authenticated
	using (
		bucket_id = 'seller-offer-media'
		and exists (
			select 1 from public.seller_offers offer
			where offer.media_storage_path = storage.objects.name and offer.status = 'published'
		)
	);

create policy "Admins read seller offer request media"
	on storage.objects for select to authenticated
	using (
		bucket_id = 'seller-offer-media' and (select public.is_admin())
		and exists (select 1 from public.seller_offer_requests request where request.media_storage_path = storage.objects.name)
	);

create policy "Sellers read their editable offer request media"
	on storage.objects for select to authenticated
	using (
		bucket_id = 'seller-offer-media'
		and exists (
			select 1 from public.seller_profiles seller
			join public.seller_offer_requests request on request.seller_profile_id = seller.id
			where seller.user_id = (select auth.uid()) and seller.status = 'active'
				and request.media_storage_path = storage.objects.name
				and request.status in ('draft', 'changes_requested')
		)
	);

create or replace function public.seller_save_offer_request(p_request_id uuid, p_payload jsonb, p_submit boolean)
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
	v_media_url text := nullif(btrim(p_payload ->> 'media_url'), '');
	v_media_path text := nullif(btrim(p_payload ->> 'media_storage_path'), '');
	v_media_type text := nullif(p_payload ->> 'media_type', '');
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
	if seller_id is null then raise exception 'An active seller account is required.' using errcode = '42501'; end if;

	v_valid_from := (p_payload ->> 'valid_from')::date;
	v_valid_until := (p_payload ->> 'valid_until')::date;
	if v_valid_until < v_valid_from or p_payload ->> 'offer_kind' not in ('discount', 'meal', 'free_item', 'other')
		or jsonb_typeof(p_payload -> 'locations') is distinct from 'array'
		or jsonb_array_length(p_payload -> 'locations') not between 1 and 20 then
		raise exception 'Offer details, dates, or locations are invalid.' using errcode = '22023';
	end if;
	if (v_media_url is not null and v_media_path is not null)
		or (v_media_url is null and v_media_path is null and v_media_type is not null)
		or (v_media_url is not null and (v_media_type is null or v_media_url !~* '^https://'))
		or (v_media_path is not null and v_media_type not in ('image', 'video')) then
		raise exception 'Choose one valid external media URL or uploaded media file.' using errcode = '22023';
	end if;
	if v_media_path is not null and (
		v_media_path !~ ('^' || seller_id::text || '/' || p_request_id::text || '/[0-9a-f-]{36}-[^/]+$')
		or not exists (select 1 from storage.objects object where object.bucket_id = 'seller-offer-media' and object.name = v_media_path)
	) then
		raise exception 'Offer media must be uploaded to this request before saving.' using errcode = '22023';
	end if;
	if p_submit and (coalesce((p_payload ->> 'capacity_acknowledged')::boolean, false) is not true
		or (v_media_url is null and v_media_path is null) or v_media_type not in ('image', 'video')) then
		raise exception 'Confirm daily capacity and provide offer media before submitting.' using errcode = '22023';
	end if;

	payload_hash := md5(p_payload::text);
	select * into existing_request from public.seller_offer_requests request where request.id = p_request_id for update;
	if found then
		if existing_request.seller_profile_id <> seller_id then raise exception 'Offer request is unavailable.' using errcode = '42501'; end if;
		if existing_request.status = 'submitted' and p_submit and existing_request.request_payload_hash = payload_hash then
			return jsonb_build_object('id', p_request_id, 'status', existing_request.status, 'alreadySubmitted', true);
		end if;
		if existing_request.status not in ('draft', 'changes_requested') then
			raise exception 'This offer request can no longer be edited.' using errcode = '55000';
		end if;
		request_status := existing_request.status;
		update public.seller_offer_requests request
		set offer_kind = p_payload ->> 'offer_kind', title = p_payload ->> 'title',
			description = p_payload ->> 'description', benefit_details = p_payload ->> 'benefit_details',
			discount_percent = nullif(p_payload ->> 'discount_percent', '')::numeric,
			media_url = v_media_url, media_storage_path = v_media_path, media_type = v_media_type,
			valid_from = v_valid_from, valid_until = v_valid_until,
			capacity_acknowledged = coalesce((p_payload ->> 'capacity_acknowledged')::boolean, false),
			request_payload_hash = payload_hash,
			review_note = case when p_submit then null else request.review_note end
		where request.id = p_request_id;
	else
		insert into public.seller_offer_requests (
			id, seller_profile_id, offer_kind, title, description, benefit_details, discount_percent,
			media_url, media_storage_path, media_type, valid_from, valid_until, capacity_acknowledged, request_payload_hash
		)
		values (
			p_request_id, seller_id, p_payload ->> 'offer_kind', p_payload ->> 'title',
			p_payload ->> 'description', p_payload ->> 'benefit_details', nullif(p_payload ->> 'discount_percent', '')::numeric,
			v_media_url, v_media_path, v_media_type, v_valid_from, v_valid_until,
			coalesce((p_payload ->> 'capacity_acknowledged')::boolean, false), payload_hash
		);
	end if;

	delete from public.seller_offer_request_locations where request_id = p_request_id;
	for location_data in select value from jsonb_array_elements(p_payload -> 'locations') loop
		if jsonb_typeof(location_data -> 'schedules') is distinct from 'array'
			or jsonb_array_length(location_data -> 'schedules') not between 1 and 14 then
			raise exception 'Each branch needs at least one weekly opening schedule.' using errcode = '22023';
		end if;
		select city.city_id into selected_city_id
		from public.supported_cities city join public.supported_countries country on country.country_code = city.country_code
		where city.city_id = location_data ->> 'city_id' and city.country_code = 'GB' and city.is_enabled and country.is_enabled;
		if selected_city_id is null then raise exception 'Choose an enabled United Kingdom city for every branch.' using errcode = '22023'; end if;
		insert into public.seller_offer_request_locations (request_id, city_id, branch_name, branch_address)
		values (p_request_id, selected_city_id, location_data ->> 'branch_name', nullif(btrim(location_data ->> 'branch_address'), ''))
		returning id into location_id;
		for schedule_data in select value from jsonb_array_elements(location_data -> 'schedules') loop
			insert into public.seller_offer_request_schedules (location_id, weekday, starts_at, ends_at, requested_daily_capacity)
			values (location_id, (schedule_data ->> 'weekday')::smallint, (schedule_data ->> 'starts_at')::time,
				(schedule_data ->> 'ends_at')::time, (schedule_data ->> 'daily_capacity')::integer);
		end loop;
	end loop;

	if p_submit then
		select count(*) into location_count from public.seller_offer_request_locations location where location.request_id = p_request_id;
		select count(*) into schedule_count from public.seller_offer_request_schedules schedule
		join public.seller_offer_request_locations location on location.id = schedule.location_id where location.request_id = p_request_id;
		select count(*) into matching_days from generate_series(v_valid_from, v_valid_until, interval '1 day') offer_day
		join public.seller_offer_request_schedules schedule on schedule.weekday = extract(dow from offer_day)::smallint
		join public.seller_offer_request_locations location on location.id = schedule.location_id where location.request_id = p_request_id;
		if location_count = 0 or schedule_count = 0 or matching_days = 0 then
			raise exception 'The submitted date range must include at least one scheduled opening time.' using errcode = '22023';
		end if;
		update public.seller_offer_requests set status = 'submitted', submitted_at = now(), seller_terms_accepted_at = now() where id = p_request_id;
		return jsonb_build_object('id', p_request_id, 'status', 'submitted', 'alreadySubmitted', false);
	end if;
	return jsonb_build_object('id', p_request_id, 'status', request_status, 'alreadySubmitted', false);
end;
$$;

create or replace function public.admin_decide_seller_offer_request(
	p_request_id uuid, p_decision text, p_review_note text, p_points_cost integer, p_final_terms text, p_daily_capacity integer
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
	if not (select public.is_admin()) then raise exception 'Administrator access is required.' using errcode = '42501'; end if;
	if p_request_id is null or p_decision is null or p_decision not in ('approve', 'changes_requested', 'reject')
		or length(coalesce(p_review_note, '')) > 2000 then raise exception 'Offer review decision is invalid.' using errcode = '22023'; end if;
	if p_decision <> 'approve' and v_review_note is null then raise exception 'Add a review note when requesting changes or rejecting an offer.' using errcode = '22023'; end if;
	if p_decision = 'approve' and (p_points_cost is null or p_points_cost not between 1 and 1000000
		or length(btrim(coalesce(p_final_terms, ''))) not between 10 and 5000
		or p_daily_capacity is null or p_daily_capacity not between 1 and 1000) then
		raise exception 'Approved offers need valid points, final terms, and a daily capacity.' using errcode = '22023';
	end if;
	select * into request from public.seller_offer_requests where id = p_request_id for update;
	if not found then raise exception 'Offer request not found.' using errcode = 'P0002'; end if;
	if request.status <> 'submitted' then raise exception 'Only submitted offer requests can be reviewed.' using errcode = '55000'; end if;
	if p_decision = 'approve' and exists (
		select 1 from public.seller_offer_requests request_row
		join public.seller_offer_request_locations location on location.request_id = request_row.id
		join public.seller_offer_request_schedules schedule on schedule.location_id = location.id
		where request_row.id = p_request_id and not exists (
			select 1 from generate_series(request_row.valid_from, request_row.valid_until, interval '1 day') offer_day
			where extract(dow from offer_day)::smallint = schedule.weekday
		)
	) then raise exception 'The requested schedule has no matching date in the validity period.' using errcode = '22023'; end if;

	if p_decision = 'approve' then
		insert into public.seller_offers (
			request_id, seller_profile_id, offer_kind, title, description, benefit_details, discount_percent,
			media_url, media_storage_path, media_type, points_cost, terms, valid_from, valid_until, approved_by
		)
		values (
			request.id, request.seller_profile_id, request.offer_kind, request.title, request.description,
			request.benefit_details, request.discount_percent, request.media_url, request.media_storage_path,
			request.media_type, p_points_cost, btrim(p_final_terms), request.valid_from, request.valid_until, admin_id
		)
		returning id into new_offer_id;
		for request_location in select * from public.seller_offer_request_locations where request_id = p_request_id order by id loop
			insert into public.seller_offer_locations (offer_id, city_id, branch_name, branch_address)
			values (new_offer_id, request_location.city_id, request_location.branch_name, request_location.branch_address)
			returning id into new_location_id;
			insert into public.seller_offer_schedules (location_id, weekday, starts_at, ends_at, daily_capacity)
			select new_location_id, schedule.weekday, schedule.starts_at, schedule.ends_at, p_daily_capacity
			from public.seller_offer_request_schedules schedule where schedule.location_id = request_location.id;
		end loop;
	else
		new_offer_id := null;
	end if;
	update public.seller_offer_requests request_row
	set status = case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' else 'changes_requested' end,
		review_note = v_review_note, reviewed_by = admin_id, reviewed_at = now()
	where request_row.id = p_request_id;
	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values (admin_id, 'seller_offer_request_' || p_decision, 'seller_offer_request', p_request_id,
		jsonb_build_object('decision', p_decision, 'review_note', v_review_note, 'offer_id', new_offer_id,
		'points_cost', case when p_decision = 'approve' then p_points_cost else null end,
		'daily_capacity', case when p_decision = 'approve' then p_daily_capacity else null end));
	return new_offer_id;
end;
$$;