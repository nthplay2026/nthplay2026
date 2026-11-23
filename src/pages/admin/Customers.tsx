import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Search } from 'lucide-react';
import { useFacility } from '@/hooks/useFacility';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { api } from '@/lib/api';
import { formatDateLong } from '@/lib/time';
import { AdminPage } from '@/components/admin/AdminPage';
import { Input } from '@/components/ui/form';
import { Badge, Card, EmptyState, ErrorState, Pagination, Skeleton } from '@/components/ui/misc';

const PAGE = 25;

export default function Customers() {
  const { tz } = useFacility();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [debounced]);
  const q = useAsync(() => api.searchCustomers(debounced.trim(), PAGE, page * PAGE), [debounced, page]);
  const total = q.data?.[0]?.total_count ?? 0;

  return (
    <AdminPage title="Customers" description="Registered players and their booking activity.">
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-slate-400" aria-hidden />
        <Input className="pl-9" placeholder="Search by name, email or mobile" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search customers" />
      </div>
      <Card className="mt-4 overflow-hidden">
        {q.error ? <div className="p-4"><ErrorState message={q.error} onRetry={q.reload} /></div> : q.loading && !q.data ? <Skeleton className="m-4 h-64" /> : q.data!.length === 0 ? (
          <EmptyState className="m-4" title="No customers found" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Name</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Contact</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Bookings</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Upcoming</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Last booking</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {q.data!.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-3 font-medium">{c.full_name ?? '—'} {c.role !== 'customer' && <Badge tone="dark" className="ml-1 capitalize">{c.role}</Badge>}</td>
                    <td className="px-4 py-3">{c.email}<span className="block text-xs text-slate-500">{c.mobile_number ?? '—'}</span></td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {c.total_bookings > 0 && c.email ? <Link className="font-semibold text-brand-700 hover:underline" to={`/admin/bookings?ref=${encodeURIComponent(c.email)}`}>{c.total_bookings}</Link> : c.total_bookings}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{c.upcoming_bookings}</td>
                    <td className="px-4 py-3">{c.last_booking_at ? formatDateLong(c.last_booking_at, tz) : '—'}</td>
                    <td className="px-4 py-3">{formatDateLong(c.created_at, tz)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 pb-4"><Pagination page={page} pageSize={PAGE} total={Number(total)} onPage={setPage} /></div>
      </Card>
    </AdminPage>
  );
}
