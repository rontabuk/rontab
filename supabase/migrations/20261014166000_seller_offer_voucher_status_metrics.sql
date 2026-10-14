create function public.admin_get_seller_offer_voucher_status_metrics()
returns table (
	offer_id uuid,
	location_id uuid,
	reserved_count bigint,
	redeemed_count bigint,
	cancelled_count bigint,
	expired_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not (select public.is_admin()) then
		raise exception 'Administrator access is required.' using errcode = '42501';
	end if;
	return query
	select location.offer_id, location.id,
		count(coupon.id) filter (where coupon.status = 'reserved')::bigint,
		count(coupon.id) filter (where coupon.status = 'redeemed')::bigint,
		count(coupon.id) filter (where coupon.status = 'cancelled')::bigint,
		count(coupon.id) filter (where coupon.status = 'expired')::bigint
	from public.seller_offer_locations location
	left join public.seller_offer_coupons coupon on coupon.location_id = location.id
	group by location.offer_id, location.id
	order by location.offer_id, location.id;
end;
$$;

revoke all on function public.admin_get_seller_offer_voucher_status_metrics() from public, anon;
grant execute on function public.admin_get_seller_offer_voucher_status_metrics() to authenticated;