-- Creator collaborations now run only through seller-priced product opportunities.
-- 1. Remove the legacy direct collaboration-request system.
-- 2. Add fixed/negotiable pricing, private invitations, a minimum budget,
--    delivery/completion tracking, and two-way ratings.

-- 1. Legacy direct collaboration requests -----------------------------------

delete from public.notification_events
where notification_id in (
	select 'creator-event-' || event.id::text
	from public.creator_notification_events event
	where event.event_type in (
		'collaboration_request_received', 'collaboration_request_accepted', 'collaboration_request_declined',
		'collaboration_request_withdrawn', 'creator_profile_unavailable', 'creator_profile_restored'
	)
);
delete from public.creator_notification_events
where event_type in (
	'collaboration_request_received', 'collaboration_request_accepted', 'collaboration_request_declined',
	'collaboration_request_withdrawn', 'creator_profile_unavailable', 'creator_profile_restored'
);

drop trigger if exists creator_public_availability_notification_after_update on public.creator_profiles;
drop function if exists public.record_creator_public_availability_notification();
drop function if exists public.seller_create_creator_collaboration_request(uuid, uuid, text, text, text);
drop function if exists public.creator_decide_collaboration_request(uuid, text, text);
drop function if exists public.seller_withdraw_creator_collaboration_request(uuid);
drop table if exists public.creator_collaboration_requests;
drop function if exists public.record_creator_collaboration_request_notification();
drop function if exists public.record_creator_collaboration_status_notification();

alter table public.creator_notification_events
	drop constraint creator_notification_events_event_type_check,
	add constraint creator_notification_events_event_type_check
		check (event_type in (
			'creator_profile_approved',
			'creator_profile_changes_requested',
			'creator_profile_rejected',
			'creator_profile_suspended',
			'creator_profile_reinstated',
			'creator_product_opportunity_published',
			'creator_product_opportunity_invited',
			'creator_product_opportunity_selected',
			'creator_product_opportunity_delivered',
			'creator_product_opportunity_revision_requested',
			'creator_product_opportunity_completed'
		));

-- 2. Opportunity enhancements ------------------------------------------------

alter table public.creator_product_opportunities
	add column allow_counter_offers boolean not null default true,
	add column invited_creator_profile_id uuid references public.creator_profiles (id) on delete cascade,
	add column delivery_url text check (delivery_url is null or (delivery_url ~ '^https://[^[:space:]]+$' and length(delivery_url) <= 500)),
	add column delivery_note text check (delivery_note is null or length(btrim(delivery_note)) between 1 and 1000),
	add column revision_note text check (revision_note is null or length(btrim(revision_note)) between 1 and 1000),
	add column delivered_at timestamptz,
	add column completed_at timestamptz,
	drop constraint creator_product_opportunities_status_check,
	add constraint creator_product_opportunities_status_check
		check (status in ('open', 'awarded', 'delivered', 'completed', 'closed'));

drop index public.creator_product_opportunities_one_open_per_product_idx;
create unique index creator_product_opportunities_one_open_per_product_idx
	on public.creator_product_opportunities (product_id)
	where status = 'open' and invited_creator_profile_id is null;
create unique index creator_product_opportunities_one_open_invite_idx
	on public.creator_product_opportunities (product_id, invited_creator_profile_id)
	where status = 'open' and invited_creator_profile_id is not null;
create index creator_product_opportunities_invited_creator_idx
	on public.creator_product_opportunities (invited_creator_profile_id, created_at desc)
	where invited_creator_profile_id is not null;

create table public.creator_product_opportunity_reviews (
	id uuid primary key default gen_random_uuid(),
	opportunity_id uuid not null references public.creator_product_opportunities (id) on delete cascade,
	creator_profile_id uuid not null references public.creator_profiles (id) on delete cascade,
	seller_profile_id uuid not null references public.seller_profiles (id) on delete cascade,
	reviewer_role text not null check (reviewer_role in ('seller', 'creator')),
	rating smallint not null check (rating between 1 and 5),
	comment text check (comment is null or length(btrim(comment)) between 1 and 500),
	created_at timestamptz not null default now(),
	unique (opportunity_id, reviewer_role)
);
create index creator_product_opportunity_reviews_creator_idx
	on public.creator_product_opportunity_reviews (creator_profile_id) where reviewer_role = 'seller';
