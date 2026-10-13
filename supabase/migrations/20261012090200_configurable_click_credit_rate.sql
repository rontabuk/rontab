alter table public.marketplace_settings
	add column click_price_pence_per_1000 integer not null default 100
		check (click_price_pence_per_1000 between 1 and 100000);

create or replace function public.get_click_price_pence_per_1000()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(
		(select click_price_pence_per_1000
		 from public.marketplace_settings
		 where singleton = true),
		100
	);
$$;

revoke all on function public.get_click_price_pence_per_1000() from public;
grant execute on function public.get_click_price_pence_per_1000() to anon, authenticated;

drop function public.admin_update_marketplace_settings(text, text, integer, integer);

create function public.admin_update_marketplace_settings(
	p_product_approval_mode text,
	p_seller_approval_mode text,
	p_featured_duration_minutes integer,
	p_new_products_duration_minutes integer,
	p_click_price_pence_per_1000 integer
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
	then
		raise exception 'Invalid marketplace setting.' using errcode = '22023';
	end if;

	update public.marketplace_settings
	set product_approval_mode = p_product_approval_mode,
		seller_approval_mode = p_seller_approval_mode,
		featured_duration_minutes = p_featured_duration_minutes,
		new_products_duration_minutes = p_new_products_duration_minutes,
		click_price_pence_per_1000 = p_click_price_pence_per_1000
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
			'click_price_pence_per_1000', p_click_price_pence_per_1000
		)
	);
end;
$$;

revoke all on function public.admin_update_marketplace_settings(text, text, integer, integer, integer) from public, anon;
grant execute on function public.admin_update_marketplace_settings(text, text, integer, integer, integer) to authenticated;