create or replace function public.get_public_creator_contact_phone(p_creator_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
	select contact.phone::text
	from public.creator_contact_details contact
	join public.creator_profiles creator on creator.id = contact.creator_profile_id
	where creator.id = p_creator_profile_id and creator.is_public
		and contact.phone_visibility = 'public';
$$;
