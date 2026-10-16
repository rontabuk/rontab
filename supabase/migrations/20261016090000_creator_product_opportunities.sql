create table public.creator_profile_audience_cities (
	creator_profile_id uuid not null references public.creator_profiles (id) on delete cascade,
	city_id text not null references public.supported_cities (city_id) on delete restrict,
	is_published boolean not null default false,
	created_at timestamptz not null default now(),
	primary key (creator_profile_id, city_id, is_published)
);
create index creator_profile_audience_cities_public_match_idx
	on public.creator_profile_audience_cities (city_id, creator_profile_id)
	where is_published;

alter table public.creator_profile_audience_cities enable row level security;
revoke all on public.creator_profile_audience_cities from public, anon, authenticated;
grant select (creator_profile_id, city_id, is_published) on public.creator_profile_audience_cities to anon, authenticated;
create policy "Public reads approved creator audience cities; owners read drafts"
	on public.creator_profile_audience_cities for select to anon, authenticated
	using (
		(is_published and exists (
			select 1 from public.creator_profiles profile
			where profile.id = creator_profile_id and profile.is_public
		))
		or (select public.is_creator_profile_owner(creator_profile_id))
		or (select public.is_admin())
	);

insert into public.creator_profile_audience_cities (creator_profile_id, city_id, is_published)
select id, published_audience_city_id, true
from public.creator_profiles
where is_public and published_audience_city_id is not null
on conflict do nothing;
insert into public.creator_profile_audience_cities (creator_profile_id, city_id, is_published)
select id, audience_city_id, false
from public.creator_profiles
where audience_city_id is not null
on conflict do nothing;

create function public.sync_creator_primary_audience_city()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	delete from public.creator_profile_audience_cities
	where creator_profile_id = new.id and not is_published;
	if new.audience_city_id is not null then
		insert into public.creator_profile_audience_cities (creator_profile_id, city_id, is_published)
		values (new.id, new.audience_city_id, false)
		on conflict do nothing;
	end if;
	return new;
end;
$$;
create trigger sync_creator_primary_audience_city_after_insert
	after insert on public.creator_profiles
	for each row execute function public.sync_creator_primary_audience_city();
create trigger sync_creator_primary_audience_city_after_update
	after update of audience_city_id on public.creator_profiles
	for each row execute function public.sync_creator_primary_audience_city();

create function public.sync_creator_profile_audience_cities()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.status = 'approved' and old.status = 'submitted' then
		delete from public.creator_profile_audience_cities
		where creator_profile_id = new.id and is_published;
		insert into public.creator_profile_audience_cities (creator_profile_id, city_id, is_published)
		select creator_profile_id, city_id, true
		from public.creator_profile_audience_cities
		where creator_profile_id = new.id and not is_published
		on conflict do nothing;
	end if;
	return new;
end;
$$;
create trigger sync_creator_profile_audience_cities_after_approval
	after update of status on public.creator_profiles
	for each row execute function public.sync_creator_profile_audience_cities();

