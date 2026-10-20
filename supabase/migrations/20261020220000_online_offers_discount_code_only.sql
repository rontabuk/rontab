-- Seller-website offers are percentage discounts with a public code and a seller-stated
-- number of uses. Free products, meals and special offers are redeemed through RonTab vouchers.

alter table public.seller_offers
	add column if not exists online_code_uses integer check (online_code_uses is null or online_code_uses between 1 and 100000);

create or replace function public.enforce_online_offer_discount_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	if new.fulfillment = 'online' then
		new.external_code := nullif(btrim(coalesce(new.external_code, '')), '');
		if new.offer_kind <> 'discount' then
			raise exception 'Seller website offers must be percentage discounts. Free products, meals and special offers use RonTab branch vouchers.' using errcode = '22023';
		end if;
		if new.external_code is null or new.external_code !~ '^[A-Za-z0-9_-]{3,40}$' then
			raise exception 'Enter a discount code of 3 to 40 letters, numbers, hyphens or underscores.' using errcode = '22023';
		end if;
	end if;
	return new;
end;
$$;

drop trigger if exists enforce_online_offer_discount_code on public.seller_offers;
create trigger enforce_online_offer_discount_code
	before insert on public.seller_offers
	for each row execute function public.enforce_online_offer_discount_code();

create or replace function public.seller_publish_online_discount_offer(
	p_request_id uuid, p_product_id uuid, p_payload jsonb, p_city_ids text[], p_code_uses integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	was_published boolean;
	published_offer_id uuid;
begin
	if coalesce(p_payload ->> 'fulfillment', '') <> 'online' or coalesce(p_payload ->> 'offer_kind', '') <> 'discount' then
		raise exception 'Seller website offers must be percentage discounts.' using errcode = '22023';
	end if;
	if p_code_uses is null or p_code_uses not between 1 and 100000 then
		raise exception 'Enter how many times the code can be used, from 1 to 100,000.' using errcode = '22023';
	end if;

	select exists(select 1 from public.seller_offers where request_id = p_request_id) into was_published;
	published_offer_id := case when coalesce(array_length(p_city_ids, 1), 0) = 1
		then public.seller_publish_product_offer(p_request_id, p_product_id, p_payload || jsonb_build_object('city_id', p_city_ids[1]))
		else public.seller_publish_product_offer_in_cities(p_request_id, p_product_id, p_payload, coalesce(p_city_ids, array[]::text[]))
	end;

	if not was_published then
		update public.seller_offers set online_code_uses = p_code_uses where id = published_offer_id;
	end if;
	return published_offer_id;
end;
$$;

revoke all on function public.seller_publish_online_discount_offer(uuid, uuid, jsonb, text[], integer) from public, anon;
grant execute on function public.seller_publish_online_discount_offer(uuid, uuid, jsonb, text[], integer) to authenticated;
