-- Deleting a creator account cascades to its creator profile; first-referral attributions
-- belong to that profile and must go with it instead of blocking account deletion.
alter table public.creator_first_referrals
	drop constraint creator_first_referrals_creator_profile_id_fkey,
	add constraint creator_first_referrals_creator_profile_id_fkey
		foreign key (creator_profile_id) references public.creator_profiles (id) on delete cascade;
