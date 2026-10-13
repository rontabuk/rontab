create table public.supported_countries (
	country_code text primary key check (country_code ~ '^[A-Z]{2}$'),
	country_name text not null,
	is_enabled boolean not null default true,
	created_at timestamptz not null default now()
);

insert into public.supported_countries (country_code, country_name, is_enabled)
values ('GB', 'United Kingdom', true)
on conflict (country_code) do update
set country_name = excluded.country_name,
	is_enabled = excluded.is_enabled;

create table public.supported_cities (
	city_id text primary key check (city_id ~ '^GB-[0-9]{10}$'),
	country_code text not null references public.supported_countries (country_code),
	city_name text not null,
	city_ascii text not null,
	admin_name text not null default '',
	latitude numeric(9, 6),
	longitude numeric(9, 6),
	population bigint not null default 0 check (population >= 0),
	created_at timestamptz not null default now(),
	unique (country_code, city_name, admin_name),
	check (country_code = 'GB')
);

create index supported_cities_name_search_idx
	on public.supported_cities (country_code, lower(city_name));
create index supported_cities_ascii_search_idx
	on public.supported_cities (country_code, lower(city_ascii));
create index supported_cities_region_search_idx
	on public.supported_cities (country_code, lower(admin_name));

alter table public.supported_countries enable row level security;
alter table public.supported_cities enable row level security;
grant select on public.supported_countries, public.supported_cities to anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.supported_countries from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.supported_cities from anon, authenticated;

create policy "Anyone reads enabled supported countries"
	on public.supported_countries for select to anon, authenticated
	using (is_enabled);

create policy "Anyone reads cities in enabled countries"
	on public.supported_cities for select to anon, authenticated
	using (exists (
		select 1 from public.supported_countries country
		where country.country_code = supported_cities.country_code and country.is_enabled
	));

create or replace function public.search_supported_cities(p_country_code text, p_query text)
returns table (city_id text, city_name text, city_ascii text, admin_name text, country_code text)
language sql
stable
security definer
set search_path = ''
as $$
	select city.city_id, city.city_name, city.city_ascii, city.admin_name, city.country_code
	from public.supported_cities city
	join public.supported_countries country on country.country_code = city.country_code
	where country.country_code = upper(btrim(p_country_code))
		and country.is_enabled
		and char_length(btrim(p_query)) >= 2
		and (
			city.city_name ilike '%' || btrim(p_query) || '%'
			or city.city_ascii ilike '%' || btrim(p_query) || '%'
			or city.admin_name ilike '%' || btrim(p_query) || '%'
		)
	order by
		case when lower(city.city_name) like lower(btrim(p_query)) || '%' then 0
			when lower(city.city_ascii) like lower(btrim(p_query)) || '%' then 1
			else 2 end,
		city.city_name,
		city.admin_name
	limit 25;
$$;

revoke all on function public.search_supported_cities(text, text) from public;
grant execute on function public.search_supported_cities(text, text) to anon, authenticated;