create table public.marketplace_settings (
	singleton boolean primary key default true check (singleton),
	product_approval_mode text not null default 'manual'
		check (product_approval_mode in ('manual', 'automatic')),
	seller_approval_mode text not null default 'manual'
		check (seller_approval_mode in ('manual', 'automatic')),
	featured_duration_minutes integer not null default 1440
		check (featured_duration_minutes between 1 and 10080),
	updated_at timestamptz not null default now()
);

insert into public.marketplace_settings (singleton)
values (true)
on conflict (singleton) do nothing;

alter table public.marketplace_settings enable row level security;
revoke all on public.marketplace_settings from anon, authenticated;
grant select on public.marketplace_settings to authenticated;

create policy "Admins read marketplace settings"
	on public.marketplace_settings for select to authenticated
	using ((select public.is_admin()));

alter table public.products
	add column featured_until timestamptz;

create or replace function public.prevent_product_featured_field_changes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
	if not public.is_admin() then
		if tg_op = 'INSERT' and new.featured_until is not null then
			raise exception 'Only administrators can feature products.' using errcode = '42501';
		end if;

		if tg_op = 'UPDATE' and new.featured_until is distinct from old.featured_until then
			raise exception 'Only administrators can feature products.' using errcode = '42501';
		end if;
	end if;

	return new;
end;
$$;

create trigger prevent_product_featured_field_changes
	before insert or update on public.products
	for each row execute function public.prevent_product_featured_field_changes();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	requested_shop_name text;
	requested_shop_slug text;
	seller_mode text;
begin
	insert into public.profiles (id, display_name)
	values (
		new.id,
		nullif(trim(new.raw_user_meta_data ->> 'display_name'), '')
	)
	on conflict (id) do nothing;

	if new.raw_user_meta_data ->> 'account_type' = 'seller' then
		requested_shop_name := nullif(trim(new.raw_user_meta_data ->> 'shop_name'), '');
		requested_shop_slug := lower(nullif(trim(new.raw_user_meta_data ->> 'shop_slug'), ''));

		select seller_approval_mode into seller_mode
		from public.marketplace_settings
		where singleton = true;

		if requested_shop_name is not null
			and requested_shop_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
		then
			insert into public.seller_profiles (user_id, shop_name, slug, status, is_public)
			values (
				new.id,
				requested_shop_name,
				requested_shop_slug,
				case when seller_mode = 'automatic' then 'active'::public.seller_status else 'pending'::public.seller_status end,
				seller_mode = 'automatic'
			)
			on conflict (user_id) do nothing;
		end if;
	end if;

	return new;
end;
$$;

create or replace function public.seller_submit_product(p_product_id uuid)
returns public.product_status
language plpgsql
security definer
set search_path = ''
as $$
declare
	product_seller_id uuid;
	product_current_status public.product_status;
	approval_mode text;
	next_status public.product_status;
begin
	select seller_profile_id, status
	into product_seller_id, product_current_status
	from public.products
	where id = p_product_id;

	if not found then
		raise exception 'Product not found.' using errcode = 'P0002';
	end if;

	if not public.is_active_seller_owner(product_seller_id) then
		raise exception 'Active seller access required.' using errcode = '42501';
	end if;

	if product_current_status not in ('draft', 'pending') then
		raise exception 'Only draft or pending products can be submitted.' using errcode = '22023';
	end if;

	if not exists (
		select 1 from public.product_images where product_id = p_product_id
	) then
		raise exception 'A product image is required before submission.' using errcode = '22023';
	end if;

	select product_approval_mode into approval_mode
	from public.marketplace_settings
	where singleton = true;

	next_status := case
		when approval_mode = 'automatic' then 'approved'::public.product_status
		else 'pending'::public.product_status
	end;

	update public.products
	set status = next_status,
		reviewed_by = null,
		reviewed_at = case when next_status = 'approved' then now() else null end
	where id = p_product_id;

	return next_status;
end;
$$;

create or replace function public.admin_set_product_featured(
	p_product_id uuid,
	p_is_featured boolean
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
	feature_end timestamptz;
	feature_duration integer;
begin
	if not public.is_admin() then
		raise exception 'Administrator access required.' using errcode = '42501';
	end if;

	if p_is_featured then
		select featured_duration_minutes into feature_duration
		from public.marketplace_settings
		where singleton = true;

		feature_end := now() + make_interval(mins => feature_duration);

		update public.products
		set featured_until = feature_end
		where id = p_product_id and status = 'approved';
	else
		update public.products
		set featured_until = null
		where id = p_product_id;
	end if;

	if not found then
		if p_is_featured then
			raise exception 'Only approved products can be featured.' using errcode = '22023';
		end if;
		raise exception 'Product not found.' using errcode = 'P0002';
	end if;

	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values (
		(select auth.uid()),
		case when p_is_featured then 'product_featured' else 'product_unfeatured' end,
		'product',
		p_product_id,
		jsonb_build_object('featured_until', feature_end)
	);

	return feature_end;
end;
$$;

create or replace function public.admin_update_marketplace_settings(
	p_product_approval_mode text,
	p_seller_approval_mode text,
	p_featured_duration_minutes integer
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
	then
		raise exception 'Invalid moderation setting.' using errcode = '22023';
	end if;

	update public.marketplace_settings
	set product_approval_mode = p_product_approval_mode,
		seller_approval_mode = p_seller_approval_mode,
		featured_duration_minutes = p_featured_duration_minutes
	where singleton = true;

	insert into public.admin_audit_logs (actor_id, action, entity_type, details)
	values (
		(select auth.uid()),
		'marketplace_settings_updated',
		'marketplace_settings',
		jsonb_build_object(
			'product_approval_mode', p_product_approval_mode,
			'seller_approval_mode', p_seller_approval_mode,
			'featured_duration_minutes', p_featured_duration_minutes
		)
	);
end;
$$;

revoke all on function public.seller_submit_product(uuid) from public, anon;
revoke all on function public.admin_set_product_featured(uuid, boolean) from public, anon;
revoke all on function public.admin_update_marketplace_settings(text, text, integer) from public, anon;
grant execute on function public.seller_submit_product(uuid) to authenticated;
grant execute on function public.admin_set_product_featured(uuid, boolean) to authenticated;
grant execute on function public.admin_update_marketplace_settings(text, text, integer) to authenticated;
