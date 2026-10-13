alter table public.seller_contact_details
	add column phone_contact_confirmed_at timestamptz;

create or replace function public.seller_save_contact_details(
	p_contact_name text,
	p_phone text,
	p_website_url text,
	p_instagram_url text,
	p_business_address text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	own_seller_id uuid;
	account_email text;
	account_email_confirmed_at timestamptz;
begin
	select id into own_seller_id
	from public.seller_profiles
	where user_id = (select auth.uid())
		and status in ('pending', 'active');

	if own_seller_id is null then
		raise exception 'Active or pending seller account required.' using errcode = '42501';
	end if;

	select email, email_confirmed_at
	into account_email, account_email_confirmed_at
	from auth.users
	where id = (select auth.uid());

	if account_email is null then
		raise exception 'Registered account email not found.' using errcode = 'P0002';
	end if;

	if p_contact_name is not null and char_length(p_contact_name) > 100
		or p_phone is not null and char_length(p_phone) > 32
		or p_website_url is not null and p_website_url !~ '^https://'
		or p_instagram_url is not null and p_instagram_url !~ '^https://(www\.)?instagram\.com/'
		or p_business_address is not null and char_length(p_business_address) > 300
	then
		raise exception 'Invalid seller contact details.' using errcode = '22023';
	end if;

	insert into public.seller_contact_details (
		seller_profile_id,
		contact_name,
		phone,
		website_url,
		instagram_url,
		business_address,
		registered_email,
		registered_email_confirmed_at,
		phone_contact_confirmed_at
	)
	values (
		own_seller_id,
		nullif(trim(p_contact_name), ''),
		nullif(trim(p_phone), ''),
		nullif(trim(p_website_url), ''),
		nullif(trim(p_instagram_url), ''),
		nullif(trim(p_business_address), ''),
		account_email,
		account_email_confirmed_at,
		null
	)
	on conflict (seller_profile_id) do update
	set contact_name = excluded.contact_name,
		phone_contact_confirmed_at = case
			when public.seller_contact_details.phone is distinct from excluded.phone then null
			else public.seller_contact_details.phone_contact_confirmed_at
		end,
		phone = excluded.phone,
		website_url = excluded.website_url,
		instagram_url = excluded.instagram_url,
		business_address = excluded.business_address,
		registered_email = excluded.registered_email,
		registered_email_confirmed_at = excluded.registered_email_confirmed_at,
		updated_at = now();
end;
$$;

create or replace function public.sync_seller_contact_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	contact_seller_id uuid;
begin
	select id into contact_seller_id
	from public.seller_profiles
	where user_id = new.id;

	if contact_seller_id is not null and new.email is not null then
		insert into public.seller_contact_details (
			seller_profile_id,
			registered_email,
			registered_email_confirmed_at
		)
		values (contact_seller_id, new.email, new.email_confirmed_at)
		on conflict (seller_profile_id) do update
		set phone_contact_confirmed_at = case
				when public.seller_contact_details.registered_email is distinct from excluded.registered_email then null
				else public.seller_contact_details.phone_contact_confirmed_at
			end,
			registered_email = excluded.registered_email,
			registered_email_confirmed_at = excluded.registered_email_confirmed_at,
			updated_at = now();
	end if;

	return new;
end;
$$;

create or replace function public.seller_confirm_contact_email()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	own_seller_id uuid;
	account_email text;
	account_email_confirmed_at timestamptz;
begin
	select s.id, u.email, u.email_confirmed_at
	into own_seller_id, account_email, account_email_confirmed_at
	from public.seller_profiles s
	join auth.users u on u.id = s.user_id
	where s.user_id = (select auth.uid())
		and s.status in ('pending', 'active');

	if own_seller_id is null then
		raise exception 'Active or pending seller account required.' using errcode = '42501';
	end if;

	if account_email_confirmed_at is null then
		raise exception 'Confirm the registered email before confirming contact details.' using errcode = '42501';
	end if;

	update public.seller_contact_details
	set phone_contact_confirmed_at = now(),
		registered_email = account_email,
		registered_email_confirmed_at = account_email_confirmed_at,
		updated_at = now()
	where seller_profile_id = own_seller_id
		and phone is not null;

	if not found then
		raise exception 'Add a phone number before confirming it.' using errcode = '22023';
	end if;
end;
$$;

revoke all on function public.seller_confirm_contact_email() from public, anon;
grant execute on function public.seller_confirm_contact_email() to authenticated;
