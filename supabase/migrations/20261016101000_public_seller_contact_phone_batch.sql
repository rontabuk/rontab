create function public.get_public_seller_contact_phones(p_seller_profile_ids uuid[])
returns table (seller_profile_id uuid, phone text)
language sql
stable
security definer
set search_path = ''
as $$
	select seller.id, contact.phone::text
	from public.seller_contact_details contact
	join public.seller_profiles seller on seller.id = contact.seller_profile_id
	where p_seller_profile_ids is not null
		and cardinality(p_seller_profile_ids) <= 500
		and seller.id = any(p_seller_profile_ids)
		and seller.status = 'active' and seller.is_public
		and contact.phone_visibility = 'public'
		and contact.phone_contact_confirmed_at is not null;
$$;

revoke all on function public.get_public_seller_contact_phones(uuid[]) from public;
grant execute on function public.get_public_seller_contact_phones(uuid[]) to anon, authenticated;