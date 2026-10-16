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

create function public.require_public_shop_for_creator_opportunity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not exists (
		select 1 from public.seller_profiles seller
		where seller.id = new.seller_profile_id and seller.status = 'active' and seller.is_public
	) then
		raise exception 'Only an active public shop can publish creator opportunities.' using errcode = '55000';
	end if;
	return new;
end;
$$;
create trigger require_public_shop_for_creator_opportunity_before_write
	before insert or update of seller_profile_id on public.creator_product_opportunities
	for each row execute function public.require_public_shop_for_creator_opportunity();

revoke all on function public.creator_can_view_product_opportunity(uuid) from public, anon;
revoke all on function public.require_public_shop_for_creator_opportunity() from public, anon, authenticated;
grant execute on function public.creator_can_view_product_opportunity(uuid) to authenticated;
