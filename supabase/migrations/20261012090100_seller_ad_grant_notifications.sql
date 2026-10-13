alter table public.seller_ad_accounts
	add column admin_grants_seen_through bigint not null default 0
		check (admin_grants_seen_through >= 0);

create or replace function public.seller_has_new_ad_credit_grants()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		from public.seller_ad_accounts account
		join public.seller_profiles seller on seller.id = account.seller_profile_id
		join public.seller_ad_credit_grants grant_entry
			on grant_entry.seller_profile_id = account.seller_profile_id
			and grant_entry.id > account.admin_grants_seen_through
		where seller.user_id = (select auth.uid())
	);
$$;

create or replace function public.seller_mark_ad_credit_grants_seen()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	seller_id uuid;
begin
	select id into seller_id
	from public.seller_profiles
	where user_id = (select auth.uid());

	if seller_id is null then
		raise exception 'Seller account was not found.' using errcode = '42501';
	end if;

	update public.seller_ad_accounts account
	set admin_grants_seen_through = greatest(
		account.admin_grants_seen_through,
		coalesce((
			select max(grant_entry.id)
			from public.seller_ad_credit_grants grant_entry
			where grant_entry.seller_profile_id = seller_id
		), 0)
	)
	where account.seller_profile_id = seller_id;
end;
$$;

revoke all on function public.seller_has_new_ad_credit_grants() from public, anon;
grant execute on function public.seller_has_new_ad_credit_grants() to authenticated;
revoke all on function public.seller_mark_ad_credit_grants_seen() from public, anon;
grant execute on function public.seller_mark_ad_credit_grants_seen() to authenticated;