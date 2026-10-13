drop function public.seller_create_credit_purchase(integer, uuid, integer);

create function public.seller_create_credit_purchase(p_seller_id uuid, p_clicks integer, p_request_id uuid, p_expected_rate integer)
returns setof public.seller_credit_purchases
language plpgsql
security definer
set search_path = ''
as $$
declare
	purchase public.seller_credit_purchases;
	current_rate integer;
begin
	if p_seller_id is null or not exists (
		select 1 from public.seller_profiles where id = p_seller_id and status = 'active'
	) then
		raise exception 'An active seller account is required.' using errcode = '42501';
	end if;
	if p_clicks is null or p_clicks not between 1000 and 1000000 or p_clicks % 1000 <> 0 or p_request_id is null then
		raise exception 'Choose between 1,000 and 1,000,000 clicks in increments of 1,000.' using errcode = '22023';
	end if;
	select * into purchase from public.seller_credit_purchases where id = p_request_id for update;
	if not found then
		current_rate := public.get_click_price_pence_per_1000();
		if p_expected_rate is distinct from current_rate then
			raise exception 'Click price changed. Refresh the page before purchasing.' using errcode = '22023';
		end if;
		if (p_clicks / 1000) * current_rate not between 30 and 99999999 then
			raise exception 'Choose a quantity with a total price between GBP 0.30 and GBP 999,999.99.' using errcode = '22023';
		end if;
		insert into public.seller_credit_purchases (id, seller_profile_id, clicks, unit_price_pence_per_1000, amount_pence)
		values (p_request_id, p_seller_id, p_clicks, current_rate, (p_clicks / 1000) * current_rate)
		on conflict (id) do nothing;
		select * into purchase from public.seller_credit_purchases where id = p_request_id for update;
	end if;
	if purchase.seller_profile_id <> p_seller_id or purchase.clicks <> p_clicks or purchase.unit_price_pence_per_1000 is distinct from p_expected_rate then
		raise exception 'Purchase request does not match.' using errcode = '22023';
	end if;
	return next purchase;
end;
$$;

revoke all on function public.seller_create_credit_purchase(uuid, integer, uuid, integer) from public, anon, authenticated;
grant execute on function public.seller_create_credit_purchase(uuid, integer, uuid, integer) to service_role;