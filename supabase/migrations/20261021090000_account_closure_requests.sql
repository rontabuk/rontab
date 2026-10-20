create table public.account_closure_requests (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references auth.users (id) on delete cascade,
	requested_at timestamptz not null,
	scheduled_for timestamptz not null,
	status text not null default 'requested'
		check (status in ('requested', 'cancelled')),
	cancelled_at timestamptz,
	check (scheduled_for = requested_at + interval '720 hours'),
	check (
		(status = 'requested' and cancelled_at is null)
		or (status = 'cancelled' and cancelled_at is not null)
	)
);

create unique index account_closure_requests_one_pending_per_user_idx
	on public.account_closure_requests (user_id)
	where status = 'requested';

alter table public.account_closure_requests enable row level security;
revoke all on public.account_closure_requests from public, anon, authenticated;

create function public.request_account_closure()
returns table (
	request_id uuid,
	requested_at timestamptz,
	scheduled_for timestamptz,
	status text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
	current_user_id uuid := (select auth.uid());
	request_time timestamptz := statement_timestamp();
begin
	if current_user_id is null then
		raise exception 'Sign in to request account closure.' using errcode = '42501';
	end if;

	return query
	insert into public.account_closure_requests as existing (
		user_id,
		requested_at,
		scheduled_for
	)
	values (
		current_user_id,
		request_time,
		request_time + interval '720 hours'
	)
	on conflict (user_id) where status = 'requested'
	do update set user_id = excluded.user_id
	returning existing.id, existing.requested_at, existing.scheduled_for, existing.status;
end;
$$;

create function public.cancel_account_closure()
returns table (
	request_id uuid,
	requested_at timestamptz,
	scheduled_for timestamptz,
	status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
	current_user_id uuid := (select auth.uid());
begin
	if current_user_id is null then
		raise exception 'Sign in to cancel account closure.' using errcode = '42501';
	end if;

	return query
	update public.account_closure_requests as request
	set status = 'cancelled',
		cancelled_at = statement_timestamp()
	where request.user_id = current_user_id
		and request.status = 'requested'
		and request.scheduled_for > statement_timestamp()
	returning request.id, request.requested_at, request.scheduled_for, request.status;
	if found then
		return;
	end if;

	return query
	select request.id, request.requested_at, request.scheduled_for, request.status
	from public.account_closure_requests as request
	where request.user_id = current_user_id
		and request.status = 'cancelled'
	order by request.cancelled_at desc
	limit 1;
	if not found then
		raise exception 'No cancellable account closure request exists.' using errcode = '55000';
	end if;
end;
$$;

revoke all on function public.request_account_closure() from public, anon;
revoke all on function public.cancel_account_closure() from public, anon;
grant execute on function public.request_account_closure() to authenticated;
grant execute on function public.cancel_account_closure() to authenticated;
