begin;

insert into auth.users (id, email, aud, role, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select ('d2000000-0000-4000-8000-' || lpad(sequence::text, 12, '0'))::uuid,
  'influence-' || sequence || '@example.test', 'authenticated', 'authenticated',
  case when sequence = 8 then '{"role":"admin"}'::jsonb else '{}'::jsonb end,
  '{}', now() - interval '90 days', now() - interval '90 days', now()
from generate_series(1, 11) sequence;

update public.profiles set
  country_code = 'GB',
  city_id = (select city_id from public.supported_cities where country_code = 'GB' and is_enabled limit 1),
  email_verified_at = now()
where id::text like 'd2000000-%';
update public.profiles set email_verified_at = null where id = 'd2000000-0000-4000-8000-000000000006';
update auth.users set email_confirmed_at = null where id = 'd2000000-0000-4000-8000-000000000010';
update auth.users set banned_until = now() + interval '1 year' where id = 'd2000000-0000-4000-8000-000000000005';

insert into public.creator_profiles (id, owner_id, slug, display_name, bio, specialties, status, is_public, published_display_name, published_bio, published_specialties)
values
  ('d3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'influence-public-test', 'Influence public', 'A creator profile for transactional influence testing.', array['food'], 'approved', true, 'Influence public', 'A creator profile for transactional influence testing.', array['food']),
  ('d3000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000002', 'influence-private-test', 'Influence private', 'A private creator profile for transactional influence testing.', array['food'], 'submitted', false, null, null, null);

update public.creator_profiles set referral_code = 'RT-INFLUENCETEST' where id = 'd3000000-0000-4000-8000-000000000001';

insert into public.seller_profiles (user_id, shop_name, slug)
values ('d2000000-0000-4000-8000-000000000009', 'Influence seller', 'influence-seller-test');

insert into public.creator_first_referrals (visitor_id, creator_profile_id, referral_code, attributed_at)
select ('d2000000-0000-4000-8000-' || lpad(sequence::text, 12, '0'))::uuid,
  'd3000000-0000-4000-8000-000000000001', 'RT-TEST', now() - interval '60 days'
from generate_series(3, 11) sequence;

insert into public.creator_fans (visitor_id, creator_profile_id, first_code)
select visitor_id, creator_profile_id, referral_code from public.creator_first_referrals
where creator_profile_id = 'd3000000-0000-4000-8000-000000000001';

insert into public.loyalty_point_transactions (visitor_id, points_delta, transaction_type, source_product_id, source_product_name, idempotency_key, created_at)
select ('d2000000-0000-4000-8000-' || lpad(sequence::text, 12, '0'))::uuid,
  1, 'visit_earned', 'd4000000-0000-4000-8000-000000000001', 'Influence fixture product', 'influence-test-visit',
  now() - case when sequence = 4 then interval '40 days' when sequence = 7 then interval '70 days' else interval '1 day' end
from generate_series(3, 10) sequence;

insert into public.loyalty_point_transactions (visitor_id, points_delta, transaction_type, source_product_id, source_product_name, idempotency_key)
values ('d2000000-0000-4000-8000-000000000003', 1, 'visit_earned', 'd4000000-0000-4000-8000-000000000002', 'Second product', 'influence-second-visit');

set local role anon;
do $$
declare stats record;
begin
  select * into strict stats from public.get_creator_influence(array['d3000000-0000-4000-8000-000000000001']::uuid[]);
  assert stats.fan_count = 9 and stats.first_referral_count = 9, 'Raw follows and attribution remain distinct from qualified influence';
  assert stats.qualified_referrals = 2, 'Only verified, supported, non-banned ordinary visitors with post-referral activity count once';
  assert stats.active_referrals_30d = 1, 'Recent activity is a separate rolling metric';
  assert not exists (select 1 from public.get_creator_influence(array['d3000000-0000-4000-8000-000000000002']::uuid[])), 'Private profiles must not leak metrics';
  assert (select count(*) from public.get_creator_influence(array['d3000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001']::uuid[])) = 1, 'Duplicate IDs must not multiply results';
  assert not exists (select 1 from public.get_creator_influence(array[]::uuid[]));
  begin
    perform public.get_creator_influence(array_fill('d3000000-0000-4000-8000-000000000001'::uuid, array[201]));
    raise exception 'Unbounded requests must be rejected';
  exception when invalid_parameter_value then null;
  end;
  assert not has_table_privilege('anon', 'public.creator_first_referrals', 'select'), 'Raw referral identities stay private';
end;
$$;
reset role;

select set_config('request.jwt.claim.sub', 'd2000000-0000-4000-8000-000000000002', true);
set local role authenticated;
do $$ begin
  assert exists (select 1 from public.get_creator_influence(array['d3000000-0000-4000-8000-000000000002']::uuid[])), 'Owners can view private metrics';
end; $$;
reset role;

select set_config('request.jwt.claim.sub', 'd2000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select public.creator_follow_by_code('RT-INFLUENCETEST');
select public.creator_follow_by_code('RT-INFLUENCETEST');
select public.creator_unfollow('d3000000-0000-4000-8000-000000000001');
do $$ begin
  assert (select qualified_referrals from public.get_creator_influence(array['d3000000-0000-4000-8000-000000000001']::uuid[])) = 2, 'Repeated codes and unfollowing cannot inflate or transfer original attribution';
  assert not exists (select 1 from public.get_creator_influence(array['d3000000-0000-4000-8000-000000000002']::uuid[])), 'Unrelated authenticated users cannot see private metrics';
end; $$;
reset role;

do $$ begin
  assert public.is_creator_account('d2000000-0000-4000-8000-000000000002'), 'Creator profile owners are creator accounts';
  assert not public.is_point_earning_visitor('d2000000-0000-4000-8000-000000000002'), 'Creator accounts never earn visitor points';
  assert to_regclass('public.creator_point_accounts') is null and to_regclass('public.creator_point_transactions') is null, 'Creator point ledgers are removed';
  assert to_regprocedure('public.admin_grant_creator_points(uuid,integer,text,uuid)') is null, 'Admin creator point grants are removed';
end; $$;

select set_config('request.jwt.claim.sub', 'd2000000-0000-4000-8000-000000000002', true);
set local role authenticated;
do $$ begin
  begin
    perform public.creator_follow_by_code('RT-INFLUENCETEST');
    raise exception 'Creator accounts must not follow creators as fans';
  exception when insufficient_privilege or raise_exception then
    if sqlerrm = 'Creator accounts must not follow creators as fans' then raise; end if;
  end;
end; $$;
reset role;

update auth.users set banned_until = now() + interval '1 year' where id = 'd2000000-0000-4000-8000-000000000003';
do $$ begin
  assert (select qualified_referrals from public.get_creator_influence(array['d3000000-0000-4000-8000-000000000001']::uuid[])) = 1, 'Disqualified accounts are removed from influence automatically';
end; $$;

rollback;