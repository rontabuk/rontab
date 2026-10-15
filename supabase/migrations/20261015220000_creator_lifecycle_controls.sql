alter table public.creator_profiles
	drop constraint creator_profiles_status_check,
	add column suspended_from_status text,
	add constraint creator_profiles_status_check
		check (status in ('draft', 'submitted', 'changes_requested', 'approved', 'rejected', 'suspended', 'withdrawn')),
	add constraint creator_profiles_suspended_from_status_check
		check (suspended_from_status is null or suspended_from_status in ('submitted', 'changes_requested', 'approved', 'rejected'));

update public.creator_profiles
set suspended_from_status = case
	when exists (
		select 1 from public.creator_platform_accounts account
		where account.creator_profile_id = creator_profiles.id and not account.is_published
	) or exists (
		select 1 from public.creator_portfolio_items item
		where item.creator_profile_id = creator_profiles.id and not item.is_published
	) then 'submitted'
	else 'approved'
end
where status = 'suspended';

alter table public.creator_profile_reviews
	drop constraint creator_profile_reviews_decision_check,
	add constraint creator_profile_reviews_decision_check
		check (decision in ('approved', 'changes_requested', 'rejected', 'suspended', 'reinstated'));

create or replace function public.admin_review_creator_profile(
	p_creator_profile_id uuid,
	p_decision text,
	p_review_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	creator_profile public.creator_profiles%rowtype;
	admin_id uuid := (select auth.uid());
	review_note text := nullif(btrim(p_review_note), '');
	new_status text;
	review_decision text;
begin
	if not (select public.is_admin()) then
		raise exception 'Administrator access is required.' using errcode = '42501';
	end if;
	if p_creator_profile_id is null or p_decision is null
		or p_decision not in ('approve', 'changes_requested', 'reject', 'suspend', 'reinstate')
		or length(coalesce(p_review_note, '')) > 2000
		or (p_decision in ('changes_requested', 'reject', 'suspend') and review_note is null) then
		raise exception 'Provide a valid creator review decision and a note when needed.' using errcode = '22023';
	end if;

	select * into creator_profile
	from public.creator_profiles
	where id = p_creator_profile_id
	for update;
	if not found then
		raise exception 'Creator profile not found.' using errcode = 'P0002';
	end if;

	if p_decision = 'suspend' then
		if not creator_profile.is_public then
			raise exception 'Only public creator profiles can be suspended.' using errcode = '55000';
		end if;
		new_status := 'suspended';
		review_decision := 'suspended';
		update public.creator_profiles
		set status = new_status, is_public = false, suspended_from_status = creator_profile.status, reviewed_at = now()
		where id = p_creator_profile_id;
	elsif p_decision = 'reinstate' then
		if creator_profile.status <> 'suspended' then
			raise exception 'Only suspended creator profiles can be reinstated.' using errcode = '55000';
		end if;
		new_status := coalesce(creator_profile.suspended_from_status, 'approved');
		review_decision := 'reinstated';
		update public.creator_profiles
		set status = new_status, is_public = true, suspended_from_status = null, reviewed_at = now()
		where id = p_creator_profile_id;
	elsif creator_profile.status = 'submitted' and p_decision in ('approve', 'changes_requested', 'reject') then
		new_status := case p_decision
			when 'approve' then 'approved'
			when 'changes_requested' then 'changes_requested'
			else 'rejected'
		end;
		review_decision := new_status;
		if p_decision = 'approve' then
			update public.creator_profiles
			set published_display_name = display_name,
				published_bio = bio,
				published_specialties = specialties,
				published_audience_city_id = audience_city_id,
				status = new_status, is_public = true, suspended_from_status = null, reviewed_at = now()
			where id = p_creator_profile_id;
			delete from public.creator_platform_accounts
			where creator_profile_id = p_creator_profile_id and is_published;
			update public.creator_platform_accounts
			set is_published = true
			where creator_profile_id = p_creator_profile_id and not is_published;
			delete from public.creator_portfolio_items
			where creator_profile_id = p_creator_profile_id and is_published;
			update public.creator_portfolio_items
			set is_published = true
			where creator_profile_id = p_creator_profile_id and not is_published;
		else
			update public.creator_profiles
			set status = new_status, reviewed_at = now()
			where id = p_creator_profile_id;
		end if;
	else
		raise exception 'Only submitted profiles can be reviewed.' using errcode = '55000';
	end if;

	insert into public.creator_profile_reviews (creator_profile_id, decision, review_note, admin_id)
	values (p_creator_profile_id, review_decision, review_note, admin_id);
	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values (admin_id, 'creator_profile_' || review_decision, 'creator_profile', p_creator_profile_id,
		jsonb_build_object('decision', review_decision, 'status', new_status, 'review_note', review_note));
end;
$$;

create function public.creator_withdraw_public_profile()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	creator_profile public.creator_profiles%rowtype;
begin
	if (select auth.uid()) is null then
		raise exception 'Sign in to withdraw your creator profile.' using errcode = '42501';
	end if;

	select * into creator_profile
	from public.creator_profiles
	where owner_id = (select auth.uid())
	for update;
	if not found then
		raise exception 'Creator profile not found.' using errcode = 'P0002';
	end if;
	if creator_profile.status = 'suspended' then
		raise exception 'Contact Rontab support about a suspended profile.' using errcode = '55000';
	end if;

	update public.creator_profiles
	set status = 'withdrawn', is_public = false, suspended_from_status = null, reviewed_at = now()
	where id = creator_profile.id and status <> 'withdrawn';
end;
$$;

create or replace function public.creator_decide_collaboration_request(
	p_request_id uuid,
	p_decision text,
	p_response text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	request public.creator_collaboration_requests%rowtype;
	new_status text;
begin
	if p_request_id is null or p_decision is null or p_decision not in ('accept', 'decline')
		or length(coalesce(p_response, '')) > 2000 then
		raise exception 'Invalid collaboration response.' using errcode = '22023';
	end if;
	select * into request
	from public.creator_collaboration_requests
	where id = p_request_id
	for update;
	if not found or not (select public.is_creator_profile_owner(request.creator_profile_id)) then
		raise exception 'Collaboration request not found.' using errcode = '42501';
	end if;
	if not exists (
		select 1 from public.creator_profiles
		where id = request.creator_profile_id and is_public
	) then
		raise exception 'This creator profile is not accepting requests.' using errcode = '55000';
	end if;
	if request.status <> 'pending' then
		raise exception 'This collaboration request has already been answered.' using errcode = '55000';
	end if;
	new_status := case p_decision when 'accept' then 'accepted' else 'declined' end;
	update public.creator_collaboration_requests
	set status = new_status, creator_response = nullif(btrim(p_response), ''), responded_at = now()
	where id = p_request_id;
end;
$$;

revoke all on function public.creator_withdraw_public_profile() from public, anon;
grant execute on function public.creator_withdraw_public_profile() to authenticated;