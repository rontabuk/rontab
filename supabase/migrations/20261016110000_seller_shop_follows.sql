create table public.seller_shop_follows (
	visitor_id uuid not null references public.profiles (id) on delete cascade,
	seller_profile_id uuid not null references public.seller_profiles (id) on delete cascade,
	followed_at timestamptz not null default now(),
	primary key (visitor_id, seller_profile_id)
);
create index seller_shop_follows_seller_history_idx
	on public.seller_shop_follows (seller_profile_id, followed_at desc);

alter table public.seller_shop_follows enable row level security;
revoke all on public.seller_shop_follows from public, anon, authenticated;

create function public.visitor_follow_seller_shop(p_seller_profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	current_user_id uuid := (select auth.uid());
	shop public.seller_profiles%rowtype;
	inserted_count integer;
begin
	if current_user_id is null
		or not exists (select 1 from auth.users where id = current_user_id and email_confirmed_at is not null)
		or (select public.is_admin())
		or exists (select 1 from public.seller_profiles seller where seller.user_id = current_user_id) then
		raise exception 'A confirmed visitor account is required to follow a shop.' using errcode = '42501';
	end if;
	select * into shop from public.seller_profiles
	where id = p_seller_profile_id and status = 'active' and is_public
	for share;
	if not found then
		raise exception 'This public shop is unavailable.' using errcode = 'P0002';
	end if;
	insert into public.seller_shop_follows (visitor_id, seller_profile_id)
	values (current_user_id, shop.id)
	on conflict (visitor_id, seller_profile_id) do nothing;
	get diagnostics inserted_count = row_count;
	return jsonb_build_object(
		'seller_profile_id', shop.id,
		'shop_slug', shop.slug,
		'shop_name', shop.shop_name,
		'already_following', inserted_count = 0
	);
end;
$$;

create function public.visitor_unfollow_seller_shop(p_seller_profile_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
	current_user_id uuid := (select auth.uid());
begin
	if current_user_id is null
		or (select public.is_admin())
		or exists (select 1 from public.seller_profiles seller where seller.user_id = current_user_id) then
		raise exception 'Sign in as a visitor to manage followed shops.' using errcode = '42501';
	end if;
	delete from public.seller_shop_follows
	where visitor_id = current_user_id and seller_profile_id = p_seller_profile_id;
	return found;
end;
$$;

create function public.visitor_is_following_seller_shop(p_seller_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1 from public.seller_shop_follows follow
		join public.seller_profiles seller on seller.id = follow.seller_profile_id
		where follow.visitor_id = (select auth.uid())
			and follow.seller_profile_id = p_seller_profile_id
			and seller.status = 'active' and seller.is_public
	);
$$;

create function public.visitor_get_my_followed_shops()
returns table (
	seller_profile_id uuid,
	slug text,
	shop_name text,
	description text,
	logo_url text,
	shop_url text,
	city_id text,
	city_name text,
	followed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
	select seller.id, seller.slug, seller.shop_name, seller.description, seller.logo_url, seller.shop_url,
		seller.shop_city_id, city.city_name, follow.followed_at
	from public.seller_shop_follows follow
	join public.seller_profiles seller on seller.id = follow.seller_profile_id
	left join public.supported_cities city on city.city_id = seller.shop_city_id
	where follow.visitor_id = (select auth.uid())
		and seller.status = 'active' and seller.is_public
	order by follow.followed_at desc, seller.shop_name;
$$;

create function public.seller_get_shop_follower_count()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
	select count(*)
	from public.seller_shop_follows follow
	join public.seller_profiles seller on seller.id = follow.seller_profile_id
	where seller.user_id = (select auth.uid())
		and seller.status = 'active' and seller.is_public;
$$;

create function public.purge_shop_follows_when_hidden()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if (new.status <> 'active' or not new.is_public)
		and (old.status = 'active' and old.is_public) then
		delete from public.seller_shop_follows where seller_profile_id = new.id;
	end if;
	return new;
end;
$$;
create trigger purge_shop_follows_after_visibility_change
	after update of status, is_public on public.seller_profiles
	for each row execute function public.purge_shop_follows_when_hidden();

revoke all on function public.visitor_follow_seller_shop(uuid) from public, anon;
revoke all on function public.visitor_unfollow_seller_shop(uuid) from public, anon;
revoke all on function public.visitor_is_following_seller_shop(uuid) from public, anon;
revoke all on function public.visitor_get_my_followed_shops() from public, anon;
revoke all on function public.seller_get_shop_follower_count() from public, anon;
revoke all on function public.purge_shop_follows_when_hidden() from public, anon, authenticated;
grant execute on function public.visitor_follow_seller_shop(uuid) to authenticated;
grant execute on function public.visitor_unfollow_seller_shop(uuid) to authenticated;
grant execute on function public.visitor_is_following_seller_shop(uuid) to authenticated;
grant execute on function public.visitor_get_my_followed_shops() to authenticated;
grant execute on function public.seller_get_shop_follower_count() to authenticated;