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
				(opportunity.status = 'open' and creator.status = 'approved')
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
		'creator_product_opportunity_published',
		'New creator opportunity',
		coalesce(seller.shop_name, 'A Rontab seller') || ': ' || product.name,
		'/visitor/creator/opportunities'
	from public.creator_profiles creator
	join public.products product on product.id = new.product_id and product.status = 'approved'
	join public.categories category on category.id = product.category_id and category.is_active
	join public.seller_profiles seller on seller.id = new.seller_profile_id
		and seller.status = 'active' and seller.is_public
	where creator.is_public
		and creator.status = 'approved'
		and not exists (
			select 1 from public.seller_profiles creator_seller
			where creator_seller.user_id = creator.owner_id
		);
	return new;
end;
$$;

revoke all on function public.creator_can_view_product_opportunity(uuid) from public, anon;
grant execute on function public.creator_can_view_product_opportunity(uuid) to authenticated;
revoke all on function public.notify_creators_of_product_opportunity() from public, anon, authenticated;