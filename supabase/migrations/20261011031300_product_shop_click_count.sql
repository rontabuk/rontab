alter table public.products
	add column click_count bigint not null default 0
		check (click_count >= 0);

create or replace function public.record_product_shop_click(p_product_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
	updated_click_count bigint;
begin
	update public.products p
	set click_count = p.click_count + 1
	from public.seller_profiles s, public.categories c
	where p.id = p_product_id
		and p.status = 'approved'
		and s.id = p.seller_profile_id
		and s.status = 'active'
		and s.is_public
		and c.id = p.category_id
		and c.is_active
	returning p.click_count into updated_click_count;

	if not found then
		raise exception 'Product is not publicly available.' using errcode = 'P0002';
	end if;

	return updated_click_count;
end;
$$;

revoke all on function public.record_product_shop_click(uuid) from public;
grant execute on function public.record_product_shop_click(uuid) to anon, authenticated;
