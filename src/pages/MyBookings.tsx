import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { CalendarDays, ChevronRight, Clock, MapPin, RefreshCw, Ticket } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useFacility } from '@/hooks/useFacility';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { formatDateLong, formatTime } from '@/lib/time';
import { money } from '@/lib/format';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, EmptyState, ErrorState, Pagination, Skeleton, Tabs } from '@/components/ui/misc';
import { BookingStatusBadge, PaymentStatusBadge } from '@/components/booking/StatusBadges';

const PAGE = 10;

export default function MyBookingsPage() {
  const { user } = useAuth();
  const { tz } = useFacility();
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [page, setPage] = useState(0);
  const q = useAsync(() => api.myBookings({ upcoming: tab === 'upcoming', page, pageSize: PAGE, userId: user!.id }), [tab, page, user?.id], { enabled: !!user });

  // Status changes made by staff (confirmation, payment verification) show up live.
  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel(`my-bookings:${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `customer_id=eq.${user.id}` }, () => { void q.reload(); })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return (
    <div className="container-page max-w-4xl py-8 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-ink-900">My bookings</h1>
          <p className="mt-1 text-slate-600">All your court reservations in one place.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => void q.reload()} loading={q.loading && !!q.data} aria-label="Refresh my bookings"><RefreshCw /> Refresh</Button>
          <Link to="/book" className={buttonVariants()}>Book Now</Link>
        </div>
      </div>
      <Tabs className="mt-6" label="Booking period" value={tab} onChange={(v) => { setTab(v); setPage(0); }}
        items={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past & cancelled' }]} />

      <div className="mt-5 space-y-3">
        {q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : q.loading && !q.data ? (
          Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-28" />)
        ) : q.data && q.data.rows.length === 0 ? (
          <EmptyState icon={<Ticket />} title={tab === 'upcoming' ? 'No upcoming bookings' : 'No past bookings yet'}
            action={tab === 'upcoming' && <Link to="/book" className={buttonVariants()}>Find a court</Link>}>
            {tab === 'upcoming' ? 'When you book a court it will show up here.' : 'Completed and cancelled reservations will appear here.'}
          </EmptyState>
        ) : (
          q.data?.rows.map((g) => (
            <Link key={g.reference} to={`/my-bookings/${g.reference}`} className="block rounded-2xl focus-visible:outline-2 focus-visible:outline-brand-600">
              <Card className="flex items-center gap-4 p-4 transition-shadow hover:shadow-lift sm:p-5">
                <div className="hidden w-16 shrink-0 flex-col items-center rounded-xl bg-ink-900 py-2 text-white sm:flex">
                  <span className="text-[11px] font-semibold uppercase text-ball">{new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: tz }).format(new Date(g.start_at))}</span>
                  <span className="text-2xl font-bold leading-none">{new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: tz }).format(new Date(g.start_at))}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink-900">{g.bookings[0].courts?.name ?? 'Court'}</span>
                    <BookingStatusBadge status={g.booking_status} />
                    <PaymentStatusBadge status={g.payment_status} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
                    <span className="flex items-center gap-1.5"><CalendarDays className="size-4" aria-hidden />{formatDateLong(g.start_at, tz)}</span>
                    <span className="flex items-center gap-1.5"><Clock className="size-4" aria-hidden />
                      {g.bookings.map((b) => `${formatTime(b.start_at, tz)} – ${formatTime(b.end_at, tz)}`).join(', ')}
                    </span>
                    <span className="flex items-center gap-1.5"><MapPin className="size-4" aria-hidden /><code className="text-xs">{g.reference}</code></span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums text-ink-900">{money(g.total, g.currency)}</p>
                  <ChevronRight className="ml-auto mt-1 size-5 text-slate-400" aria-hidden />
                </div>
              </Card>
            </Link>
          ))
        )}
        {q.data && <Pagination page={page} pageSize={PAGE} total={q.data.count} onPage={setPage} />}
      </div>
    </div>
  );
}