create index creator_product_opportunity_reviews_seller_idx
	on public.creator_product_opportunity_reviews (seller_profile_id) where reviewer_role = 'creator';

alter table public.creator_product_opportunity_reviews enable row level security;
revoke all on public.creator_product_opportunity_reviews from public, anon, authenticated;
grant select on public.creator_product_opportunity_reviews to authenticated;
create policy "Collaboration participants and admins read reviews"
	on public.creator_product_opportunity_reviews for select to authenticated
	using (
		(select public.is_seller_owner(seller_profile_id))
		or (select public.is_creator_profile_owner(creator_profile_id))
		or (select public.is_admin())
	);

create or replace function public.creator_can_view_product_opportunity(p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		from public.creator_product_opportunities opportunity
		join public.products product on product.id = opportunity.product_id
		join public.categories category on category.id = product.category_id and category.is_active
		join public.seller_profiles seller on seller.id = opportunity.seller_profile_id and seller.status = 'active' and seller.is_public
		join public.creator_profiles creator on creator.owner_id = (select auth.uid()) and creator.is_public
		where opportunity.id = p_opportunity_id
			and product.status = 'approved'
			and (
				(
					opportunity.status = 'open'
					and creator.status = 'approved'
					and (opportunity.invited_creator_profile_id is null or opportunity.invited_creator_profile_id = creator.id)
				)
				or exists (
					select 1 from public.creator_product_opportunity_proposals proposal
					where proposal.opportunity_id = opportunity.id and proposal.creator_profile_id = creator.id
				)
			)
	);
$$;

create or replace function public.notify_creators_of_product_opportunity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.status <> 'open' then return new; end if;

	insert into public.creator_notification_events (recipient_id, event_type, title, body, href)
	select distinct
		creator.owner_id,
		case when new.invited_creator_profile_id is null then 'creator_product_opportunity_published' else 'creator_product_opportunity_invited' end,
		case when new.invited_creator_profile_id is null then 'New creator opportunity' else 'You were invited to promote a product' end,
		coalesce(seller.shop_name, 'A Rontab seller') || ': ' || product.name,
		case when new.invited_creator_profile_id is null then '/visitor/creator/opportunities' else '/visitor/creator/opportunities/' || new.id::text end
	from public.creator_profiles creator
	join public.products product on product.id = new.product_id and product.status = 'approved'
	join public.categories category on category.id = product.category_id and category.is_active
	join public.seller_profiles seller on seller.id = new.seller_profile_id
		and seller.status = 'active' and seller.is_public
	where creator.is_public
		and creator.status = 'approved'
		and (new.invited_creator_profile_id is null or creator.id = new.invited_creator_profile_id)
		and not exists (
			select 1 from public.seller_profiles creator_seller
			where creator_seller.user_id = creator.owner_id
		);
	return new;
end;
$$;

drop function public.seller_create_creator_product_opportunity(uuid, numeric, text[], boolean, text[], text, boolean, date, text[]);

