create function public.pause_seller_offers_when_seller_inactive()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if old.status = 'active' and new.status <> 'active' then
		with paused_offers as (
			update public.seller_offers offer
			set status = 'paused', updated_at = now()
			where offer.seller_profile_id = new.id and offer.status = 'published'
			returning offer.id
		)
		insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
		select (select auth.uid()), 'seller_offer_paused_seller_inactive', 'seller_offer', paused_offers.id,
			jsonb_build_object('seller_id', new.id, 'seller_status', new.status)
		from paused_offers;
	end if;
	return new;
end;
$$;

create trigger pause_published_offers_for_inactive_seller
	after update of status on public.seller_profiles
	for each row execute function public.pause_seller_offers_when_seller_inactive();

create function public.require_active_seller_for_offer_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.status = 'published' and not exists (
		select 1 from public.seller_profiles seller
		where seller.id = new.seller_profile_id and seller.status = 'active'
	) then
		raise exception 'Only an active seller can publish an offer.' using errcode = '55000';
	end if;
	return new;
end;
$$;

create trigger require_active_seller_for_offer_publication
	before insert or update of status on public.seller_offers
	for each row execute function public.require_active_seller_for_offer_publication();

revoke all on function public.pause_seller_offers_when_seller_inactive() from public, anon, authenticated;
revoke all on function public.require_active_seller_for_offer_publication() from public, anon, authenticated;