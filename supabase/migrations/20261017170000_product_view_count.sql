alter table public.products
	add column view_count bigint not null default 0
		check (view_count >= 0);

create table public.product_view_sessions (
	product_id uuid not null references public.products(id) on delete cascade,
	viewer_session_id uuid not null,
	viewed_at timestamptz not null default now(),
	primary key (product_id, viewer_session_id)
);

alter table public.product_view_sessions enable row level security;
revoke all on table public.product_view_sessions from public, anon, authenticated;

create or replace function public.record_product_view(p_product_id uuid, p_viewer_session_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
	updated_view_count bigint;
	recorded_product_id uuid;
begin
	insert into public.product_view_sessions (product_id, viewer_session_id)
	select p.id, p_viewer_session_id
	from public.products p
	join public.seller_profiles s on s.id = p.seller_profile_id
	join public.categories c on c.id = p.category_id
	where p.id = p_product_id
		and p.status = 'approved'
		and s.status = 'active'
		and s.is_public
		and c.is_active
	on conflict (product_id, viewer_session_id) do nothing
	returning product_id into recorded_product_id;

	if not found then
		select p.view_count into updated_view_count
		from public.products p
		join public.seller_profiles s on s.id = p.seller_profile_id
		join public.categories c on c.id = p.category_id
		where p.id = p_product_id
			and p.status = 'approved'
			and s.status = 'active'
			and s.is_public
			and c.is_active;
		return updated_view_count;
	end if;

	update public.products p
	set view_count = p.view_count + 1
	from public.seller_profiles s, public.categories c
	where p.id = recorded_product_id
		and p.status = 'approved'
		and s.id = p.seller_profile_id
		and s.status = 'active'
		and s.is_public
		and c.id = p.category_id
		and c.is_active
	returning p.view_count into updated_view_count;

	if not found then
		delete from public.product_view_sessions
		where product_id = recorded_product_id
			and viewer_session_id = p_viewer_session_id;
		return null;
	end if;

	return updated_view_count;
end;
$$;

revoke all on function public.record_product_view(uuid, uuid) from public;
grant execute on function public.record_product_view(uuid, uuid) to anon, authenticated;