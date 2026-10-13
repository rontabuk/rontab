alter table public.supported_cities
	add column is_enabled boolean not null default false;

update public.supported_cities city
set city_name = aliases.city_name,
	city_ascii = aliases.city_name
from (values
	('Caerdydd', 'Cardiff', 'Cardiff'),
	('Newcastle', 'Newcastle upon Tyne', 'Newcastle upon Tyne'),
	('Abertawe', 'Swansea', 'Swansea'),
	('Brighton', 'Brighton and Hove', 'Brighton and Hove'),
	('Southend', 'Southend-on-Sea', 'Southend-on-Sea'),
	('Saint Helens', 'St Helens', 'St. Helens'),
	('Saint Albans', 'St Albans', 'Hertfordshire'),
	('Derry', 'Derry/Londonderry', 'Derry and Strabane')
) as aliases(source_name, city_name, admin_name)
where city.country_code = 'GB'
	and city.city_name = aliases.source_name
	and city.admin_name = aliases.admin_name;

insert into public.supported_cities (
	city_id, country_code, city_name, city_ascii, admin_name
)
values
	('GB-CURATED-BARRY', 'GB', 'Barry', 'Barry', 'Vale of Glamorgan'),
	('GB-CURATED-NEWTOWNABBEY', 'GB', 'Newtownabbey', 'Newtownabbey', 'Antrim and Newtownabbey'),
	('GB-CURATED-CRAIGAVON', 'GB', 'Craigavon', 'Craigavon', 'Armagh City, Banbridge and Craigavon')
on conflict (city_id) do update
set city_name = excluded.city_name,
	city_ascii = excluded.city_ascii,
	admin_name = excluded.admin_name;

with curated_names(city_name) as (
	values
		('London'), ('Birmingham'), ('Leeds'), ('Glasgow'), ('Sheffield'), ('Manchester'),
		('Bradford'), ('Edinburgh'), ('Liverpool'), ('Bristol'), ('Leicester'), ('Cardiff'),
		('Coventry'), ('Belfast'), ('Nottingham'), ('Newcastle upon Tyne'), ('Milton Keynes'),
		('Sunderland'), ('Kingston upon Hull'), ('Plymouth'), ('Wolverhampton'), ('Derby'),
		('Stoke-on-Trent'), ('Southampton'), ('Swansea'), ('Brighton and Hove'), ('Swindon'),
		('Aberdeen'), ('Luton'), ('Peterborough'), ('Warrington'), ('Portsmouth'), ('York'),
		('Bolton'), ('Reading'), ('Huddersfield'), ('Oxford'), ('Newport'), ('Slough'), ('Telford'),
		('Dundee'), ('Cambridge'), ('Norwich'), ('Middlesbrough'), ('Blackpool'), ('Ipswich'),
		('Bournemouth'), ('Northampton'), ('Gloucester'), ('Exeter'), ('Watford'), ('Oldham'),
		('Stockport'), ('Southend-on-Sea'), ('Birkenhead'), ('Rotherham'), ('Salford'), ('Wigan'),
		('Walsall'), ('West Bromwich'), ('Cheltenham'), ('Maidstone'), ('Doncaster'), ('Blackburn'),
		('Preston'), ('Crawley'), ('Worthing'), ('Basildon'), ('Colchester'), ('Chelmsford'),
		('Eastbourne'), ('Lincoln'), ('Hastings'), ('St Helens'), ('Basingstoke'), ('Burnley'),
		('Gillingham'), ('Bath'), ('Worcester'), ('Harlow'), ('Woking'), ('Solihull'), ('Grimsby'),
		('Stevenage'), ('Hemel Hempstead'), ('High Wycombe'), ('Dudley'), ('Halifax'), ('Wakefield'),
		('Barnsley'), ('Darlington'), ('Canterbury'), ('Chester'), ('Carlisle'), ('Lancaster'),
		('Salisbury'), ('Winchester'), ('St Albans'), ('Chichester'), ('Hereford'), ('Lichfield'),
		('Durham'), ('Ripon'), ('Dunfermline'), ('Kirkcaldy'), ('Paisley'), ('East Kilbride'),
		('Livingston'), ('Hamilton'), ('Cumbernauld'), ('Barry'), ('Neath'), ('Derry/Londonderry'),
		('Lisburn'), ('Newtownabbey'), ('Bangor'), ('Craigavon')
), ranked_cities as (
	select city.city_id,
		row_number() over (
			partition by lower(city.city_name)
			order by city.population desc, city.city_id
		) as city_rank
	from public.supported_cities city
	join curated_names curated on lower(curated.city_name) = lower(city.city_name)
	where city.country_code = 'GB'
)
update public.supported_cities city
set is_enabled = ranked.city_rank = 1
from ranked_cities ranked
where ranked.city_id = city.city_id;

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
		and city.is_enabled
		and char_length(btrim(p_query)) >= 2
		and (
			city.city_name ilike '%' || btrim(p_query) || '%'
			or city.city_ascii ilike '%' || btrim(p_query) || '%'
		)
	order by
		case when lower(city.city_name) like lower(btrim(p_query)) || '%' then 0
			when lower(city.city_ascii) like lower(btrim(p_query)) || '%' then 1
			else 2 end,
		city.city_name,
		city.admin_name
	limit 25;
$$;

create or replace function public.reject_unsupported_profile_city()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.city_id is not null
		and not (tg_op = 'UPDATE' and new.city_id is not distinct from old.city_id)
		and not exists (
			select 1 from public.supported_cities city
			where city.city_id = new.city_id and city.is_enabled
		) then
		raise exception 'Select a currently supported city.' using errcode = '22023';
	end if;
	return new;
end;
$$;

create trigger reject_unsupported_profile_city
	before insert or update of city_id on public.profiles
	for each row execute function public.reject_unsupported_profile_city();

create or replace function public.reject_unsupported_seller_city()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.shop_city_id is not null
		and not (tg_op = 'UPDATE' and new.shop_city_id is not distinct from old.shop_city_id)
		and not exists (
			select 1 from public.supported_cities city
			where city.city_id = new.shop_city_id and city.is_enabled
		) then
		raise exception 'Choose a currently supported United Kingdom city.' using errcode = '22023';
	end if;
	return new;
end;
$$;

create trigger reject_unsupported_seller_city
	before insert or update of shop_city_id on public.seller_profiles
	for each row execute function public.reject_unsupported_seller_city();