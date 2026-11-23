-- =============================================================================
-- Court photos. Admins upload photos per court (Admin > Courts > Photos); the
-- website shows them as a single image, a collage or a swipeable carousel
-- depending on how many there are, and shows nothing when there are none.
-- * Files live in the public "court-photos" bucket, under <court id>/...
-- * courts.photos holds the ordered list [{ "path": ..., "url": ... }] and only
--   changes through admin_set_court_photos().
-- * A photo that is replaced or removed is deleted from storage right away by the
--   admin's browser; an hourly sweep (send-notifications worker) deletes any file
--   no court refers to, in case that ever fails. Court photos are NOT part of the
--   45-day receipt cleanup (that only touches the payment-proofs bucket).
-- =============================================================================

alter table public.courts
  add column if not exists photos jsonb not null default '[]'::jsonb;
alter table public.courts drop constraint if exists courts_photos_shape;
alter table public.courts add constraint courts_photos_shape
  check (jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) <= 12);
-- Readable with the rest of the court (table-wide select grant); not in the
-- column update grant, so it can only change through admin_set_court_photos().

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('court-photos', 'court-photos', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

    drop policy if exists "court photos: public read" on storage.objects;
    drop policy if exists "court photos: admin upload" on storage.objects;
    drop policy if exists "court photos: admin delete" on storage.objects;
    create policy "court photos: public read" on storage.objects for select
      using (bucket_id = 'court-photos');
    create policy "court photos: admin upload" on storage.objects for insert to authenticated
      with check (bucket_id = 'court-photos' and public.is_admin());
    create policy "court photos: admin delete" on storage.objects for delete to authenticated
      using (bucket_id = 'court-photos' and public.is_admin());
  end if;
end $$;

-- Saves a court's photo list (in display order). Returns the storage paths that
-- are no longer used, so the caller can delete those files.
create or replace function public.admin_set_court_photos(p_court uuid, p_photos jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old  jsonb;
  v_item jsonb;
  v_path text;
begin
  if not public.is_admin() then
    perform public.app_error('FORBIDDEN', 'Only administrators can change court photos.');
  end if;
  if p_photos is null or jsonb_typeof(p_photos) <> 'array' then
    perform public.app_error('INVALID_REQUEST', 'Photos must be a list.');
  end if;
  if jsonb_array_length(p_photos) > 12 then
    perform public.app_error('INVALID_REQUEST', 'A court can have up to 12 photos.');
  end if;
  for v_item in select value from jsonb_array_elements(p_photos) loop
    v_path := v_item ->> 'path';
    if v_path is null or v_path not like p_court::text || '/%' or char_length(v_path) > 300
       or coalesce(v_item ->> 'url', '') not like 'https://%/storage/v1/object/public/court-photos/%' then
      perform public.app_error('INVALID_REQUEST', 'That photo was not uploaded for this court.');
    end if;
  end loop;

  select photos into v_old from public.courts where id = p_court for update;
  if not found then
    perform public.app_error('COURT_NOT_FOUND', 'That court does not exist.');
  end if;

  update public.courts
     set photos = (select coalesce(jsonb_agg(jsonb_build_object('path', e ->> 'path', 'url', e ->> 'url') order by o), '[]'::jsonb)
                     from jsonb_array_elements(p_photos) with ordinality as t(e, o)),
         updated_at = now()
   where id = p_court;

  return (select coalesce(jsonb_agg(o ->> 'path'), '[]'::jsonb)
            from jsonb_array_elements(v_old) o
           where not exists (select 1 from jsonb_array_elements(p_photos) n where n ->> 'path' = o ->> 'path'));
end $$;
revoke all on function public.admin_set_court_photos(uuid, jsonb) from public, anon;
grant execute on function public.admin_set_court_photos(uuid, jsonb) to authenticated;

-- For the worker: photo files no court refers to (older than an hour, so an
-- upload in progress is never touched).
create or replace function public.court_photos_to_purge(p_limit int default 100)
returns text[] language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(x.name), '{}') from (
    select o.name from storage.objects o
     where o.bucket_id = 'court-photos'
       and o.created_at < now() - interval '1 hour'
       and not exists (select 1 from public.courts c, jsonb_array_elements(c.photos) p
                        where p ->> 'path' = o.name)
     order by o.created_at
     limit p_limit) x
$$;
revoke all on function public.court_photos_to_purge(int) from public, anon, authenticated;
grant execute on function public.court_photos_to_purge(int) to service_role;
