import { useEffect, useState } from 'react';
import { useFacility } from '@/hooks/useFacility';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/time';
import { paymentMethodLabel } from '@/lib/format';
import type { FacilitySettings, PaymentMethodConfig } from '@/lib/types';
import { AdminPage } from '@/components/admin/AdminPage';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Textarea } from '@/components/ui/form';
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState, Pagination, Skeleton, Tabs } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { PaymentQrCodes } from '@/components/admin/PaymentQrCodes';

export default function SettingsPage() {
  const [tab, setTab] = useState<'facility' | 'payments' | 'email' | 'audit' | 'backup'>('facility');
  return (
    <AdminPage title="Settings" description="Facility details, payment methods, email delivery, the audit log and backups.">
      <Tabs label="Settings section" value={tab} onChange={setTab} className="mb-5"
        items={[{ value: 'facility', label: 'Facility' }, { value: 'payments', label: 'Payment methods' }, { value: 'email', label: 'Email log' }, { value: 'audit', label: 'Audit log' }, { value: 'backup', label: 'Backup' }]} />
      {tab === 'facility' && <FacilityForm />}
      {tab === 'payments' && <PaymentMethods />}
      {tab === 'email' && <EmailLog />}
      {tab === 'audit' && <AuditLog />}
      {tab === 'backup' && <Backup />}
    </AdminPage>
  );
}

const LAST_BACKUP_KEY = 'nthplay:last-backup';

/** Downloads every business record as one JSON file (the free database plan has no automatic backups). */
function Backup() {
  const toast = useToast();
  const { tz } = useFacility();
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string | null>(() => { try { return localStorage.getItem(LAST_BACKUP_KEY); } catch { return null; } });

  const download = async () => {
    setBusy(true);
    try {
      const data = await api.exportBackup();
      const stamp = new Date().toISOString().slice(0, 10);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: `nthplay-backup-${stamp}.json` });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const now = new Date().toISOString();
      try { localStorage.setItem(LAST_BACKUP_KEY, now); } catch { /* ignore */ }
      setLast(now);
      const n = (k: string) => (Array.isArray(data[k]) ? (data[k] as unknown[]).length : 0);
      toast.success('Backup downloaded', `${n('bookings')} bookings, ${n('payments')} payments, ${n('profiles')} accounts.`);
    } catch (e) {
      toast.error("Couldn't create the backup", errorMessage(e));
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Backup</CardTitle>
        <CardDescription>
          Download a copy of all your data: facility settings, courts, prices, hours, customer accounts, bookings,
          payments and the audit log. The free database plan has no automatic backups, so download one regularly
          (for example once a week) and keep it somewhere safe, such as Google Drive.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={() => void download()} loading={busy}>Download backup</Button>
        <p className="text-sm text-slate-600">
          {last ? <>Last downloaded on this device: <span className="font-medium text-ink-900">{formatDateTime(last, tz)}</span></> : 'No backup downloaded on this device yet.'}
        </p>
        <Alert tone="info">
          The file contains customers' names, emails and phone numbers. Store it privately and don't share it.
          Receipt images aren't included; they're deleted automatically 45 days after upload.
        </Alert>
      </CardContent>
    </Card>
  );
}

function useAdminSettings() {
  const q = useAsync(() => api.adminSettings(), []);
  const [form, setForm] = useState<FacilitySettings | null>(null);
  useEffect(() => { if (q.data) setForm(q.data); }, [q.data]);
  return { q, form, setForm };
}

