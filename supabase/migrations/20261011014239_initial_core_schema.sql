create type public.seller_status as enum ('pending', 'active', 'suspended');
create type public.product_status as enum (
	'draft',
	'pending',
	'approved',
	'rejected',
	'paused',
	'archived'
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
	select coalesce(auth.jwt() -> 'app_metadata' ->> 'role' = 'admin', false);
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	new.updated_at = now();
	return new;
end;
$$;

create table public.profiles (
	id uuid primary key references auth.users (id) on delete cascade,
	display_name text,
	avatar_url text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	insert into public.profiles (id, display_name)
	values (
		new.id,
		nullif(trim(new.raw_user_meta_data ->> 'display_name'), '')
	)
	on conflict (id) do nothing;
	return new;
end;
$$;

create trigger on_auth_user_created
	after insert on auth.users
	for each row execute function public.handle_new_user();

create table public.categories (
	id uuid primary key default gen_random_uuid(),
	parent_id uuid references public.categories (id) on delete restrict,
	slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	name text not null,
	description text,
	image_url text,
	is_active boolean not null default false,
	sort_order integer not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table public.seller_profiles (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null unique references auth.users (id) on delete cascade,
	shop_name text not null,
	slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	description text,
	logo_url text,
	status public.seller_status not null default 'pending',
	is_public boolean not null default false,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create or replace function public.is_seller_owner(profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1 from public.seller_profiles
		where id = profile_id and user_id = (select auth.uid())
	);
$$;

create or replace function public.is_active_seller_owner(profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1 from public.seller_profiles
		where id = profile_id
			and user_id = (select auth.uid())
			and status = 'active'
	);
$$;

create or replace function public.prevent_seller_status_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
	if (
		new.status is distinct from old.status
		or new.is_public is distinct from old.is_public
	) and not public.is_admin() then
		raise exception 'Seller approval and public visibility can only be changed by an administrator.'
			using errcode = '42501';
	end if;
	return new;
end;
$$;

create trigger prevent_seller_status_change
	before update on public.seller_profiles
	for each row execute function public.prevent_seller_status_change();

create or replace function public.prevent_seller_identity_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
	if not public.is_admin()
		and (
			new.id is distinct from old.id
			or new.user_id is distinct from old.user_id
			or new.created_at is distinct from old.created_at
		)
	then
		raise exception 'Seller identity fields can only be changed by an administrator.'
			using errcode = '42501';
	end if;
	return new;
end;
$$;

create trigger prevent_seller_identity_change
	before update on public.seller_profiles
	for each row execute function public.prevent_seller_identity_change();

create table public.products (
	id uuid primary key default gen_random_uuid(),
	seller_profile_id uuid not null references public.seller_profiles (id) on delete restrict,
	category_id uuid not null references public.categories (id) on delete restrict,
	slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	name text not null,
	description text not null,
	price numeric(12, 2) check (price is null or price >= 0),
	currency text not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
	external_url text not null check (external_url ~ '^https://'),
	status public.product_status not null default 'draft',
	reviewed_by uuid references auth.users (id) on delete set null,
	reviewed_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create or replace function public.prevent_product_review_field_changes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
	if not public.is_admin()
		and (
			new.reviewed_by is distinct from old.reviewed_by
			or new.reviewed_at is distinct from old.reviewed_at
		)
	then
		raise exception 'Product review metadata can only be changed by an administrator.'
			using errcode = '42501';
	end if;
	return new;
end;
$$;

create trigger prevent_product_review_field_changes
	before update on public.products
	for each row execute function public.prevent_product_review_field_changes();

create or replace function public.prevent_product_identity_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
	if not public.is_admin()
		and (
			new.id is distinct from old.id
			or new.seller_profile_id is distinct from old.seller_profile_id
			or new.created_at is distinct from old.created_at
		)
	then
		raise exception 'Product identity fields can only be changed by an administrator.'
			using errcode = '42501';
	end if;
	return new;
end;
$$;

create trigger prevent_product_identity_change
	before update on public.products
	for each row execute function public.prevent_product_identity_change();

create table public.product_images (
	id uuid primary key default gen_random_uuid(),
	product_id uuid not null references public.products (id) on delete cascade,
	storage_path text not null unique,
	alt_text text not null default '',
	sort_order integer not null default 0,
	created_at timestamptz not null default now()
);

create table public.admin_audit_logs (
	id bigint generated always as identity primary key,
	actor_id uuid not null references auth.users (id) on delete restrict,
	action text not null,
	entity_type text not null,
	entity_id uuid,
	details jsonb not null default '{}'::jsonb,
	created_at timestamptz not null default now()
);

create index products_public_listing_idx
	on public.products (category_id, created_at desc)
	where status = 'approved';
create index products_seller_status_idx
	on public.products (seller_profile_id, status, created_at desc);
create index product_images_product_sort_idx
	on public.product_images (product_id, sort_order);
create index categories_parent_sort_idx
	on public.categories (parent_id, sort_order);
create index admin_audit_logs_created_at_idx
	on public.admin_audit_logs (created_at desc);

create trigger set_profiles_updated_at
	before update on public.profiles
	for each row execute function public.set_updated_at();
create trigger set_seller_profiles_updated_at
	before update on public.seller_profiles
	for each row execute function public.set_updated_at();
create trigger set_categories_updated_at
	before update on public.categories
	for each row execute function public.set_updated_at();
create trigger set_products_updated_at
	before update on public.products
	for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.seller_profiles enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.admin_audit_logs enable row level security;

grant usage on schema public to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.is_seller_owner(uuid) to anon, authenticated;
grant execute on function public.is_active_seller_owner(uuid) to authenticated;

grant select, update (display_name, avatar_url) on public.profiles to authenticated;
grant select on public.categories to anon, authenticated;
grant insert, update, delete on public.categories to authenticated;
grant select on public.seller_profiles to anon, authenticated;
grant insert, update on public.seller_profiles to authenticated;
grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;
grant select on public.product_images to anon, authenticated;
grant insert, update, delete on public.product_images to authenticated;
grant select, insert on public.admin_audit_logs to authenticated;

create policy "Users read their own profile; admins read all"
	on public.profiles for select to authenticated
	using (id = (select auth.uid()) or (select public.is_admin()));
create policy "Users update their own profile; admins update all"
	on public.profiles for update to authenticated
	using (id = (select auth.uid()) or (select public.is_admin()))
	with check (id = (select auth.uid()) or (select public.is_admin()));

create policy "Anyone reads active categories; admins read all"
	on public.categories for select to anon, authenticated
	using (is_active or (select public.is_admin()));
create policy "Admins manage categories"
	on public.categories for all to authenticated
	using ((select public.is_admin()))
	with check ((select public.is_admin()));

create policy "Public reads visible active seller profiles"
	on public.seller_profiles for select to anon, authenticated
	using (
		(status = 'active' and is_public)
		or user_id = (select auth.uid())
		or (select public.is_admin())
	);
create policy "Users create their own pending seller profile"
	on public.seller_profiles for insert to authenticated
	with check (user_id = (select auth.uid()) and status = 'pending');
create policy "Owners and admins update seller profiles"
	on public.seller_profiles for update to authenticated
	using (user_id = (select auth.uid()) or (select public.is_admin()))
	with check (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "Admins delete seller profiles"
	on public.seller_profiles for delete to authenticated
	using ((select public.is_admin()));

create policy "Public reads approved products; sellers read their own"
	on public.products for select to anon, authenticated
	using (
		(
			status = 'approved'
			and exists (
				select 1 from public.categories c
				where c.id = category_id and c.is_active
			)
		)
		or (select public.is_seller_owner(seller_profile_id))
		or (select public.is_admin())
	);
create policy "Active sellers create draft or pending products"
	on public.products for insert to authenticated
	with check (
		(select public.is_active_seller_owner(seller_profile_id))
		and status in ('draft', 'pending')
	);
create policy "Active sellers update their products; admins update all"
	on public.products for update to authenticated
	using (
		(select public.is_active_seller_owner(seller_profile_id))
		or (select public.is_admin())
	)
	with check (
		(select public.is_admin())
		or (
			(select public.is_active_seller_owner(seller_profile_id))
			and status in ('draft', 'pending', 'paused', 'archived')
		)
	);
create policy "Sellers delete draft or rejected products; admins delete all"
	on public.products for delete to authenticated
	using (
		(select public.is_admin())
		or (
			(select public.is_active_seller_owner(seller_profile_id))
			and status in ('draft', 'rejected')
		)
	);
create policy "Admins manage product review and publication"
	on public.products for all to authenticated
	using ((select public.is_admin()))
	with check ((select public.is_admin()));

create policy "Public reads images for approved products"
	on public.product_images for select to anon, authenticated
	using (
		exists (
			select 1 from public.products p
			where p.id = product_id
				and (
					p.status = 'approved'
					or (select public.is_seller_owner(p.seller_profile_id))
					or (select public.is_admin())
				)
		)
	);
create policy "Active sellers manage images for editable products"
	on public.product_images for all to authenticated
	using (
		exists (
			select 1 from public.products p
			where p.id = product_id
				and (select public.is_active_seller_owner(p.seller_profile_id))
				and p.status in ('draft', 'pending')
		)
	)
	with check (
		exists (
			select 1 from public.products p
			where p.id = product_id
				and (select public.is_active_seller_owner(p.seller_profile_id))
				and p.status in ('draft', 'pending')
		)
	);
create policy "Admins manage all product images"
	on public.product_images for all to authenticated
	using ((select public.is_admin()))
	with check ((select public.is_admin()));

create policy "Admins read audit logs"
	on public.admin_audit_logs for select to authenticated
	using ((select public.is_admin()));
create policy "Admins append audit logs as themselves"
	on public.admin_audit_logs for insert to authenticated
	with check (
		actor_id = (select auth.uid())
		and (select public.is_admin())
	);

insert into public.categories (slug, name, is_active, sort_order)
values
	('kitchen', 'Kitchen', true, 10),
	('tableware', 'Tableware', true, 20),
	('textiles', 'Textiles', true, 30),
	('storage', 'Storage', true, 40),
	('living', 'Living', true, 50)
on conflict (slug) do nothing;
