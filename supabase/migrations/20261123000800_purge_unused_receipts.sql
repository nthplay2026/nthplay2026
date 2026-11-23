-- Receipt cleanup also removes receipt files that no payment refers to (an upload
-- whose payment was never saved, or test data that was deleted) once they are two
-- hours old. Receipts of real payments are still kept for 45 days, and receipts
-- waiting for verification are never deleted.
create or replace function public.receipts_to_purge(p_days int default 45, p_limit int default 100)
returns text[] language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(x.name), '{}') from (
    select o.name from storage.objects o
     where o.bucket_id = 'payment-proofs'
       and not exists (select 1 from public.payments p
                        where p.proof_of_payment_path = o.name and p.payment_status = 'pending')
       and (o.created_at < now() - make_interval(days => p_days)
            or (o.created_at < now() - interval '2 hours'
                and not exists (select 1 from public.payments p where p.proof_of_payment_path = o.name)))
     order by o.created_at
     limit p_limit) x
$$;
revoke all on function public.receipts_to_purge(int, int) from public, anon, authenticated;
grant execute on function public.receipts_to_purge(int, int) to service_role;
