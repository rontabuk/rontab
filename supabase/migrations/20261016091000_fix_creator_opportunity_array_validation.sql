create or replace function public.save_creator_application_with_audience_cities(
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
		or exists (select 1 from unnest(city_ids) selected(city_id) where selected.city_id is null)
		or (select count(*) from unnest(city_ids) selected(city_id))
			<> (select count(distinct selected.city_id) from unnest(city_ids) selected(city_id))
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
		p_display_name, p_bio, p_specialties, p_platform_accounts, city_ids[1],
		p_portfolio_items, p_public_profile_consent
	);

	delete from public.creator_profile_audience_cities
	where creator_profile_id = profile_id and not is_published;
	insert into public.creator_profile_audience_cities (creator_profile_id, city_id, is_published)
	select profile_id, selected.city_id, false
	from unnest(city_ids) selected(city_id);
	return profile_id;
end;
$$;

create or replace function public.seller_create_creator_product_opportunity(
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
			select 1 from unnest(p_target_specialties) selected(value)
			where selected.value is null or selected.value not in ('food', 'beauty', 'fashion', 'technology', 'travel', 'home', 'fitness', 'family', 'local', 'other')
		)
		or (select count(distinct selected.value) from unnest(p_target_specialties) selected(value)) <> cardinality(p_target_specialties) then
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
		or (select count(*) from unnest(p_target_city_ids) selected(city_id))
			<> (select count(distinct selected.city_id) from unnest(p_target_city_ids) selected(city_id)) then
		raise exception 'Choose the whole United Kingdom or one to 15 different supported cities.' using errcode = '22023';
	end if;
	if p_contact_methods is null or cardinality(p_contact_methods) not between 1 and 2
		or exists (select 1 from unnest(p_contact_methods) selected(value) where selected.value is null or selected.value not in ('email', 'phone'))
		or (select count(distinct selected.value) from unnest(p_contact_methods) selected(value)) <> cardinality(p_contact_methods) then
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

revoke all on function public.save_creator_application_with_audience_cities(text, text, text[], jsonb, text[], jsonb, boolean) from public, anon;
grant execute on function public.save_creator_application_with_audience_cities(text, text, text[], jsonb, text[], jsonb, boolean) to authenticated;
revoke all on function public.seller_create_creator_product_opportunity(uuid, numeric, text[], boolean, text[], text, boolean, date, text[]) from public, anon;
grant execute on function public.seller_create_creator_product_opportunity(uuid, numeric, text[], boolean, text[], text, boolean, date, text[]) to authenticated;