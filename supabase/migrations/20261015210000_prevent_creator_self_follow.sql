create function public.prevent_creator_self_follow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if exists (
		select 1 from public.creator_profiles creator
		where creator.id = new.creator_profile_id and creator.owner_id = new.visitor_id
	) then
		raise exception 'Creators cannot follow their own profile.' using errcode = '55000';
	end if;
	return new;
end;
$$;

create trigger prevent_creator_self_follow_before_insert
	before insert on public.creator_fans
	for each row execute function public.prevent_creator_self_follow();

revoke all on function public.prevent_creator_self_follow() from public, anon, authenticated;