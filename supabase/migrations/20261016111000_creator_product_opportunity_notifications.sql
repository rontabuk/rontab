alter table public.creator_notification_events
	drop constraint creator_notification_events_event_type_check,
	add constraint creator_notification_events_event_type_check
		check (event_type in (
			'collaboration_request_received',
			'collaboration_request_accepted',
			'collaboration_request_declined',
			'collaboration_request_withdrawn',
			'creator_profile_approved',
			'creator_profile_changes_requested',
			'creator_profile_rejected',
			'creator_profile_suspended',
			'creator_profile_reinstated',
			'creator_profile_unavailable',
			'creator_profile_restored',
			'creator_product_opportunity_published'
		));

create function public.notify_creators_of_product_opportunity()
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
		and creator.published_specialties && new.target_specialties
		and not exists (
			select 1 from public.seller_profiles creator_seller
			where creator_seller.user_id = creator.owner_id
		)
		and (
			new.is_nationwide
			or exists (
				select 1 from public.creator_profile_audience_cities audience
				where audience.creator_profile_id = creator.id
					and audience.is_published
					and audience.city_id = any(new.target_city_ids)
			)
		);
	return new;
end;
$$;

create trigger notify_creators_of_product_opportunity_after_insert
	after insert on public.creator_product_opportunities
	for each row execute function public.notify_creators_of_product_opportunity();

revoke all on function public.notify_creators_of_product_opportunity() from public, anon, authenticated;