create or replace function public.admin_review_product(
	p_product_id uuid,
	p_next_status public.product_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	new_duration integer;
begin
	if not public.is_admin() then
		raise exception 'Administrator access required.' using errcode = '42501';
	end if;

	if p_next_status not in ('approved', 'rejected') then
		raise exception 'Review status must be approved or rejected.' using errcode = '22023';
	end if;

	select new_products_duration_minutes into new_duration
	from public.marketplace_settings
	where singleton = true;

	update public.products
	set status = p_next_status,
		published_at = case
			when p_next_status = 'approved' then coalesce(published_at, now())
			else published_at
		end,
		new_until = case
			when p_next_status = 'approved' and published_at is null
				then now() + make_interval(mins => new_duration)
			else new_until
		end,
		reviewed_by = (select auth.uid()),
		reviewed_at = now()
	where id = p_product_id;

	if not found then
		raise exception 'Product not found.' using errcode = 'P0002';
	end if;

	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values (
		(select auth.uid()),
		'product_' || p_next_status::text,
		'product',
		p_product_id,
		jsonb_build_object('status', p_next_status::text)
	);
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
	new_duration integer;
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

	select product_approval_mode, new_products_duration_minutes
	into approval_mode, new_duration
	from public.marketplace_settings
	where singleton = true;

	next_status := case
		when approval_mode = 'automatic' then 'approved'::public.product_status
		else 'pending'::public.product_status
	end;

	update public.products
	set status = next_status,
		published_at = case
			when next_status = 'approved' then coalesce(published_at, now())
			else published_at
		end,
		new_until = case
			when next_status = 'approved' and published_at is null
				then now() + make_interval(mins => new_duration)
			else new_until
		end,
		reviewed_by = null,
		reviewed_at = null
	where id = p_product_id;

	return next_status;
end;
$$;