create function public.save_creator_application_with_audience_cities(
	p_display_name text,
	p_bio text,
	p_specialties text[],
	p_platform_accounts jsonb,
	p_audience_city_ids text[],
	p_portfolio_items jsonb,
	p_public_profile_consent boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	profile_id uuid;
	city_ids text[] := coalesce(p_audience_city_ids, '{}'::text[]);
begin
	if cardinality(city_ids) > 10
		or exists (select 1 from unnest(city_ids) city_id where city_id is null)
		or (select count(*) from unnest(city_ids)) <> (select count(distinct city_id) from unnest(city_ids))
		or exists (
			select 1 from unnest(city_ids) selected(city_id)
			where not exists (
				select 1 from public.supported_cities city
				join public.supported_countries country on country.country_code = city.country_code
				where city.city_id = selected.city_id and city.is_enabled and country.is_enabled
			)
		) then
		raise exception 'Choose up to 10 different supported audience cities.' using errcode = '22023';
	end if;

	profile_id := public.save_creator_application(
		p_display_name,
		p_bio,
		p_specialties,
		p_platform_accounts,
		city_ids[1],
		p_portfolio_items,
		p_public_profile_consent
	);

	delete from public.creator_profile_audience_cities
	where creator_profile_id = profile_id and not is_published;
	insert into public.creator_profile_audience_cities (creator_profile_id, city_id, is_published)
	select profile_id, selected.city_id, false
	from unnest(city_ids) selected(city_id);

	return profile_id;
end;
$$;

create table public.creator_product_opportunities (
	id uuid primary key default gen_random_uuid(),
	product_id uuid not null references public.products (id) on delete cascade,
	seller_profile_id uuid not null references public.seller_profiles (id) on delete cascade,
	budget numeric(12, 2) not null check (budget > 0 and budget <= 1000000),
	currency text not null check (currency ~ '^[A-Z]{3}$'),
	target_specialties text[] not null check (cardinality(target_specialties) between 1 and 5),
	is_nationwide boolean not null default false,
	target_city_ids text[] not null default '{}'::text[],
	brief text not null check (length(btrim(brief)) between 30 and 2000),
	product_provided boolean not null default false,
	deadline date,
	contact_methods text[] not null check (cardinality(contact_methods) between 1 and 2),
	status text not null default 'open' check (status in ('open', 'awarded', 'closed')),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	check ((is_nationwide and cardinality(target_city_ids) = 0) or (not is_nationwide and cardinality(target_city_ids) between 1 and 15))
);
create unique index creator_product_opportunities_one_open_per_product_idx
	on public.creator_product_opportunities (product_id) where status = 'open';
create index creator_product_opportunities_open_idx
	on public.creator_product_opportunities (status, created_at desc) where status = 'open';
create trigger set_creator_product_opportunities_updated_at
	before update on public.creator_product_opportunities
	for each row execute function public.set_updated_at();

create table public.creator_product_opportunity_proposals (
	id uuid primary key default gen_random_uuid(),
	opportunity_id uuid not null references public.creator_product_opportunities (id) on delete cascade,
	creator_profile_id uuid not null references public.creator_profiles (id) on delete cascade,
	amount numeric(12, 2) not null check (amount > 0 and amount <= 1000000),
	offer_details text not null check (length(btrim(offer_details)) between 30 and 2000),
	share_email boolean not null default false,
	share_phone boolean not null default false,
	status text not null default 'pending' check (status in ('pending', 'selected', 'not_selected', 'withdrawn')),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (opportunity_id, creator_profile_id)
);
create index creator_product_opportunity_proposals_seller_queue_idx
	on public.creator_product_opportunity_proposals (opportunity_id, status, amount, created_at desc);
create index creator_product_opportunity_proposals_creator_history_idx
	on public.creator_product_opportunity_proposals (creator_profile_id, created_at desc);
create trigger set_creator_product_opportunity_proposals_updated_at
	before update on public.creator_product_opportunity_proposals
	for each row execute function public.set_updated_at();

create table public.creator_product_opportunity_contacts (
	proposal_id uuid primary key references public.creator_product_opportunity_proposals (id) on delete cascade,
	phone text check (phone is null or phone ~ '^\+?[0-9() -]{7,32}$'),
	updated_at timestamptz not null default now()
);
alter table public.creator_product_opportunities enable row level security;
alter table public.creator_product_opportunity_proposals enable row level security;
alter table public.creator_product_opportunity_contacts enable row level security;
revoke all on public.creator_product_opportunities, public.creator_product_opportunity_proposals,
	public.creator_product_opportunity_contacts from public, anon, authenticated;
grant select on public.creator_product_opportunities, public.creator_product_opportunity_proposals to authenticated;

create function public.creator_can_view_product_opportunity(p_opportunity_id uuid)
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
		join public.seller_profiles seller on seller.id = opportunity.seller_profile_id and seller.status = 'active'
		join public.creator_profiles creator on creator.owner_id = (select auth.uid()) and creator.is_public
		where opportunity.id = p_opportunity_id
			and product.status = 'approved'
			and (
				(
					opportunity.status = 'open'
					and creator.published_specialties && opportunity.target_specialties
					and (
						opportunity.is_nationwide
						or exists (
							select 1 from public.creator_profile_audience_cities audience
							where audience.creator_profile_id = creator.id and audience.is_published
								and audience.city_id = any(opportunity.target_city_ids)
						)
					)
				)
				or exists (
					select 1 from public.creator_product_opportunity_proposals proposal
					where proposal.opportunity_id = opportunity.id and proposal.creator_profile_id = creator.id
				)
			)
	);
