-- One availability broadcast per date per transaction (a checkout of several
-- hours used to send one per hour). Realtime counts each broadcast once per
-- listener against the free plan's ~100 messages/second, so with many people
-- watching this keeps a busy moment well inside the limit. The message is only
-- delivered after the transaction commits, so pages never reload too early.
create or replace function public.broadcast_slot_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d   date;
  key text;
begin
  for d in
    select distinct x from unnest(array[
      case when tg_op <> 'DELETE' then new.local_date end,
      case when tg_op <> 'INSERT' then old.local_date end]) x where x is not null
  loop
    key := 'nthplay.bc_' || replace(d::text, '-', '_');
    continue when coalesce(current_setting(key, true), '') = '1';   -- already sent in this transaction
    perform set_config(key, '1', true);
    begin
      perform realtime.send(jsonb_build_object('date', d), 'change', 'availability:' || d::text, false);
    exception when others then
      null;   -- live updates are best effort; never fail the booking
    end;
  end loop;
  return null;
end $$;
revoke all on function public.broadcast_slot_change() from public, anon, authenticated;
