-- =============================================================================
-- Live availability via Realtime Broadcast.
-- Booking pages used to listen to slot_locks row changes (postgres_changes),
-- which Realtime authorises separately for every listener; under load on the free
-- plan some listeners missed updates. Now each slot change sends one small
-- broadcast "availability:<date>" (no personal data: just the date), which
-- Realtime fans out to every listener. Pages then reload the slots from the
-- server as before, so the server stays the source of truth.
-- A failed broadcast never blocks a booking (pages also refresh on a timer).
-- =============================================================================
create or replace function public.broadcast_slot_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare d date;
begin
  for d in
    select distinct x from unnest(array[
      case when tg_op <> 'DELETE' then new.local_date end,
      case when tg_op <> 'INSERT' then old.local_date end]) x where x is not null
  loop
    begin
      perform realtime.send(jsonb_build_object('date', d), 'change', 'availability:' || d::text, false);
    exception when others then
      null;   -- live updates are best effort; never fail the booking
    end;
  end loop;
  return null;
end $$;
revoke all on function public.broadcast_slot_change() from public, anon, authenticated;

drop trigger if exists slot_locks_broadcast on public.slot_locks;
create trigger slot_locks_broadcast after insert or update or delete on public.slot_locks
  for each row execute function public.broadcast_slot_change();
