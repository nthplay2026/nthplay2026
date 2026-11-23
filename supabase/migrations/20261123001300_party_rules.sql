-- Party / event hosting rules: shown from the home page (/party-rules), edited
-- by admins in Settings > Rules & policies, same format as the legal pages.
alter table public.facility_settings
  add column if not exists party_rules_content    text check (party_rules_content is null or char_length(party_rules_content) <= 30000),
  add column if not exists party_rules_updated_at timestamptz;

grant select (party_rules_content, party_rules_updated_at) on public.facility_settings to anon, authenticated;

-- p_page: 'terms', 'privacy' or 'party'. p_content NULL (or blank) restores the default text.
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
  elsif p_page = 'party' then
    update public.facility_settings set party_rules_content = v_text, party_rules_updated_at = now() where id = 1;
  else
    perform public.app_error('INVALID_REQUEST', 'Unknown page.');
  end if;
end $$;
revoke all on function public.admin_update_legal_page(text, text) from public, anon;
grant execute on function public.admin_update_legal_page(text, text) to authenticated;
