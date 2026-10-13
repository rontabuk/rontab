alter table public.marketplace_settings
	alter column visitor_daily_visit_points_cap set default 250,
	drop constraint marketplace_settings_visitor_daily_visit_points_cap_check,
	add constraint marketplace_settings_visitor_daily_visit_points_cap_check
		check (visitor_daily_visit_points_cap between 1 and 250);

update public.marketplace_settings
set visitor_daily_visit_points_cap = 250
where singleton = true;

create or replace function public.admin_update_marketplace_settings(
	p_product_approval_mode text,
	p_seller_approval_mode text,
	p_featured_duration_minutes integer,
	p_new_products_duration_minutes integer,
	p_click_price_pence_per_1000 integer,
	p_visitor_daily_visit_points_cap integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not public.is_admin() then
		raise exception 'Administrator access required.' using errcode = '42501';
	end if;

	if p_product_approval_mode not in ('manual', 'automatic')
		or p_seller_approval_mode not in ('manual', 'automatic')
		or p_featured_duration_minutes not between 1 and 10080
		or p_new_products_duration_minutes not between 1 and 10080
		or p_click_price_pence_per_1000 not between 1 and 100000
		or p_visitor_daily_visit_points_cap not between 1 and 250
	then
		raise exception 'Invalid marketplace setting.' using errcode = '22023';
	end if;

	update public.marketplace_settings
	set product_approval_mode = p_product_approval_mode,
		 seller_approval_mode = p_seller_approval_mode,
		 featured_duration_minutes = p_featured_duration_minutes,
		 new_products_duration_minutes = p_new_products_duration_minutes,
		 click_price_pence_per_1000 = p_click_price_pence_per_1000,
		 visitor_daily_visit_points_cap = p_visitor_daily_visit_points_cap
	where singleton = true;

	insert into public.admin_audit_logs (actor_id, action, entity_type, details)
	values (
		(select auth.uid()),
		'marketplace_settings_updated',
		'marketplace_settings',
		jsonb_build_object(
			'product_approval_mode', p_product_approval_mode,
			'seller_approval_mode', p_seller_approval_mode,
			'featured_duration_minutes', p_featured_duration_minutes,
			'new_products_duration_minutes', p_new_products_duration_minutes,
			'click_price_pence_per_1000', p_click_price_pence_per_1000,
			'visitor_daily_visit_points_cap', p_visitor_daily_visit_points_cap
		)
	);
end;
$$;