create function public.seller_create_creator_product_opportunity(
	p_product_id uuid,
	p_budget numeric,
	p_target_specialties text[],
	p_is_nationwide boolean,
	p_target_city_ids text[],
	p_brief text,
	p_product_provided boolean,
	p_deadline date,
	p_contact_methods text[],
	p_allow_counter_offers boolean default true,
	p_invited_creator_profile_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	current_user_id uuid := (select auth.uid());
	opportunity_id uuid;
	product public.products%rowtype;
	invited_specialties text[];
	v_target_specialties text[] := p_target_specialties;
	v_is_nationwide boolean := p_is_nationwide;
	v_target_city_ids text[] := p_target_city_ids;
begin
	if current_user_id is null or p_product_id is null then
		raise exception 'Sign in as an active seller and choose a product.' using errcode = '42501';
	end if;
	select * into product from public.products where id = p_product_id for update;
	if not found or not exists (
		select 1 from public.seller_profiles seller
		where seller.id = product.seller_profile_id and seller.user_id = current_user_id and seller.status = 'active'
	) then
		raise exception 'Active seller-owned product not found.' using errcode = '42501';
	end if;
	if product.status <> 'approved' or not exists (
		select 1 from public.categories category where category.id = product.category_id and category.is_active
	) then
		raise exception 'Only an approved live product can be promoted.' using errcode = '55000';
	end if;
	if p_budget is null or p_budget < 20 or p_budget > 1000000 or p_budget <> round(p_budget, 2) then
		raise exception 'Enter a promotion budget of at least 20.' using errcode = '22023';
	end if;
	if length(btrim(coalesce(p_brief, ''))) not between 30 and 2000
		or p_product_provided is null
		or p_allow_counter_offers is null
		or p_deadline is not null and p_deadline < current_date
		or p_deadline is not null and p_deadline > current_date + 365 then
		raise exception 'Enter a valid campaign brief, pricing option, and future deadline.' using errcode = '22023';
	end if;

	if p_invited_creator_profile_id is not null then
		select coalesce(creator.published_specialties, '{}'::text[]) into invited_specialties
		from public.creator_profiles creator
		where creator.id = p_invited_creator_profile_id and creator.is_public and creator.status = 'approved'
			and not exists (select 1 from public.seller_profiles creator_seller where creator_seller.user_id = creator.owner_id);
		if not found then
			raise exception 'This creator is not available for invitations.' using errcode = '55000';
		end if;
		v_target_specialties := case
			when cardinality(invited_specialties) between 1 and 5 then invited_specialties
			when cardinality(invited_specialties) > 5 then invited_specialties[1:5]
			else array['other']
		end;
		v_is_nationwide := true;
		v_target_city_ids := '{}'::text[];
	end if;

	if v_target_specialties is null or cardinality(v_target_specialties) not between 1 and 5
		or exists (
			select 1 from unnest(v_target_specialties) specialty
			where specialty is null or specialty not in ('food', 'beauty', 'fashion', 'technology', 'travel', 'home', 'fitness', 'family', 'local', 'other')
		)
		or (select count(distinct selected.value) from unnest(v_target_specialties) as selected(value)) <> cardinality(v_target_specialties) then
		raise exception 'Choose between one and five different creator specialties.' using errcode = '22023';
	end if;
	if v_is_nationwide is null or v_target_city_ids is null
		or (v_is_nationwide and cardinality(v_target_city_ids) <> 0)
		or (not v_is_nationwide and cardinality(v_target_city_ids) not between 1 and 15)
		or exists (
			select 1 from unnest(v_target_city_ids) selected(city_id)
			where selected.city_id is null or not exists (
				select 1 from public.supported_cities city
				join public.supported_countries country on country.country_code = city.country_code
				where city.city_id = selected.city_id and city.is_enabled and country.is_enabled
			)
		)
		or (select count(*) from unnest(v_target_city_ids) as selected(city_id))
			<> (select count(distinct selected.city_id) from unnest(v_target_city_ids) as selected(city_id)) then
		raise exception 'Choose the whole United Kingdom or one to 15 different supported cities.' using errcode = '22023';
	end if;
	if p_contact_methods is null or cardinality(p_contact_methods) not between 1 and 2
		or exists (select 1 from unnest(p_contact_methods) method where method is null or method not in ('email', 'phone'))
		or (select count(distinct selected.value) from unnest(p_contact_methods) as selected(value)) <> cardinality(p_contact_methods) then
		raise exception 'Choose email, phone, or both as seller contact methods.' using errcode = '22023';
	end if;
	if not exists (
		select 1 from public.seller_contact_details contact
		where contact.seller_profile_id = product.seller_profile_id
			and (not ('email' = any(p_contact_methods)) or contact.registered_email_confirmed_at is not null)
			and (not ('phone' = any(p_contact_methods)) or (contact.phone is not null and contact.phone_contact_confirmed_at is not null))
	) then
		raise exception 'Verify the contact methods you want to share before publishing.' using errcode = '55000';
	end if;

	insert into public.creator_product_opportunities (
		product_id, seller_profile_id, budget, currency, target_specialties, is_nationwide,
		target_city_ids, brief, product_provided, deadline, contact_methods,
		allow_counter_offers, invited_creator_profile_id
	) values (
		product.id, product.seller_profile_id, p_budget, product.currency, v_target_specialties, v_is_nationwide,
		v_target_city_ids, btrim(p_brief), p_product_provided, p_deadline, p_contact_methods,
		p_allow_counter_offers, p_invited_creator_profile_id
	) returning id into opportunity_id;
	return opportunity_id;
exception when unique_violation then
	if p_invited_creator_profile_id is null then
		raise exception 'This product already has an open creator opportunity.' using errcode = '23505';
	end if;
	raise exception 'This creator already has an open invitation for this product.' using errcode = '23505';
end;
$$;

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
	if opportunity.status <> 'open' then
		raise exception 'This opportunity is no longer accepting offers.' using errcode = '55000';
	end if;
	if p_amount is null or p_amount <= 0 or p_amount > 1000000 or p_amount <> round(p_amount, 2)
		or length(btrim(coalesce(p_offer_details, ''))) not between 30 and 2000
		or p_share_email is null or p_share_phone is null
		or (not p_share_email and not p_share_phone)
		or (p_share_phone and coalesce(btrim(p_contact_phone), '') !~ '^\+?[0-9() -]{7,32}$') then
		raise exception 'Enter a valid offer, delivery details, and contact preference.' using errcode = '22023';
	end if;
	if not opportunity.allow_counter_offers and p_amount <> opportunity.budget then
		raise exception 'This seller set a fixed price. Your offer must match the promotion budget.' using errcode = '22023';
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

create or replace function public.seller_select_creator_product_opportunity_proposal(p_proposal_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	opportunity public.creator_product_opportunities%rowtype;
	creator_id uuid;
	creator_owner_id uuid;
	product_name text;
begin
	select campaign.* into opportunity
	from public.creator_product_opportunities campaign
	join public.creator_product_opportunity_proposals proposal on proposal.opportunity_id = campaign.id
	where proposal.id = p_proposal_id
	for update of campaign;
	if not found or not (select public.is_active_seller_owner(opportunity.seller_profile_id)) then
		raise exception 'Product opportunity not found for this active seller.' using errcode = '42501';
	end if;
	if opportunity.status <> 'open' or not exists (
		select 1 from public.creator_product_opportunity_proposals proposal
		where proposal.id = p_proposal_id and proposal.status = 'pending'
	) then
		raise exception 'This offer is no longer available for selection.' using errcode = '55000';
	end if;
	select product.name into product_name
	from public.products product
	join public.categories category on category.id = product.category_id and category.is_active
	where product.id = opportunity.product_id and product.status = 'approved';
	if not found then
		raise exception 'The product is no longer live, so this offer cannot be selected.' using errcode = '55000';
	end if;
	select proposal.creator_profile_id, creator.owner_id into creator_id, creator_owner_id
	from public.creator_product_opportunity_proposals proposal
	join public.creator_profiles creator on creator.id = proposal.creator_profile_id
	where proposal.id = p_proposal_id;
	update public.creator_product_opportunity_proposals
	set status = case when id = p_proposal_id then 'selected' else 'not_selected' end
	where opportunity_id = opportunity.id and status = 'pending';
	update public.creator_product_opportunities set status = 'awarded' where id = opportunity.id;

	insert into public.creator_notification_events (recipient_id, event_type, title, body, href)
	values (creator_owner_id, 'creator_product_opportunity_selected', 'Your offer was selected',
		product_name || ': contact the seller and deliver the promotion.', '/visitor/creator/opportunities/' || opportunity.id::text);
	return creator_id;
end;
$$;

create function public.creator_mark_product_opportunity_delivered(
	p_opportunity_id uuid,
	p_delivery_url text,
	p_delivery_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	opportunity public.creator_product_opportunities%rowtype;
	seller_user_id uuid;
	product_name text;
	note text := nullif(btrim(coalesce(p_delivery_note, '')), '');
	url text := btrim(coalesce(p_delivery_url, ''));
begin
	select * into opportunity from public.creator_product_opportunities where id = p_opportunity_id for update;
	if not found or not exists (
		select 1 from public.creator_product_opportunity_proposals proposal
		join public.creator_profiles creator on creator.id = proposal.creator_profile_id
		where proposal.opportunity_id = opportunity.id and proposal.status = 'selected'
			and creator.owner_id = (select auth.uid())
	) then
		raise exception 'Only the selected creator can deliver this promotion.' using errcode = '42501';
	end if;
	if opportunity.status <> 'awarded' then
		raise exception 'This promotion is not waiting for delivery.' using errcode = '55000';
	end if;
	if url !~ '^https://[^[:space:]]+$' or length(url) > 500 or (note is not null and length(note) > 1000) then
		raise exception 'Add a secure https link to the published content and a note under 1,000 characters.' using errcode = '22023';
	end if;
	update public.creator_product_opportunities
	set status = 'delivered', delivery_url = url, delivery_note = note, delivered_at = now()
	where id = opportunity.id;

	select seller.user_id, product.name into seller_user_id, product_name
	from public.seller_profiles seller
	join public.products product on product.id = opportunity.product_id
	where seller.id = opportunity.seller_profile_id;
	insert into public.creator_notification_events (recipient_id, event_type, title, body, href)
	values (seller_user_id, 'creator_product_opportunity_delivered', 'Creator delivered your promotion',
		coalesce(product_name, 'Your product') || ': review the content and confirm completion.',
		'/seller/products/' || opportunity.product_id::text || '/creator-opportunity?opportunity=' || opportunity.id::text);
end;
$$;

create function public.seller_review_product_opportunity_delivery(
	p_opportunity_id uuid,
	p_decision text,
	p_revision_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	opportunity public.creator_product_opportunities%rowtype;
	creator_owner_id uuid;
	product_name text;
	note text := nullif(btrim(coalesce(p_revision_note, '')), '');
begin
	select * into opportunity from public.creator_product_opportunities where id = p_opportunity_id for update;
	if not found or not (select public.is_active_seller_owner(opportunity.seller_profile_id)) then
		raise exception 'Product opportunity not found for this active seller.' using errcode = '42501';
	end if;
	if opportunity.status <> 'delivered' then
		raise exception 'This promotion has no delivery waiting for review.' using errcode = '55000';
	end if;
	if p_decision is null or p_decision not in ('complete', 'revise')
		or (p_decision = 'revise' and (note is null or length(note) not between 10 and 1000)) then
		raise exception 'Confirm completion, or explain the requested changes in 10 to 1,000 characters.' using errcode = '22023';
	end if;

	select creator.owner_id into creator_owner_id
	from public.creator_product_opportunity_proposals proposal
	join public.creator_profiles creator on creator.id = proposal.creator_profile_id
	where proposal.opportunity_id = opportunity.id and proposal.status = 'selected';
	select product.name into product_name from public.products product where product.id = opportunity.product_id;

	if p_decision = 'complete' then
		update public.creator_product_opportunities
		set status = 'completed', completed_at = now(), revision_note = null
		where id = opportunity.id;
		insert into public.creator_notification_events (recipient_id, event_type, title, body, href)
		values (creator_owner_id, 'creator_product_opportunity_completed', 'Promotion marked complete',
			coalesce(product_name, 'The product') || ': the seller confirmed your delivery. You can now rate the collaboration.',
			'/visitor/creator/opportunities/' || opportunity.id::text);
	else
		update public.creator_product_opportunities
		set status = 'awarded', revision_note = note
		where id = opportunity.id;
		insert into public.creator_notification_events (recipient_id, event_type, title, body, href)
		values (creator_owner_id, 'creator_product_opportunity_revision_requested', 'Seller requested changes',
			coalesce(product_name, 'The product') || ': ' || left(note, 400),
			'/visitor/creator/opportunities/' || opportunity.id::text);
	end if;
end;
$$;

create function public.submit_product_opportunity_review(
	p_opportunity_id uuid,
	p_rating integer,
	p_comment text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
	current_user_id uuid := (select auth.uid());
	opportunity public.creator_product_opportunities%rowtype;
	selected_creator_id uuid;
	selected_creator_owner_id uuid;
	reviewer text;
	review_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
	if current_user_id is null then
		raise exception 'Sign in to rate this collaboration.' using errcode = '42501';
	end if;
	select * into opportunity from public.creator_product_opportunities where id = p_opportunity_id;
	if not found then
		raise exception 'Collaboration not found.' using errcode = '42501';
	end if;
	select proposal.creator_profile_id, creator.owner_id into selected_creator_id, selected_creator_owner_id
	from public.creator_product_opportunity_proposals proposal
	join public.creator_profiles creator on creator.id = proposal.creator_profile_id
	where proposal.opportunity_id = opportunity.id and proposal.status = 'selected';
	if (select public.is_seller_owner(opportunity.seller_profile_id)) then
		reviewer := 'seller';
	elsif selected_creator_owner_id = current_user_id then
		reviewer := 'creator';
	else
		raise exception 'Only the seller and selected creator can rate this collaboration.' using errcode = '42501';
	end if;
	if opportunity.status <> 'completed' or selected_creator_id is null then
		raise exception 'Ratings open after the seller confirms the promotion is complete.' using errcode = '55000';
	end if;
	if p_rating is null or p_rating not between 1 and 5 or (review_comment is not null and length(review_comment) > 500) then
		raise exception 'Choose a rating from 1 to 5 and keep comments under 500 characters.' using errcode = '22023';
	end if;
	insert into public.creator_product_opportunity_reviews (
		opportunity_id, creator_profile_id, seller_profile_id, reviewer_role, rating, comment
	) values (
		opportunity.id, selected_creator_id, opportunity.seller_profile_id, reviewer, p_rating, review_comment
	);
	return reviewer;
exception when unique_violation then
	raise exception 'You already rated this collaboration.' using errcode = '23505';
end;
$$;

create function public.get_creator_opportunity_ratings(p_creator_profile_ids uuid[])
returns table (creator_profile_id uuid, average_rating numeric, review_count integer)
language sql
stable
security definer
set search_path = ''
as $$
	select review.creator_profile_id, round(avg(review.rating), 1), count(*)::integer
	from public.creator_product_opportunity_reviews review
	join public.creator_profiles creator on creator.id = review.creator_profile_id and creator.is_public
	where review.reviewer_role = 'seller'
		and cardinality(p_creator_profile_ids) <= 100
		and review.creator_profile_id = any(p_creator_profile_ids)
	group by review.creator_profile_id;
$$;

create function public.get_seller_opportunity_ratings(p_seller_profile_ids uuid[])
returns table (seller_profile_id uuid, average_rating numeric, review_count integer)
language sql
stable
security definer
set search_path = ''
as $$
	select review.seller_profile_id, round(avg(review.rating), 1), count(*)::integer
	from public.creator_product_opportunity_reviews review
	join public.seller_profiles seller on seller.id = review.seller_profile_id and seller.is_public and seller.status = 'active'
	where review.reviewer_role = 'creator'
		and cardinality(p_seller_profile_ids) <= 100
		and review.seller_profile_id = any(p_seller_profile_ids)
	group by review.seller_profile_id;
$$;

revoke all on function public.creator_can_view_product_opportunity(uuid) from public, anon;
grant execute on function public.creator_can_view_product_opportunity(uuid) to authenticated;
revoke all on function public.notify_creators_of_product_opportunity() from public, anon, authenticated;
revoke all on function public.seller_create_creator_product_opportunity(uuid, numeric, text[], boolean, text[], text, boolean, date, text[], boolean, uuid) from public, anon;
grant execute on function public.seller_create_creator_product_opportunity(uuid, numeric, text[], boolean, text[], text, boolean, date, text[], boolean, uuid) to authenticated;
revoke all on function public.creator_submit_product_opportunity_proposal(uuid, numeric, text, boolean, boolean, text) from public, anon;
grant execute on function public.creator_submit_product_opportunity_proposal(uuid, numeric, text, boolean, boolean, text) to authenticated;
revoke all on function public.seller_select_creator_product_opportunity_proposal(uuid) from public, anon;
grant execute on function public.seller_select_creator_product_opportunity_proposal(uuid) to authenticated;
revoke all on function public.creator_mark_product_opportunity_delivered(uuid, text, text) from public, anon;
grant execute on function public.creator_mark_product_opportunity_delivered(uuid, text, text) to authenticated;
revoke all on function public.seller_review_product_opportunity_delivery(uuid, text, text) from public, anon;
grant execute on function public.seller_review_product_opportunity_delivery(uuid, text, text) to authenticated;
revoke all on function public.submit_product_opportunity_review(uuid, integer, text) from public, anon;
grant execute on function public.submit_product_opportunity_review(uuid, integer, text) to authenticated;
revoke all on function public.get_creator_opportunity_ratings(uuid[]) from public;
grant execute on function public.get_creator_opportunity_ratings(uuid[]) to anon, authenticated;
revoke all on function public.get_seller_opportunity_ratings(uuid[]) from public;
grant execute on function public.get_seller_opportunity_ratings(uuid[]) to anon, authenticated;
