import { useState } from 'react';
import { Link } from 'react-router';
import { AlertCircle, CalendarCheck, CalendarClock, Clock, CreditCard, LayoutGrid, PhilippinePeso, Plus, Wallet, XCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useFacility } from '@/hooks/useFacility';
import { useAsync } from '@/hooks/useAsync';
import { useStaffFeed } from '@/hooks/useStaffFeed';
import { api } from '@/lib/api';
import { addDays, formatTime, zonedTimeToUtc } from '@/lib/time';
import { money } from '@/lib/format';
import { AdminPage } from '@/components/admin/AdminPage';
import { BookingPanel } from '@/components/admin/BookingPanel';
import { NewBookingDialog } from '@/components/admin/NewBookingDialog';
import { OverviewPreview, type PreviewSpec } from '@/components/admin/OverviewPreview';
import { groupBookings } from '@/lib/bookingGroups';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, EmptyState, ErrorState, Skeleton, StatCard } from '@/components/ui/misc';
import { BookingStatusBadge, PaymentStatusBadge } from '@/components/booking/StatusBadges';

export default function Overview() {
  const { isAdmin } = useAuth();
  const { tz, today, currency } = useFacility();
  const ov = useAsync(() => api.overview(today), [today]);
  const day = useAsync(() => api.bookingsBetween(zonedTimeToUtc(today, '00:00', tz).toISOString(), zonedTimeToUtc(addDays(today, 1), '00:00', tz).toISOString(),
    { statuses: ['pending', 'confirmed', 'completed', 'no_show'] }), [today, tz]);
  const pending = useAsync(() => api.payments({ status: 'pending', page: 0, pageSize: 5 }), []);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [preview, setPreview] = useState<PreviewSpec | null>(null);
  useStaffFeed(() => { void ov.reload(); void day.reload(); void pending.reload(); });

  const o = ov.data;
  const cur = o?.currency ?? currency;
  const nowIso = new Date().toISOString();
  const upcoming = (day.data ?? []).filter((b) => b.end_at > nowIso);
  const dayStart = zonedTimeToUtc(today, '00:00', tz).toISOString();
  const dayEnd = zonedTimeToUtc(addDays(today, 1), '00:00', tz).toISOString();
  const groups = async (opts: Parameters<typeof api.searchBookingGroups>[0], keep?: (g: { booking_status: string }) => boolean) => {
    const r = await api.searchBookingGroups(opts);
    return { kind: 'bookings' as const, rows: (keep ? r.rows.filter(keep) : r.rows).slice(0, 8) };
  };
  const previews: Record<string, PreviewSpec> = {
    today: { title: "Today's bookings", link: `/admin/bookings?from=${today}&to=${today}`, linkLabel: 'Open bookings',
      load: () => groups({ fromIso: dayStart, toIso: dayEnd, page: 0, pageSize: 25, sortAsc: true }) },
    upcoming: { title: 'Upcoming bookings', description: 'Pending and confirmed, from now', link: `/admin/bookings?from=${today}&sort=asc`, linkLabel: 'Open bookings',
      load: () => groups({ fromIso: nowIso, page: 0, pageSize: 25, sortAsc: true }, (g) => g.booking_status === 'pending' || g.booking_status === 'confirmed') },
    schedule: { title: 'Still to play today', link: '/admin/schedule', linkLabel: 'Open live schedule',
      load: async () => ({ kind: 'bookings', rows: groupBookings(upcoming) }) },
    pending: { title: 'Pending reservations', description: 'Awaiting payment or confirmation', link: '/admin/bookings?status=pending', linkLabel: 'Open pending bookings',
      load: () => groups({ status: 'pending', page: 0, pageSize: 25, sortAsc: true }) },
    payments: { title: 'Payments to verify', link: '/admin/payments?tab=pending', linkLabel: 'Open payments',
      load: async () => ({ kind: 'payments', rows: (await api.payments({ status: 'pending', page: 0, pageSize: 8 })).rows }) },
    cancelled: { title: 'Cancelled bookings', description: 'Most recent first', link: '/admin/bookings?status=cancelled', linkLabel: 'Open cancelled bookings',
      load: () => groups({ status: 'cancelled', page: 0, pageSize: 25 }) },
    revenue: { title: 'Recently verified payments', link: '/admin/reports', linkLabel: 'Open reports',
      load: async () => ({ kind: 'payments', rows: (await api.payments({ status: 'paid', page: 0, pageSize: 8 })).rows }) },
  };

  return (
    <AdminPage title="Overview" description="Today at a glance — figures come straight from the database and update live."
      actions={<>
        <Link to="/admin/schedule" className={buttonVariants({ variant: 'outline' })}><LayoutGrid /> Live schedule</Link>
        <Button onClick={() => setCreating(true)}><Plus /> New booking</Button>
      </>}>
      {ov.error ? <ErrorState message={ov.error} onRetry={ov.reload} /> : !o ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard onClick={() => setPreview(previews.today)} label="Today's bookings" value={o.todays_bookings} icon={<CalendarCheck />} tone="brand" hint={`${money(o.booking_value_today, cur)} booking value`} />
          <StatCard onClick={() => setPreview(previews.upcoming)} label="Upcoming bookings" value={o.upcoming_bookings} icon={<CalendarClock />} hint="Pending + confirmed, from now" />
          <StatCard onClick={() => setPreview(previews.schedule)} label="Courts free right now" value={`${o.courts_free_now} / ${o.active_courts}`} icon={<LayoutGrid />} hint="Active courts not in use or blocked" />
          <StatCard onClick={() => setPreview(previews.schedule)} label="Occupied court-hours" value={`${o.occupied_court_hours} / ${o.open_court_hours}`} icon={<Clock />}
            hint={o.open_court_hours ? `${Math.round((100 * o.occupied_court_hours) / o.open_court_hours)}% of today's open hours` : 'Closed today'} />
          <StatCard onClick={() => setPreview(previews.pending)} label="Pending reservations" value={o.pending_reservations} icon={<AlertCircle />} tone={o.pending_reservations ? 'warning' : 'default'} hint="Awaiting payment / confirmation" />
          <StatCard onClick={() => setPreview(previews.payments)} label="Payments to verify" value={o.pending_payment_verifications} icon={<CreditCard />} tone={o.pending_payment_verifications ? 'warning' : 'default'}
            hint={`${money(o.pending_payment_amount, cur)} submitted`} />
          <StatCard onClick={() => setPreview(previews.cancelled)} label="Cancellations today" value={o.cancellations_today} icon={<XCircle />} hint="Tap to see cancelled bookings" />
          {isAdmin ? (
            <StatCard onClick={() => setPreview(previews.revenue)} label="Paid revenue" value={money(o.revenue_today, cur)} icon={<PhilippinePeso />} tone="brand"
              hint={<>Month to date: <strong>{money(o.revenue_month, cur)}</strong> · verified payments minus refunds</>} />
          ) : (
            <StatCard onClick={() => setPreview(previews.today)} label="Booking value today" value={money(o.booking_value_today, cur)} icon={<Wallet />} />
          )}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Still to play today</h2>
            <Link className="text-sm font-medium text-brand-700 hover:underline" to="/admin/schedule">Full schedule</Link>
          </div>
          {day.loading && !day.data ? <Skeleton className="mt-4 h-40" /> : upcoming.length === 0 ? (
            <EmptyState className="mt-4 py-8" title="No more bookings today" />
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {upcoming.map((b) => (
                <li key={b.id}>
                  <button type="button" onClick={() => setOpen(b.id)} className="flex w-full flex-wrap items-center justify-between gap-2 py-3 text-left hover:bg-slate-50">
                    <span className="flex items-center gap-3">
                      <span className="w-24 text-sm font-semibold tabular-nums">{formatTime(b.start_at, tz)}</span>
                      <span><span className="font-medium">{b.customer_name}</span><span className="block text-xs text-slate-500">{b.courts?.name} · {b.booking_reference}</span></span>
                    </span>
                    <span className="flex gap-1.5"><BookingStatusBadge status={b.booking_status} /><PaymentStatusBadge status={b.payment_status} /></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Payments awaiting verification</h2>
            <Link className="text-sm font-medium text-brand-700 hover:underline" to="/admin/payments">All payments</Link>
          </div>
          {(pending.data?.rows ?? []).length === 0 ? <p className="mt-4 text-sm text-slate-600">Nothing to verify. 🎉</p> : (
            <ul className="mt-3 divide-y divide-slate-100">
              {pending.data!.rows.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => setOpen(p.booking_id)} className="flex w-full items-center justify-between gap-2 py-3 text-left text-sm hover:bg-slate-50">
                    <span><span className="font-medium">{p.bookings?.customer_name}</span><span className="block text-xs text-slate-500">{p.payment_method.replace('_', ' ')} · ref {p.transaction_reference}</span></span>
                    <span className="font-semibold tabular-nums">{money(p.amount, p.currency)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <OverviewPreview spec={preview} onClose={() => setPreview(null)} onOpenBooking={(id) => setOpen(id)} />
      <BookingPanel bookingId={open} onClose={() => setOpen(null)} onChanged={() => { void ov.reload(); void day.reload(); void pending.reload(); }} />
      <NewBookingDialog open={creating} onClose={() => setCreating(false)} onCreated={() => { void ov.reload(); void day.reload(); }} />
    </AdminPage>
  );
}
