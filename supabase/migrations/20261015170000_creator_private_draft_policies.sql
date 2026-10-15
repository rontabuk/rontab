drop function if exists public.save_creator_application(text, text, text[], jsonb);

drop policy "Public reads approved creators; owners and admins read all"
	on public.creator_profiles;
create policy "Anonymous users read approved creator profiles"
	on public.creator_profiles for select to anon
	using (is_public);
create policy "Owners and admins read creator profiles"
	on public.creator_profiles for select to authenticated
	using ((select public.is_creator_profile_owner(id)) or (select public.is_admin()));

drop policy "Public reads published creator platforms"
	on public.creator_platform_accounts;
create policy "Anonymous users read published creator platforms"
	on public.creator_platform_accounts for select to anon
	using (
		is_published
		and exists (
			select 1 from public.creator_profiles profile
			where profile.id = creator_profile_id and profile.is_public
		)
	);
create policy "Owners and admins read creator platforms"
	on public.creator_platform_accounts for select to authenticated
	using ((select public.is_creator_profile_owner(creator_profile_id)) or (select public.is_admin()));

drop policy "Public reads creator portfolio; owners and admins read all"
	on public.creator_portfolio_items;
create policy "Anonymous users read published creator portfolio"
	on public.creator_portfolio_items for select to anon
	using (
		is_published
		and exists (
			select 1 from public.creator_profiles profile
			where profile.id = creator_profile_id and profile.is_public
		)
	);
create policy "Owners and admins read creator portfolio"
	on public.creator_portfolio_items for select to authenticated
	using ((select public.is_creator_profile_owner(creator_profile_id)) or (select public.is_admin()));