alter table public.seller_profiles
	add column shop_url text
		check (shop_url is null or shop_url ~ '^https://');
