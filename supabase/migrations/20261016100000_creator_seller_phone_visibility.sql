alter table public.seller_contact_details
	add column phone_visibility text not null default 'collaborations'
		check (phone_visibility in ('collaborations', 'public'));

create table public.creator_contact_details (
	creator_profile_id uuid primary key references public.creator_profiles (id) on delete cascade,
	phone text check (phone is null or phone ~ '^\+?[0-9() -]{7,32}$'),
	phone_visibility text not null default 'collaborations'
		check (phone_visibility in ('collaborations', 'public')),
	updated_at timestamptz not null default now(),
	check (phone_visibility <> 'public' or phone is not null)
);
alter table public.creator_contact_details enable row level security;
revoke all on public.creator_contact_details from public, anon, authenticated;
grant select (creator_profile_id, phone, phone_visibility) on public.creator_contact_details to anon, authenticated;
create policy "Creator phone is public only by consent; owners and admins read their details"
	on public.creator_contact_details for select to anon, authenticated
	using (
		(phone_visibility = 'public' and exists (
			select 1 from public.creator_profiles profile
			where profile.id = creator_profile_id and profile.is_public
		))
		or (select public.is_creator_profile_owner(creator_profile_id))
		or (select public.is_admin())
	);
create trigger set_creator_contact_details_updated_at
	before update on public.creator_contact_details
	for each row execute function public.set_updated_at();

create function public.creator_save_contact_preferences(p_phone text, p_phone_visibility text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	current_user_id uuid := (select auth.uid());
	creator_id uuid;
	account_email_confirmed_at timestamptz;
begin
	select id into creator_id from public.creator_profiles where owner_id = current_user_id for update;
	if current_user_id is null or creator_id is null then
		raise exception 'A creator profile is required to manage creator contact details.' using errcode = '42501';
	end if;
	if p_phone is not null and (length(btrim(p_phone)) > 32 or btrim(p_phone) !~ '^\+?[0-9() -]{7,32}$')
		or p_phone_visibility not in ('collaborations', 'public') then
		raise exception 'Enter a valid phone number and visibility choice.' using errcode = '22023';
	end if;
	if p_phone_visibility = 'public' and p_phone is null then
		raise exception 'Add a phone number before making it public.' using errcode = '22023';
	end if;
	if p_phone_visibility = 'public' then
		select email_confirmed_at into account_email_confirmed_at from auth.users where id = current_user_id;
		if account_email_confirmed_at is null then
			raise exception 'Confirm your account email before publishing a phone number.' using errcode = '55000';
		end if;
	end if;
	insert into public.creator_contact_details (creator_profile_id, phone, phone_visibility)
	values (creator_id, nullif(btrim(p_phone), ''), p_phone_visibility)
	on conflict (creator_profile_id) do update
	set phone = excluded.phone, phone_visibility = excluded.phone_visibility;
end;
$$;

create function public.seller_set_phone_visibility(p_phone_visibility text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	seller_id uuid;
begin
	select id into seller_id from public.seller_profiles
	where user_id = (select auth.uid()) and status in ('pending', 'active');
	if seller_id is null then
		raise exception 'An active or pending seller account is required.' using errcode = '42501';
	end if;
	if p_phone_visibility not in ('collaborations', 'public') then
		raise exception 'Choose public or collaboration-only phone visibility.' using errcode = '22023';
	end if;
	if p_phone_visibility = 'public' and not exists (
		select 1 from public.seller_contact_details contact
		join auth.users account on account.id = (select auth.uid())
		where contact.seller_profile_id = seller_id and contact.phone is not null
			and contact.phone_contact_confirmed_at is not null and account.email_confirmed_at is not null
	) then
		raise exception 'Add a phone number and confirm it through your account email before publishing it.' using errcode = '55000';
	end if;
	update public.seller_contact_details set phone_visibility = p_phone_visibility
	where seller_profile_id = seller_id;
	if not found then
		raise exception 'Save your seller phone number first.' using errcode = '55000';
	end if;
end;
$$;

create function public.get_public_seller_contact_phone(p_seller_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
	select contact.phone::text
	from public.seller_contact_details contact
	join public.seller_profiles seller on seller.id = contact.seller_profile_id
	where seller.id = p_seller_profile_id and seller.status = 'active' and seller.is_public
		and contact.phone_visibility = 'public' and contact.phone_contact_confirmed_at is not null;
$$;

revoke all on function public.creator_save_contact_preferences(text, text) from public, anon;
grant execute on function public.creator_save_contact_preferences(text, text) to authenticated;
revoke all on function public.seller_set_phone_visibility(text) from public, anon;
grant execute on function public.seller_set_phone_visibility(text) to authenticated;
revoke all on function public.get_public_seller_contact_phone(uuid) from public;
grant execute on function public.get_public_seller_contact_phone(uuid) to anon, authenticated;