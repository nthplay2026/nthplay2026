import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Download, Plus, Search } from 'lucide-react';
import { useFacility } from '@/hooks/useFacility';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { useStaffFeed } from '@/hooks/useStaffFeed';
import { api } from '@/lib/api';
import { addDays, formatDateLong, formatDateTime, formatTime, zonedTimeToUtc } from '@/lib/time';
import { bookingStatusLabel, money, paymentStatusLabel } from '@/lib/format';
import { useMethodName } from '@/hooks/useMethodName';
import { groupBookings, groupRef } from '@/lib/bookingGroups';
import { errorMessage } from '@/lib/errors';
import type { Booking, BookingStatus, PaymentStatus } from '@/lib/types';
import { AdminPage } from '@/components/admin/AdminPage';
import { BookingPanel } from '@/components/admin/BookingPanel';
import { NewBookingDialog } from '@/components/admin/NewBookingDialog';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';
import { Card, EmptyState, ErrorState, Pagination, Skeleton } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { BookingStatusBadge, PaymentStatusBadge } from '@/components/booking/StatusBadges';

const PAGE = 25;

export default function Bookings() {
  const { courts, tz } = useFacility();
  const toast = useToast();
  const methodLabel = useMethodName();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('ref') ?? '');
  const debounced = useDebounced(search, 300);
  // Starting filters can come from the link (e.g. the dashboard cards).
  const [from, setFrom] = useState(params.get('from') ?? '');
  const [to, setTo] = useState(params.get('to') ?? '');
  const [courtId, setCourtId] = useState('');
  const [status, setStatus] = useState<BookingStatus | ''>((params.get('status') as BookingStatus | null) ?? '');
  const [payStatus, setPayStatus] = useState<PaymentStatus | ''>((params.get('pay') as PaymentStatus | null) ?? '');
  const sortAsc = params.get('sort') === 'asc';
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);

  const filters = {
    search: debounced,
    fromIso: from ? zonedTimeToUtc(from, '00:00', tz).toISOString() : undefined,
    toIso: to ? zonedTimeToUtc(addDays(to, 1), '00:00', tz).toISOString() : undefined,
    courtId: courtId || null, status, paymentStatus: payStatus, sortAsc,
  };
  const q = useAsync(() => api.searchBookingGroups({ ...filters, page, pageSize: PAGE }), [debounced, from, to, courtId, status, payStatus, page, tz, sortAsc]);
  useEffect(() => setPage(0), [debounced, from, to, courtId, status, payStatus]);
  useStaffFeed(() => { void q.reload(); }, ['bookings', 'payments']);

  // Deep link from emails / conflict dialogs: ?ref=PB-…
  useEffect(() => {
    const ref = params.get('ref');
    const hit = q.data?.rows.find((g) => g.bookings.some((b) => b.booking_reference === ref));
    if (ref && hit) {
      setOpen(hit.bookings.find((b) => b.booking_reference === ref)!.id);
      const p = new URLSearchParams(params); p.delete('ref'); setParams(p, { replace: true });
    }
  }, [q.data, params, setParams]);

  // Excel file with two sheets: one row per booking (blocks booked together combined),
  // and one row per individual time block.
  const exportXlsx = async () => {
    setExporting(true);
    try {
      const all: Booking[] = [];
      for (let p = 0; p < 40; p++) {
        const res = await api.searchBookings({ ...filters, page: p, pageSize: 500 });
        all.push(...res.rows);
        if (res.rows.length < 500) break;
      }
      const groups = groupBookings(all).sort((x, y) => x.start_at.localeCompare(y.start_at));
      const head = (labels: string[]) => labels.map((value) => ({ value, fontWeight: 'bold' as const }));
      const text = (v: string | number | null | undefined) => ({ value: v ?? undefined });
      const method = (b: Booking) => (b.payment_method ? methodLabel(b.payment_method) : '');

      const bookingsSheet = [
        head(['Reference', 'Court', 'Date', 'Time blocks', 'Blocks', 'Hours', 'Status', 'Payment status', 'Method', 'Total', 'Paid', 'Currency', 'Customer', 'Email', 'Mobile', 'Created']),
        ...groups.map((g) => {
          const b = g.bookings[0];
          return [
            text(g.reference), text(b.courts?.name ?? ''), text(formatDateLong(g.start_at, tz)),
            text(g.bookings.map((x) => `${formatTime(x.start_at, tz)} – ${formatTime(x.end_at, tz)}`).join(', ')),
            text(g.bookings.length), text(g.bookings.reduce((m, x) => m + x.duration_minutes, 0) / 60),
            text(bookingStatusLabel[g.booking_status]), text(paymentStatusLabel[g.payment_status]), text(method(b)),
            text(g.total), text(g.paid), text(g.currency), text(b.customer_name), text(b.customer_email), text(b.customer_phone),
            text(formatDateTime(b.created_at, tz)),
          ];
        }),
      ];
      const blocksSheet = [
        head(['Booking reference', 'Block reference', 'Court', 'Date', 'Start', 'End', 'Minutes', 'Status', 'Payment status', 'Method', 'Total', 'Paid', 'Currency', 'Customer', 'Email', 'Mobile', 'Source', 'Created']),
        ...[...all].sort((x, y) => x.start_at.localeCompare(y.start_at)).map((b) => [
          text(groupRef(b)), text(b.booking_reference), text(b.courts?.name ?? ''), text(formatDateLong(b.start_at, tz)),
          text(formatTime(b.start_at, tz)), text(formatTime(b.end_at, tz)), text(b.duration_minutes),
          text(bookingStatusLabel[b.booking_status]), text(paymentStatusLabel[b.payment_status]), text(method(b)),
          text(b.total_amount), text(b.amount_paid), text(b.currency), text(b.customer_name), text(b.customer_email), text(b.customer_phone),
          text(b.source), text(formatDateTime(b.created_at, tz)),
        ]),
      ];
      const widths = (n: number, wide: number[] = []) => Array.from({ length: n }, (_, i) => ({ width: wide.includes(i) ? 28 : 16 }));
      const { default: writeExcelFile } = await import('write-excel-file/browser');
      await writeExcelFile([
        { data: bookingsSheet, sheet: 'Bookings', columns: widths(16, [3, 13]), stickyRowsCount: 1 },
        { data: blocksSheet, sheet: 'Time blocks', columns: widths(18, [14]), stickyRowsCount: 1 },
      ]).toFile(`bookings-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) {
      toast.error('Export failed', errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <AdminPage title="Bookings" description="Search, filter and manage every reservation."
      actions={<>
        <Button variant="outline" onClick={exportXlsx} loading={exporting}><Download /> Export to Excel</Button>
        <Button onClick={() => setCreating(true)}><Plus /> New booking</Button>
      </>}>
      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr] lg:grid-cols-[2fr_repeat(5,1fr)]">
          <div className="relative md:col-span-3 lg:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-slate-400" aria-hidden />
            <Input className="pl-9" placeholder="Reference, name, email or phone" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search bookings" />
          </div>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          <Select value={courtId} onChange={(e) => setCourtId(e.target.value)} aria-label="Court">
            <option value="">All courts</option>{courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value as BookingStatus | '')} aria-label="Booking status">
            <option value="">Any status</option>{(Object.keys(bookingStatusLabel) as BookingStatus[]).map((s) => <option key={s} value={s}>{bookingStatusLabel[s]}</option>)}
          </Select>
          <Select value={payStatus} onChange={(e) => setPayStatus(e.target.value as PaymentStatus | '')} aria-label="Payment status">
            <option value="">Any payment</option>{(Object.keys(paymentStatusLabel) as PaymentStatus[]).map((s) => <option key={s} value={s}>{paymentStatusLabel[s]}</option>)}
          </Select>
        </div>
      </Card>

      <Card className="mt-4 overflow-hidden">
        {q.error ? <div className="p-4"><ErrorState message={q.error} onRetry={q.reload} /></div> : q.loading && !q.data ? <Skeleton className="m-4 h-80" /> : q.data!.rows.length === 0 ? (
          <EmptyState className="m-4" title="No bookings match these filters" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Reference</th>
                  <th scope="col" className="px-4 py-3 font-semibold">When</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Court</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Customer</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {q.data!.rows.map((g) => {
                  const b = g.bookings[0];
                  return (
                    <tr key={g.reference} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(b.id)}>
                      <td className="px-4 py-3">
                        <button type="button" className="font-mono text-xs font-semibold text-brand-700 hover:underline" onClick={(e) => { e.stopPropagation(); setOpen(b.id); }}>{g.reference}</button>
                        {g.bookings.length > 1 && <span className="block text-xs text-slate-500">{g.bookings.length} time blocks</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">{formatDateLong(g.start_at, tz)}
                        {g.bookings.map((x) => <span key={x.id} className="block text-xs text-slate-500">{formatTime(x.start_at, tz)} – {formatTime(x.end_at, tz)}</span>)}
                      </td>
                      <td className="px-4 py-3">{b.courts?.name}</td>
                      <td className="px-4 py-3"><span className="font-medium">{b.customer_name}</span><span className="block text-xs text-slate-500">{b.customer_email ?? b.customer_phone ?? '—'}</span></td>
                      <td className="px-4 py-3"><div className="flex flex-wrap gap-1"><BookingStatusBadge status={g.booking_status} /><PaymentStatusBadge status={g.payment_status} /></div></td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">{money(g.total, g.currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {q.data && <div className="px-4 pb-4"><Pagination page={page} pageSize={PAGE} total={q.data.count} onPage={setPage} /></div>}
      </Card>
      <BookingPanel bookingId={open} onClose={() => setOpen(null)} onChanged={() => void q.reload()} />
      <NewBookingDialog open={creating} onClose={() => setCreating(false)} onCreated={(ref) => setSearch(ref)} />
    </AdminPage>
  );
}
