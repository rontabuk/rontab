-- creator_profiles.owner_id is intentionally not readable by users, so admins read
-- the owner's email confirmation for profiles awaiting review through this RPC.
create or replace function public.admin_get_creator_owner_verification(p_creator_profile_ids uuid[])
returns table (creator_profile_id uuid, email_verified_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not public.is_admin() then
		raise exception 'Only administrators can view creator owner verification.' using errcode = '42501';
	end if;

	return query
	select creator.id, profile.email_verified_at
	from public.creator_profiles creator
	left join public.profiles profile on profile.id = creator.owner_id
	where creator.id = any(coalesce(p_creator_profile_ids, '{}'::uuid[]));
end;
$$;

revoke all on function public.admin_get_creator_owner_verification(uuid[]) from public, anon;
grant execute on function public.admin_get_creator_owner_verification(uuid[]) to authenticated;
