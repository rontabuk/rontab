create or replace function public.get_creator_product_opportunity_contact(p_proposal_id uuid)
returns table (email text, phone text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	proposal public.creator_product_opportunity_proposals%rowtype;
	opportunity public.creator_product_opportunities%rowtype;
	creator_owner_id uuid;
	viewer_is_seller boolean;
begin
	select * into proposal from public.creator_product_opportunity_proposals where id = p_proposal_id and status = 'selected';
	if not found then
		raise exception 'Contact details are available only for the selected offer.' using errcode = '42501';
	end if;
	select * into opportunity from public.creator_product_opportunities where id = proposal.opportunity_id;
	viewer_is_seller := (select public.is_seller_owner(opportunity.seller_profile_id));
	if viewer_is_seller then
		return query
		select
			case when proposal.share_email and account.email_confirmed_at is not null then account.email::text else null::text end,
			case when proposal.share_phone then contact.phone::text else null::text end
		from public.creator_profiles creator
		join auth.users account on account.id = creator.owner_id
		left join public.creator_product_opportunity_contacts contact on contact.proposal_id = proposal.id
		where creator.id = proposal.creator_profile_id;
		return;
	end if;
	select creator.owner_id into creator_owner_id from public.creator_profiles creator where creator.id = proposal.creator_profile_id;
	if creator_owner_id is distinct from (select auth.uid()) then
		raise exception 'Contact details are available only to the selected parties.' using errcode = '42501';
	end if;
	return query
	select
		case when 'email' = any(opportunity.contact_methods) and contact.registered_email_confirmed_at is not null then contact.registered_email::text else null::text end,
		case when 'phone' = any(opportunity.contact_methods) and contact.phone_contact_confirmed_at is not null then contact.phone::text else null::text end
	from public.seller_contact_details contact
	where contact.seller_profile_id = opportunity.seller_profile_id;
end;
$$;