alter table public.marketplace_settings
	add column new_products_duration_minutes integer not null default 4320
		check (new_products_duration_minutes between 1 and 10080);

create or replace function public.get_new_products_duration_minutes()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(
		(select new_products_duration_minutes
		 from public.marketplace_settings
		 where singleton = true),
		4320
	);
$$;

revoke all on function public.get_new_products_duration_minutes() from public;
grant execute on function public.get_new_products_duration_minutes() to anon, authenticated;

drop function public.admin_update_marketplace_settings(text, text, integer);

create function public.admin_update_marketplace_settings(
	p_product_approval_mode text,
	p_seller_approval_mode text,
	p_featured_duration_minutes integer,
	p_new_products_duration_minutes integer
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
	then
		raise exception 'Invalid moderation setting.' using errcode = '22023';
	end if;

	update public.marketplace_settings
	set product_approval_mode = p_product_approval_mode,
		seller_approval_mode = p_seller_approval_mode,
		featured_duration_minutes = p_featured_duration_minutes,
		new_products_duration_minutes = p_new_products_duration_minutes
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
			'new_products_duration_minutes', p_new_products_duration_minutes
		)
	);
end;
$$;

revoke all on function public.admin_update_marketplace_settings(text, text, integer, integer) from public, anon;
grant execute on function public.admin_update_marketplace_settings(text, text, integer, integer) to authenticated;