$$;

create policy "Sellers and matched creators read product opportunities"
	on public.creator_product_opportunities for select to authenticated
	using (
		(select public.is_seller_owner(seller_profile_id))
		or (select public.is_admin())
		or (select public.creator_can_view_product_opportunity(id))
	);
create policy "Proposal participants and admins read proposals"
	on public.creator_product_opportunity_proposals for select to authenticated
	using (
		(select public.is_creator_profile_owner(creator_profile_id))
		or exists (
			select 1 from public.creator_product_opportunities opportunity
			where opportunity.id = opportunity_id
				and (select public.is_seller_owner(opportunity.seller_profile_id))
		)
		or (select public.is_admin())
	);

create function public.seller_create_creator_product_opportunity(
	p_product_id uuid,
	p_budget numeric,
	p_target_specialties text[],
	p_is_nationwide boolean,
	p_target_city_ids text[],
	p_brief text,
	p_product_provided boolean,
	p_deadline date,
	p_contact_methods text[]
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
	if p_budget is null or p_budget <= 0 or p_budget > 1000000 or p_budget <> round(p_budget, 2)
		or length(btrim(coalesce(p_brief, ''))) not between 30 and 2000
		or p_product_provided is null
		or p_deadline is not null and p_deadline < current_date
		or p_deadline is not null and p_deadline > current_date + 365 then
		raise exception 'Enter a valid budget, campaign brief, and future deadline.' using errcode = '22023';
	end if;
	if p_target_specialties is null or cardinality(p_target_specialties) not between 1 and 5
		or exists (
			select 1 from unnest(p_target_specialties) specialty
			where specialty is null or specialty not in ('food', 'beauty', 'fashion', 'technology', 'travel', 'home', 'fitness', 'family', 'local', 'other')
		)
		or (select count(distinct selected.value) from unnest(p_target_specialties) as selected(value)) <> cardinality(p_target_specialties) then
		raise exception 'Choose between one and five different creator specialties.' using errcode = '22023';
	end if;
	if p_is_nationwide is null or p_target_city_ids is null
		or (p_is_nationwide and cardinality(p_target_city_ids) <> 0)
		or (not p_is_nationwide and cardinality(p_target_city_ids) not between 1 and 15)
		or exists (
			select 1 from unnest(p_target_city_ids) selected(city_id)
			where selected.city_id is null or not exists (
				select 1 from public.supported_cities city
				join public.supported_countries country on country.country_code = city.country_code
				where city.city_id = selected.city_id and city.is_enabled and country.is_enabled
			)
		)
		or (select count(*) from unnest(p_target_city_ids) as selected(city_id))
			<> (select count(distinct selected.city_id) from unnest(p_target_city_ids) as selected(city_id)) then
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
		target_city_ids, brief, product_provided, deadline, contact_methods
	) values (
		product.id, product.seller_profile_id, p_budget, product.currency, p_target_specialties, p_is_nationwide,
		p_target_city_ids, btrim(p_brief), p_product_provided, p_deadline, p_contact_methods
	) returning id into opportunity_id;
	return opportunity_id;
exception when unique_violation then
	raise exception 'This product already has an open creator opportunity.' using errcode = '23505';
end;
$$;

