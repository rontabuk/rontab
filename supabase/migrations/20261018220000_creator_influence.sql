create index if not exists loyalty_point_transactions_influence_activity_idx
  on public.loyalty_point_transactions (visitor_id, created_at)
  where transaction_type = 'visit_earned';

create function public.get_creator_influence(p_creator_profile_ids uuid[])
returns table (
  creator_profile_id uuid,
  fan_count bigint,
  first_referral_count bigint,
  qualified_referrals bigint,
  active_referrals_30d bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_creator_profile_ids is null or cardinality(p_creator_profile_ids) > 200 then
    raise exception 'Request up to 200 creator profiles.' using errcode = '22023';
  end if;

  return query
  select creator.id,
    (select count(*) from public.creator_fans fan where fan.creator_profile_id = creator.id),
    (select count(*) from public.creator_first_referrals referral where referral.creator_profile_id = creator.id),
    count(qualified.visitor_id),
    count(qualified.visitor_id) filter (where qualified.is_recent)
  from public.creator_profiles creator
  left join lateral (
    select referral.visitor_id,
      exists (
        select 1 from public.loyalty_point_transactions activity
        where activity.visitor_id = referral.visitor_id
          and activity.transaction_type = 'visit_earned'
          and activity.created_at >= greatest(referral.attributed_at, now() - interval '30 days')
      ) as is_recent
    from public.creator_first_referrals referral
    join public.profiles profile on profile.id = referral.visitor_id
    join auth.users account_user on account_user.id = referral.visitor_id
    join public.supported_countries country on country.country_code = profile.country_code and country.is_enabled
    where referral.creator_profile_id = creator.id
      and referral.visitor_id <> creator.owner_id
      and profile.email_verified_at is not null
      and account_user.email_confirmed_at is not null
      and (account_user.banned_until is null or account_user.banned_until <= now())
      and account_user.deleted_at is null
      and not coalesce(account_user.raw_app_meta_data ->> 'role' = 'admin', false)
      and not exists (select 1 from public.seller_profiles seller where seller.user_id = referral.visitor_id)
      and exists (
        select 1 from public.loyalty_point_transactions activity
        where activity.visitor_id = referral.visitor_id
          and activity.transaction_type = 'visit_earned'
          and activity.created_at >= referral.attributed_at
      )
  ) qualified on true
  where creator.id = any(p_creator_profile_ids)
    and (creator.is_public or creator.owner_id = (select auth.uid()) or (select public.is_admin()))
  group by creator.id;
end;
$$;

revoke all on function public.get_creator_influence(uuid[]) from public;
grant execute on function public.get_creator_influence(uuid[]) to anon, authenticated;