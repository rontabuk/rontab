-- Notify visitors when an ended seller offer cancels their voucher and returns points.
create or replace function public.prevent_ending_seller_offer_with_reserved_coupons()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  candidate record;
  coupon public.seller_offer_coupons%rowtype;
begin
  for candidate in select id, visitor_id, location_id, offer_date, starts_at from public.seller_offer_coupons
    where offer_id = old.id and status = 'reserved' and now() < ((offer_date + ends_at) at time zone 'Europe/London')
    order by visitor_id, id loop
    perform 1 from public.loyalty_accounts where visitor_id = candidate.visitor_id for update;
    perform 1 from public.seller_offer_daily_quotas where location_id = candidate.location_id
      and offer_date = candidate.offer_date and starts_at = candidate.starts_at for update;
    select * into coupon from public.seller_offer_coupons where id = candidate.id for update;
    if coupon.status <> 'reserved' then continue; end if;
    update public.seller_offer_coupons set status = 'cancelled', cancelled_at = now() where id = coupon.id;
    update public.seller_offer_daily_quotas set reserved_count = reserved_count - 1
      where location_id = coupon.location_id and offer_date = coupon.offer_date and starts_at = coupon.starts_at;
    update public.loyalty_accounts set points_balance = points_balance + coupon.points_cost, updated_at = now()
      where visitor_id = coupon.visitor_id;
    insert into public.seller_offer_point_transactions(visitor_id, coupon_id, points_delta, transaction_type, idempotency_key)
      values(coupon.visitor_id, coupon.id, coupon.points_cost, 'refund', 'coupon:' || coupon.id::text || ':refund');
    insert into public.notification_events (notification_id, recipient_id, audience, kind, title, body, href, created_at)
    values (
      'seller-offer-cancelled-' || coupon.id::text,
      coupon.visitor_id,
      'personal',
      'reward-result',
      'Offer cancelled',
      case when coupon.points_cost > 0
        then '"' || new.title || '" is no longer available. Your voucher was cancelled and ' || coupon.points_cost::text || ' points were returned to your balance.'
        else '"' || new.title || '" is no longer available. Your voucher was cancelled.' end,
      '/visitor/offers?view=vouchers',
      now()
    )
    on conflict (notification_id) do nothing;
  end loop;
  return new;
end;
$$;

-- Visitors may change an existing city once every 14 days.
alter table public.profiles add column city_changed_at timestamptz;

create or replace function public.normalize_and_lock_profile_city()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	selected_city public.supported_cities%rowtype;
	acting_admin boolean := (select public.is_admin());
begin
	if tg_op = 'UPDATE' and not acting_admin then
		new.city_changed_at := old.city_changed_at;
	elsif tg_op = 'INSERT' and not acting_admin then
		new.city_changed_at := null;
	end if;

	if new.city_id is null then
		if tg_op = 'UPDATE' and not acting_admin
			and (new.city is distinct from old.city or new.country_code is distinct from old.country_code) then
			raise exception 'Select a supported United Kingdom city from the location list.' using errcode = '22023';
		end if;
		new.city := null;
		new.country_code := null;
	else
		select * into selected_city
		from public.supported_cities city
		join public.supported_countries country on country.country_code = city.country_code
		where city.city_id = new.city_id and country.is_enabled;
		if not found then
			raise exception 'Select a currently supported city.' using errcode = '22023';
		end if;

		if tg_op = 'UPDATE' and old.city_id is not null and not acting_admin
			and new.city_id is distinct from old.city_id then
			if exists (
				select 1
				from public.loyalty_offer_city_quotas quota
				join public.loyalty_offers offer on offer.id = quota.offer_id
				where offer.status = 'published'
					and offer.starts_at <= now()
					and offer.ends_at > now()
					and quota.city_id in (old.city_id, new.city_id)
			) then
				raise exception 'Your city cannot be changed while an offer for that city is active.' using errcode = '55000';
			end if;
			if old.city_changed_at is not null and old.city_changed_at > now() - interval '14 days' then
				raise exception 'You can change your city once every 14 days.' using errcode = 'RT014';
			end if;
			new.city_changed_at := now();
		end if;

		new.city := selected_city.city_name;
		new.country_code := selected_city.country_code;
	end if;
	return new;
end;
$$;

drop trigger normalize_and_lock_profile_city on public.profiles;
create trigger normalize_and_lock_profile_city
	before insert or update of city_id, city, country_code, city_changed_at on public.profiles
	for each row execute function public.normalize_and_lock_profile_city();

create function public.get_my_city_change_available_at()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
	select profile.city_changed_at + interval '14 days'
	from public.profiles profile
	where profile.id = (select auth.uid())
		and profile.city_changed_at > now() - interval '14 days';
$$;
revoke all on function public.get_my_city_change_available_at() from public, anon;
grant execute on function public.get_my_city_change_available_at() to authenticated;