create function public.creator_submit_product_opportunity_proposal(
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

create function public.creator_withdraw_product_opportunity_proposal(p_proposal_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	update public.creator_product_opportunity_proposals proposal
	set status = 'withdrawn'
	where proposal.id = p_proposal_id and proposal.status = 'pending'
		and exists (select 1 from public.creator_profiles creator where creator.id = proposal.creator_profile_id and creator.owner_id = (select auth.uid()));
	if not found then
		raise exception 'Only your pending offer can be withdrawn.' using errcode = '55000';
	end if;
	delete from public.creator_product_opportunity_contacts where proposal_id = p_proposal_id;
end;
$$;

create function public.seller_select_creator_product_opportunity_proposal(p_proposal_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	opportunity public.creator_product_opportunities%rowtype;
	creator_id uuid;
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
	if not exists (
		select 1 from public.products product
		join public.categories category on category.id = product.category_id and category.is_active
		where product.id = opportunity.product_id and product.status = 'approved'
	) then
		raise exception 'The product is no longer live, so this offer cannot be selected.' using errcode = '55000';
	end if;
	select creator_profile_id into creator_id from public.creator_product_opportunity_proposals where id = p_proposal_id;
	update public.creator_product_opportunity_proposals
	set status = case when id = p_proposal_id then 'selected' else 'not_selected' end
	where opportunity_id = opportunity.id and status = 'pending';
	update public.creator_product_opportunities set status = 'awarded' where id = opportunity.id;
	return creator_id;
end;
$$;

create function public.seller_close_creator_product_opportunity(p_opportunity_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	update public.creator_product_opportunities
	set status = 'closed'
	where id = p_opportunity_id and status = 'open'
		and (select public.is_active_seller_owner(seller_profile_id));
	if not found then
		raise exception 'Only your open opportunity can be closed.' using errcode = '55000';
	end if;
	update public.creator_product_opportunity_proposals
	set status = 'not_selected'
	where opportunity_id = p_opportunity_id and status = 'pending';
end;
$$;

create function public.get_creator_product_opportunity_contact(p_proposal_id uuid)
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

revoke all on function public.sync_creator_profile_audience_cities() from public, anon, authenticated;
revoke all on function public.sync_creator_primary_audience_city() from public, anon, authenticated;
revoke all on function public.save_creator_application_with_audience_cities(text, text, text[], jsonb, text[], jsonb, boolean) from public, anon;
revoke all on function public.creator_can_view_product_opportunity(uuid) from public, anon;
revoke all on function public.seller_create_creator_product_opportunity(uuid, numeric, text[], boolean, text[], text, boolean, date, text[]) from public, anon;
revoke all on function public.creator_submit_product_opportunity_proposal(uuid, numeric, text, boolean, boolean, text) from public, anon;
revoke all on function public.creator_withdraw_product_opportunity_proposal(uuid) from public, anon;
revoke all on function public.seller_select_creator_product_opportunity_proposal(uuid) from public, anon;
revoke all on function public.seller_close_creator_product_opportunity(uuid) from public, anon;
revoke all on function public.get_creator_product_opportunity_contact(uuid) from public, anon;
grant execute on function public.save_creator_application_with_audience_cities(text, text, text[], jsonb, text[], jsonb, boolean) to authenticated;
grant execute on function public.creator_can_view_product_opportunity(uuid) to authenticated;
grant execute on function public.seller_create_creator_product_opportunity(uuid, numeric, text[], boolean, text[], text, boolean, date, text[]) to authenticated;
grant execute on function public.creator_submit_product_opportunity_proposal(uuid, numeric, text, boolean, boolean, text) to authenticated;
grant execute on function public.creator_withdraw_product_opportunity_proposal(uuid) to authenticated;
grant execute on function public.seller_select_creator_product_opportunity_proposal(uuid) to authenticated;
grant execute on function public.seller_close_creator_product_opportunity(uuid) to authenticated;
grant execute on function public.get_creator_product_opportunity_contact(uuid) to authenticated;