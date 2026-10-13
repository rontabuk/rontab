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
	set status = next_status
	where id = p_product_id;

	return next_status;
end;
$$;
