import { useState } from 'react';
import { ShieldCheck, UserPlus } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import type { AppRole } from '@/lib/types';
import { AdminPage } from '@/components/admin/AdminPage';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, ErrorState, Skeleton } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';

const ROLE_HELP: Record<AppRole, string> = {
  customer: 'Can book courts and manage their own bookings.',
  staff: 'Front desk: live schedule, bookings, walk-ins, blocks, cash payments. No pricing, settings, revenue or payment verification.',
  admin: 'Everything, including pricing, hours, settings, reports, payment verification, refunds and staff roles.',
};

export default function Staff() {
  const { user } = useAuth();
  const toast = useToast();
  const team = useAsync(() => api.staffMembers(), []);
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const found = useAsync(() => (debounced.trim().length >= 3 ? api.searchCustomers(debounced.trim(), 5, 0) : Promise.resolve([])), [debounced]);
  const [busy, setBusy] = useState<string | null>(null);

  const setRole = async (id: string, role: AppRole) => {
    setBusy(id);
    try {
      await api.setUserRole(id, role);
      toast.success('Role updated');
      setSearch('');
      await team.reload();
    } catch (e) {
      toast.error("Couldn't change role", errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminPage title="Staff & permissions" description="Give team members access. Role changes are recorded in the audit log.">
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader><CardTitle>Team</CardTitle></CardHeader>
          <CardContent>
            {team.error ? <ErrorState message={team.error} onRetry={team.reload} /> : team.loading ? <Skeleton className="h-40" /> : (
              <ul className="divide-y divide-slate-100">
                {team.data!.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <p className="font-medium">{p.full_name ?? '—'} {p.id === user?.id && <span className="text-xs text-slate-500">(you)</span>}</p>
                      <p className="text-sm text-slate-500">{p.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={p.role === 'admin' ? 'dark' : 'blue'} className="capitalize">{p.role}</Badge>
                      <Select aria-label={`Role for ${p.email}`} className="h-9 w-auto text-sm" value={p.role} disabled={busy === p.id}
                        onChange={(e) => void setRole(p.id, e.target.value as AppRole)}>
                        <option value="admin">Admin</option><option value="staff">Staff</option><option value="customer">Remove access</option>
                      </Select>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><UserPlus className="size-5" /> Add a team member</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-600">They must first create a customer account. Then search for them here.</p>
              <Field label="Search by email or name"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="name@example.com" /></Field>
              {(found.data ?? []).filter((c) => c.role === 'customer').map((c) => (
                <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3 text-sm">
                  <span><span className="font-medium">{c.full_name}</span><span className="block text-slate-500">{c.email}</span></span>
                  <span className="flex gap-1.5">
                    <Button size="sm" variant="outline" loading={busy === c.id} onClick={() => setRole(c.id, 'staff')}>Make staff</Button>
                    <Button size="sm" loading={busy === c.id} onClick={() => setRole(c.id, 'admin')}>Make admin</Button>
                  </span>
                </div>
              ))}
              {debounced.trim().length >= 3 && found.data && found.data.filter((c) => c.role === 'customer').length === 0 && <p className="text-sm text-slate-500">No matching customer accounts.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5" /> What each role can do</CardTitle></CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                {(['admin', 'staff', 'customer'] as AppRole[]).map((r) => <div key={r}><dt className="font-semibold capitalize">{r}</dt><dd className="text-slate-600">{ROLE_HELP[r]}</dd></div>)}
              </dl>
              <Alert tone="info" className="mt-4">The last administrator can't be removed. Permissions are enforced by the database, not just this screen.</Alert>
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminPage>
  );
}
