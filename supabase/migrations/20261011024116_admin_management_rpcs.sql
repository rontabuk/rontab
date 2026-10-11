create or replace function public.admin_review_product(
	p_product_id uuid,
	p_next_status public.product_status
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

	if p_next_status not in ('approved', 'rejected') then
		raise exception 'Review status must be approved or rejected.' using errcode = '22023';
	end if;

	update public.products
	set status = p_next_status,
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

create or replace function public.admin_set_seller_status(
	p_seller_id uuid,
	p_next_status public.seller_status,
	p_is_public boolean
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

	if p_is_public and p_next_status <> 'active' then
		raise exception 'Only active sellers can be public.' using errcode = '22023';
	end if;

	update public.seller_profiles
	set status = p_next_status, is_public = p_is_public
	where id = p_seller_id;

	if not found then
		raise exception 'Seller not found.' using errcode = 'P0002';
	end if;

	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values (
		(select auth.uid()),
		'seller_status_changed',
		'seller_profile',
		p_seller_id,
		jsonb_build_object('status', p_next_status::text, 'is_public', p_is_public)
	);
end;
$$;

create or replace function public.admin_save_category(
	p_category_id uuid,
	p_slug text,
	p_name text,
	p_description text,
	p_image_url text,
	p_is_active boolean,
	p_sort_order integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	saved_category_id uuid;
	action_name text;
begin
	if not public.is_admin() then
		raise exception 'Administrator access required.' using errcode = '42501';
	end if;

	if p_category_id is null then
		insert into public.categories (slug, name, description, image_url, is_active, sort_order)
		values (p_slug, p_name, p_description, p_image_url, p_is_active, p_sort_order)
		returning id into saved_category_id;
		action_name := 'category_created';
	else
		update public.categories
		set slug = p_slug,
				name = p_name,
				description = p_description,
				image_url = p_image_url,
				is_active = p_is_active,
				sort_order = p_sort_order
		where id = p_category_id
		returning id into saved_category_id;

		if not found then
			raise exception 'Category not found.' using errcode = 'P0002';
		end if;

		action_name := 'category_updated';
	end if;

	insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
	values (
		(select auth.uid()),
		action_name,
		'category',
		saved_category_id,
		jsonb_build_object('slug', p_slug, 'name', p_name, 'is_active', p_is_active)
	);

	return saved_category_id;
end;
$$;

revoke all on function public.admin_review_product(uuid, public.product_status) from public;
revoke all on function public.admin_set_seller_status(uuid, public.seller_status, boolean) from public;
revoke all on function public.admin_save_category(uuid, text, text, text, text, boolean, integer) from public;

grant execute on function public.admin_review_product(uuid, public.product_status) to authenticated;
grant execute on function public.admin_set_seller_status(uuid, public.seller_status, boolean) to authenticated;
grant execute on function public.admin_save_category(uuid, text, text, text, text, boolean, integer) to authenticated;
