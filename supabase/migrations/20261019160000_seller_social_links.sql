alter table public.seller_contact_details
  add column facebook_url text check (facebook_url is null or (length(facebook_url) <= 500 and facebook_url ~* '^https://([a-z0-9-]+\.)*(facebook\.com|fb\.com)/')),
  add column twitter_url text check (twitter_url is null or (length(twitter_url) <= 500 and twitter_url ~* '^https://([a-z0-9-]+\.)*(x\.com|twitter\.com)/')),
  add column youtube_url text check (youtube_url is null or (length(youtube_url) <= 500 and youtube_url ~* '^https://([a-z0-9-]+\.)*(youtube\.com|youtu\.be)/')),
  add column tiktok_url text check (tiktok_url is null or (length(tiktok_url) <= 500 and tiktok_url ~* '^https://([a-z0-9-]+\.)*tiktok\.com/'));

create function public.seller_save_social_links(
  p_facebook_url text,
  p_twitter_url text,
  p_youtube_url text,
  p_tiktok_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  seller_id uuid;
begin
  select id into seller_id from public.seller_profiles
  where user_id = (select auth.uid()) and status <> 'suspended';
  if seller_id is null then
    raise exception 'Sign in with an eligible seller account.' using errcode = '42501';
  end if;

  update public.seller_contact_details set
    facebook_url = nullif(btrim(p_facebook_url), ''),
    twitter_url = nullif(btrim(p_twitter_url), ''),
    youtube_url = nullif(btrim(p_youtube_url), ''),
    tiktok_url = nullif(btrim(p_tiktok_url), ''),
    updated_at = now()
  where seller_profile_id = seller_id;
  if not found then
    raise exception 'Save shop contact details first.' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.seller_save_social_links(text, text, text, text) from public, anon;
grant execute on function public.seller_save_social_links(text, text, text, text) to authenticated;