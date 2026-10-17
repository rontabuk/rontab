create or replace function public.get_visitor_daily_visit_points_status()
returns table (daily_cap integer, points_earned bigint)
language sql
stable
security definer
set search_path = ''
as $$
	select settings.visitor_daily_visit_points_cap, count(transaction.id)::bigint
	from public.marketplace_settings settings
	left join public.loyalty_point_transactions transaction
		on transaction.visitor_id = (select auth.uid())
		and transaction.transaction_type = 'visit_earned'
		and transaction.created_at >= now() - interval '24 hours'
	where settings.singleton = true
	group by settings.visitor_daily_visit_points_cap;
$$;