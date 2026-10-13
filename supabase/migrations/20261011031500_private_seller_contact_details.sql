create table public.seller_contact_details (
	seller_profile_id uuid primary key references public.seller_profiles (id) on delete cascade,
	contact_name text,
	phone text,
	website_url text,
	instagram_url text,
	business_address text,
	registered_email text not null,
	registered_email_confirmed_at timestamptz,
	updated_at timestamptz not null default now(),
	check (contact_name is null or char_length(contact_name) <= 100),
	check (phone is null or char_length(phone) <= 32),
	check (website_url is null or website_url ~ '^https://'),
	check (instagram_url is null or instagram_url ~ '^https://(www\.)?instagram\.com/'),
	check (business_address is null or char_length(business_address) <= 300)
);

alter table public.seller_contact_details enable row level security;
revoke all on public.seller_contact_details from anon, authenticated;
grant select on public.seller_contact_details to authenticated;

create policy "Sellers and admins read private seller contact details"
	on public.seller_contact_details for select to authenticated
	using (
		(select public.is_admin())
		or exists (
			select 1 from public.seller_profiles s
			where s.id = seller_profile_id
				and s.user_id = (select auth.uid())
		)
);

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
		set registered_email = excluded.registered_email,
			registered_email_confirmed_at = excluded.registered_email_confirmed_at,
			updated_at = now();
	end if;

	return new;
end;
$$;

create trigger on_auth_user_seller_contact_email
	after insert or update of email, email_confirmed_at on auth.users
	for each row execute function public.sync_seller_contact_email();

insert into public.seller_contact_details (
	seller_profile_id,
	registered_email,
	registered_email_confirmed_at
)
select s.id, u.email, u.email_confirmed_at
from public.seller_profiles s
join auth.users u on u.id = s.user_id
where u.email is not null
on conflict (seller_profile_id) do update
set registered_email = excluded.registered_email,
	registered_email_confirmed_at = excluded.registered_email_confirmed_at,
	updated_at = now();

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
		registered_email_confirmed_at
	)
	values (
		own_seller_id,
		nullif(trim(p_contact_name), ''),
		nullif(trim(p_phone), ''),
		nullif(trim(p_website_url), ''),
		nullif(trim(p_instagram_url), ''),
		nullif(trim(p_business_address), ''),
		account_email,
		account_email_confirmed_at
	)
	on conflict (seller_profile_id) do update
	set contact_name = excluded.contact_name,
		phone = excluded.phone,
		website_url = excluded.website_url,
		instagram_url = excluded.instagram_url,
		business_address = excluded.business_address,
		registered_email = excluded.registered_email,
		registered_email_confirmed_at = excluded.registered_email_confirmed_at,
		updated_at = now();
end;
$$;

revoke all on function public.seller_save_contact_details(text, text, text, text, text) from public, anon;
grant execute on function public.seller_save_contact_details(text, text, text, text, text) to authenticated;
