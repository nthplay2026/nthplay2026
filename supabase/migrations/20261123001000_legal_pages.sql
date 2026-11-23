-- =============================================================================
-- Editable Terms & booking policy and Privacy policy (Admin > Settings > Legal
-- pages). Stored as plain text with light formatting ("## heading", "- bullet");
-- the website renders it as text, never as HTML. NULL = the built-in default text.
-- =============================================================================
alter table public.facility_settings
  add column if not exists terms_content      text check (terms_content is null or char_length(terms_content) <= 30000),
  add column if not exists terms_updated_at   timestamptz,
  add column if not exists privacy_content    text check (privacy_content is null or char_length(privacy_content) <= 30000),
  add column if not exists privacy_updated_at timestamptz;

-- The pages are public.
grant select (terms_content, terms_updated_at, privacy_content, privacy_updated_at)
  on public.facility_settings to anon, authenticated;

-- p_page: 'terms' or 'privacy'. p_content NULL (or blank) restores the default text.
create or replace function public.admin_update_legal_page(p_page text, p_content text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_text text := nullif(btrim(coalesce(p_content, '')), '');
begin
  perform public.require_admin();
  if char_length(coalesce(v_text, '')) > 30000 then
    perform public.app_error('TOO_LONG', 'That text is too long (30,000 characters at most).');
  end if;
  if p_page = 'terms' then
    update public.facility_settings set terms_content = v_text, terms_updated_at = now() where id = 1;
  elsif p_page = 'privacy' then
    update public.facility_settings set privacy_content = v_text, privacy_updated_at = now() where id = 1;
  else
    perform public.app_error('INVALID_REQUEST', 'Unknown page.');
  end if;
end $$;
revoke all on function public.admin_update_legal_page(text, text) from public, anon;
grant execute on function public.admin_update_legal_page(text, text) to authenticated;
