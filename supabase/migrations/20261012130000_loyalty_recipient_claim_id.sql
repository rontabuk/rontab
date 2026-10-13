drop function public.admin_get_loyalty_offer_recipients(uuid);

create function public.admin_get_loyalty_offer_recipients(p_offer_id uuid)
returns table (
	claim_id uuid,
	visitor_id uuid,
	email text,
	display_name text,
	status text,
	fulfillment_status text,
	points_spent integer,
	city text,
	country_code text,
	created_at timestamptz
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
	select
		claim.id,
		claim.visitor_id,
		account_user.email::text,
		coalesce(profile.display_name, account_user.raw_user_meta_data ->> 'display_name')::text,
		claim.status,
		claim.fulfillment_status,
		claim.points_spent,
		claim.city,
		claim.country_code,
		claim.created_at
	from public.loyalty_offer_claims claim
	join auth.users account_user on account_user.id = claim.visitor_id
	left join public.profiles profile on profile.id = claim.visitor_id
	where claim.offer_id = p_offer_id
		and claim.status in ('won', 'redeemed')
	order by claim.created_at asc;
end;
$$;

revoke all on function public.admin_get_loyalty_offer_recipients(uuid) from public, anon;
grant execute on function public.admin_get_loyalty_offer_recipients(uuid) to authenticated;