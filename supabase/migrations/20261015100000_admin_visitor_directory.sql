create function public.admin_get_visitor_directory(
	p_query text,
	p_status text,
	p_limit integer,
	p_offset integer
)
returns table (
	visitor_id uuid,
	visitor_email text,
	visitor_name text,
	created_at timestamptz,
	last_sign_in_at timestamptz,
	email_confirmed_at timestamptz,
	banned_until timestamptz,
	total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	search_text text := btrim(coalesce(p_query, ''));
begin
	if not (select public.is_admin()) then
		raise exception 'Administrator access is required.' using errcode = '42501';
	end if;
	if length(search_text) > 100
		or p_status not in ('all', 'active', 'suspended')
		or p_limit is null or p_limit not between 1 and 100
		or p_offset is null or p_offset not between 0 and 1000000 then
		raise exception 'Invalid visitor directory query.' using errcode = '22023';
	end if;

	return query
	select account_user.id,
		account_user.email::text,
		coalesce(profile.display_name, account_user.raw_user_meta_data ->> 'display_name')::text,
		account_user.created_at,
		account_user.last_sign_in_at,
		account_user.email_confirmed_at,
		account_user.banned_until,
		count(*) over ()::bigint
	from auth.users account_user
	left join public.profiles profile on profile.id = account_user.id
	where coalesce(account_user.raw_app_meta_data ->> 'role', '') <> 'admin'
		and not exists (
			select 1 from public.seller_profiles seller where seller.user_id = account_user.id
		)
		and (
			search_text = ''
			or account_user.email ilike '%' || search_text || '%'
			or coalesce(profile.display_name, account_user.raw_user_meta_data ->> 'display_name', '') ilike '%' || search_text || '%'
			or account_user.id::text = search_text
		)
		and (
			p_status = 'all'
			or (p_status = 'suspended' and account_user.banned_until is not null)
			or (p_status = 'active' and account_user.banned_until is null)
		)
	order by account_user.created_at desc, account_user.id
	limit p_limit offset p_offset;
end;
$$;

revoke all on function public.admin_get_visitor_directory(text, text, integer, integer) from public, anon;
grant execute on function public.admin_get_visitor_directory(text, text, integer, integer) to authenticated;