function FacilityForm() {
  const { reload } = useFacility();
  const toast = useToast();
  const { q, form, setForm } = useAdminSettings();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? ['Asia/Manila', 'UTC'];

  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  if (!form) return <Skeleton className="h-96" />;
  const set = <K extends keyof FacilitySettings>(k: K) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value } as FacilitySettings);

  const save = async () => {
    if (q.data && form.timezone !== q.data.timezone && !window.confirm(
      `Change the facility time zone from ${q.data.timezone} to ${form.timezone}?\n\nOpening hours and new bookings will use the new zone. Existing bookings keep their exact time but will display in the new zone — review upcoming bookings afterwards.`)) return;
    setSaving(true); setErr(null);
    try {
      await api.saveSettings({
        facility_name: form.facility_name.trim(), tagline: form.tagline.trim(), description: form.description.trim(),
        contact_email: form.contact_email.trim(), contact_phone: form.contact_phone.trim(), address: form.address.trim(), map_url: form.map_url.trim(),
        amenities: form.amenities.map((a) => a.trim()).filter(Boolean), admin_alert_email: (form.admin_alert_email ?? '').trim(),
        timezone: form.timezone, currency: form.currency.trim().toUpperCase(),
      });
      toast.success('Settings saved');
      await Promise.all([q.reload(), reload()]);
    } catch (e) { setErr(errorMessage(e)); } finally { setSaving(false); }
  };

  return (
    <Card>
      <CardContent className="space-y-5">
        {err && <Alert tone="error">{err}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Facility name" required><Input value={form.facility_name} onChange={set('facility_name')} /></Field>
          <Field label="Headline" hint="Shown on the home page."><Input value={form.tagline} onChange={set('tagline')} /></Field>
          <Field label="Introduction" className="sm:col-span-2"><Textarea rows={3} value={form.description} onChange={set('description')} /></Field>
          <Field label="Contact email"><Input type="email" value={form.contact_email} onChange={set('contact_email')} /></Field>
          <Field label="Contact phone"><Input value={form.contact_phone} onChange={set('contact_phone')} /></Field>
          <Field label="Address" className="sm:col-span-2"><Input value={form.address} onChange={set('address')} /></Field>
          <Field label="Map link" optional hint="e.g. a Google Maps share link"><Input type="url" value={form.map_url} onChange={set('map_url')} /></Field>
          <Field label="Admin alert email" optional hint="Receives new-booking and payment-to-verify alerts. Never shown publicly."><Input type="email" value={form.admin_alert_email ?? ''} onChange={set('admin_alert_email')} /></Field>
          <Field label="Amenities" className="sm:col-span-2" hint="One per line.">
            <Textarea rows={4} value={form.amenities.join('\n')} onChange={(e) => setForm({ ...form, amenities: e.target.value.split('\n') })} />
          </Field>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
          <p className="text-sm font-semibold text-amber-900">Time zone &amp; currency</p>
          <p className="mt-1 text-sm text-amber-900/80">All availability, hours and validation use the facility time zone. Existing bookings are stored as exact instants and are not moved, but their displayed local time changes if you switch zones. Currency changes apply to new quotes only.</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Time zone">
              <select className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3" value={form.timezone} onChange={set('timezone')}>
                {zones.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            </Field>
            <Field label="Currency (ISO code)"><Input value={form.currency} maxLength={3} onChange={set('currency')} /></Field>
          </div>
        </div>
        <Button onClick={save} loading={saving}>Save settings</Button>
      </CardContent>
    </Card>
  );
}

function PaymentMethods() {
  const { reload } = useFacility();
  const toast = useToast();
  const { q, form, setForm } = useAdminSettings();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  if (!form) return <Skeleton className="h-64" />;
  const upd = (i: number, patch: Partial<PaymentMethodConfig>) =>
    setForm({ ...form, payment_methods: form.payment_methods.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await api.saveSettings({ payment_methods: form.payment_methods });
      toast.success('Payment methods saved');
      await Promise.all([q.reload(), reload()]);
    } catch (e) { setErr(errorMessage(e)); } finally { setSaving(false); }
  };
  return (
    <div className="space-y-4">
      <PaymentQrCodes methods={form.payment_methods} onChanged={() => q.reload()} />
      {err && <Alert tone="error">{err}</Alert>}
      {form.payment_methods.map((m, i) => (
        <Card key={m.method}>
          <CardHeader className="flex-row items-center justify-between">
            <div><CardTitle>{paymentMethodLabel[m.method]}</CardTitle>
              <CardDescription>
                {m.method === 'cash' && 'Customer pays at the front desk; staff record it from the booking.'}
                {(m.method === 'gcash' || m.method === 'bank_transfer') && 'Customer pays outside the app and submits the reference; an admin verifies it.'}
                {m.method === 'gateway' && 'Requires a payment provider integration (see docs). Not available to customers until one is configured.'}
              </CardDescription>
            </div>
            <Badge tone={m.enabled ? 'green' : 'neutral'}>{m.enabled ? 'Enabled' : 'Disabled'}</Badge>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Checkbox label="Offer this method" checked={m.enabled} disabled={m.method === 'gateway' && !m.enabled} onChange={(e) => upd(i, { enabled: e.target.checked })} className="sm:col-span-2" />
            <Field label="Label shown to customers"><Input value={m.label} onChange={(e) => upd(i, { label: e.target.value })} /></Field>
            {(m.method === 'gcash' || m.method === 'bank_transfer') && <>
              <div className="flex items-center gap-3 sm:col-span-2">
                {m.qr_url
                  ? <img src={m.qr_url} alt={`${m.label} QR code`} className="size-20 rounded-lg border border-slate-200 bg-white object-contain p-1" />
                  : <span className="grid size-20 place-items-center rounded-lg border border-dashed border-slate-300 text-[11px] text-slate-400">No QR</span>}
                <p className="text-sm text-slate-600">Change this QR code under <strong>Payment QR codes</strong> above. Customers only see methods that have one.</p>
              </div>
              <Field label="Account name" optional><Input value={m.account_name ?? ''} onChange={(e) => upd(i, { account_name: e.target.value || undefined })} /></Field>
              <Field label="Account / mobile number" optional><Input value={m.account_number ?? ''} onChange={(e) => upd(i, { account_number: e.target.value || undefined })} /></Field>
            </>}
            <Field label="Payment instructions" className="sm:col-span-2" hint="Anything else customers should know, e.g. send the exact amount."><Textarea rows={3} value={m.instructions} onChange={(e) => upd(i, { instructions: e.target.value })} /></Field>
          </CardContent>
        </Card>
      ))}
      <Button onClick={save} loading={saving}>Save payment methods</Button>
    </div>
  );
}

function EmailLog() {
  const { tz } = useFacility();
  const [page, setPage] = useState(0);
  const q = useAsync(() => api.notifications(page, 25), [page]);
  const tone = { queued: 'neutral', sending: 'blue', sent: 'green', failed: 'red', skipped: 'amber' } as const;
  return (
    <Card>
      <CardHeader><CardTitle>Email delivery</CardTitle>
        <CardDescription>The outbox the email worker sends from. "Queued" for a long time means email isn't configured yet — see the deployment guide (RESEND_API_KEY).</CardDescription></CardHeader>
      <CardContent>
        {q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : !q.data ? <Skeleton className="h-64" /> : q.data.rows.length === 0 ? <p className="text-sm text-slate-600">No emails yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-2 pr-4">Created</th><th className="py-2 pr-4">Type</th><th className="py-2 pr-4">To</th><th className="py-2 pr-4">Status</th><th className="py-2">Detail</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {q.data.rows.map((n) => (
                  <tr key={n.id}>
                    <td className="whitespace-nowrap py-2 pr-4">{formatDateTime(n.created_at, tz)}</td>
                    <td className="py-2 pr-4">{n.notification_type.replace(/_/g, ' ')}</td>
                    <td className="py-2 pr-4">{n.recipient_email}</td>
                    <td className="py-2 pr-4"><Badge tone={tone[n.delivery_status]}>{n.delivery_status}</Badge></td>
                    <td className="py-2 text-xs text-slate-500">{n.delivery_status === 'sent' ? `${n.provider_message_id} · ${n.sent_at ? formatDateTime(n.sent_at, tz) : ''}` : n.last_error ?? (n.attempts ? `${n.attempts} attempt(s)` : '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} pageSize={25} total={q.data.count} onPage={setPage} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AuditLog() {
  const { tz } = useFacility();
  const [page, setPage] = useState(0);
  const q = useAsync(() => api.recentAudit(page, 30), [page]);
  const actors = useAsync(() => api.profilesByIds([...new Set((q.data?.rows ?? []).map((r) => r.actor_id).filter(Boolean) as string[])]), [q.data]);
  const name = (id: string | null) => (id ? actors.data?.find((a) => a.id === id)?.full_name ?? actors.data?.find((a) => a.id === id)?.email ?? 'User' : 'System');
  return (
    <Card>
      <CardHeader><CardTitle>Audit log</CardTitle><CardDescription>Changes to bookings, payments, courts, pricing, hours, blocks, settings and roles. Read-only.</CardDescription></CardHeader>
      <CardContent>
        {q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : !q.data ? <Skeleton className="h-64" /> : (
          <>
            <ul className="divide-y divide-slate-100 text-sm">
              {q.data.rows.map((a) => (
                <li key={a.id} className="py-2.5">
                  <span className="font-medium">{formatDateTime(a.created_at, tz)}</span> · {name(a.actor_id)} · <span className="font-mono text-xs">{a.action} {a.entity_type}</span>
                  {'changes' in a.metadata && (
                    <span className="block truncate text-xs text-slate-500">
                      {Object.entries(a.metadata.changes as Record<string, { from: unknown; to: unknown }>).map(([k, v]) => `${k}: ${JSON.stringify(v.from)} → ${JSON.stringify(v.to)}`).join(' · ')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <Pagination page={page} pageSize={30} total={q.data.count} onPage={setPage} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
