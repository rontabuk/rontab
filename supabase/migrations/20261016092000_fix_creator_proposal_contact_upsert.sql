create or replace function public.creator_submit_product_opportunity_proposal(
	p_opportunity_id uuid,
	p_amount numeric,
	p_offer_details text,
	p_share_email boolean,
	p_share_phone boolean,
	p_contact_phone text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	current_user_id uuid := (select auth.uid());
	creator_id uuid;
	v_proposal_id uuid;
	account_email_confirmed_at timestamptz;
	opportunity public.creator_product_opportunities%rowtype;
begin
	select id into creator_id from public.creator_profiles
	where owner_id = current_user_id and is_public and status = 'approved';
	if creator_id is null or current_user_id is null then
		raise exception 'An approved public creator profile is required to make an offer.' using errcode = '42501';
	end if;
	select * into opportunity from public.creator_product_opportunities
	where id = p_opportunity_id for update;
	if not found or not (select public.creator_can_view_product_opportunity(p_opportunity_id)) then
		raise exception 'This opportunity is unavailable for your profile.' using errcode = '42501';
	end if;
	if exists (select 1 from public.seller_profiles seller where seller.user_id = current_user_id) then
		raise exception 'Seller accounts cannot apply to creator opportunities.' using errcode = '42501';
	end if;
	if p_amount is null or p_amount <= 0 or p_amount > 1000000 or p_amount <> round(p_amount, 2)
		or length(btrim(coalesce(p_offer_details, ''))) not between 30 and 2000
		or p_share_email is null or p_share_phone is null
		or (not p_share_email and not p_share_phone)
		or (p_share_phone and coalesce(btrim(p_contact_phone), '') !~ '^\+?[0-9() -]{7,32}$') then
		raise exception 'Enter a valid offer, delivery details, and contact preference.' using errcode = '22023';
	end if;
	if p_share_email then
		select email_confirmed_at into account_email_confirmed_at from auth.users where id = current_user_id;
		if account_email_confirmed_at is null then
			raise exception 'Confirm your account email before choosing it as a contact method.' using errcode = '55000';
		end if;
	end if;

	insert into public.creator_product_opportunity_proposals (
		opportunity_id, creator_profile_id, amount, offer_details, share_email, share_phone
	) values (
		p_opportunity_id, creator_id, p_amount, btrim(p_offer_details), p_share_email, p_share_phone
	)
	on conflict (opportunity_id, creator_profile_id) do update
	set amount = excluded.amount, offer_details = excluded.offer_details,
		share_email = excluded.share_email, share_phone = excluded.share_phone, status = 'pending'
	where public.creator_product_opportunity_proposals.status in ('pending', 'withdrawn')
	returning id into v_proposal_id;
	if v_proposal_id is null then
		raise exception 'You already have a completed offer for this opportunity.' using errcode = '55000';
	end if;
	insert into public.creator_product_opportunity_contacts (proposal_id, phone)
	values (v_proposal_id, case when p_share_phone then btrim(p_contact_phone) else null end)
	on conflict on constraint creator_product_opportunity_contacts_pkey
		do update set phone = excluded.phone, updated_at = now();
	return v_proposal_id;
end;
$$;