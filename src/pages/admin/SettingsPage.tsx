import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Pencil } from 'lucide-react';
import { useFacility } from '@/hooks/useFacility';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/time';
import { paymentMethodLabel } from '@/lib/format';
import type { FacilitySettings, PaymentMethodConfig } from '@/lib/types';
import { AdminPage } from '@/components/admin/AdminPage';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState, Pagination, Skeleton, Tabs } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { PaymentQrCodes } from '@/components/admin/PaymentQrCodes';
import { LegalText } from '@/components/layout/LegalText';
import { defaultPartyRulesText, defaultPrivacyText, defaultTermsText } from '@/lib/legal';

export default function SettingsPage() {
  type Tab = 'facility' | 'payments' | 'legal' | 'email' | 'audit' | 'backup';
  const [params] = useSearchParams();
  const fromLink = params.get('tab');
  const [tab, setTab] = useState<Tab>((['facility', 'payments', 'legal', 'email', 'audit', 'backup'] as const).find((x) => x === fromLink) ?? 'facility');
  useEffect(() => { if (fromLink === 'backup') setTab('backup'); }, [fromLink]);
  return (
    <AdminPage title="Settings" description="Facility details, payment methods, email delivery, the audit log and backups.">
      <Tabs label="Settings section" value={tab} onChange={setTab} className="mb-5"
        items={[{ value: 'facility', label: 'Facility' }, { value: 'payments', label: 'Payment methods' }, { value: 'legal', label: 'Rules & policies' }, { value: 'email', label: 'Email log' }, { value: 'audit', label: 'Audit log' }, { value: 'backup', label: 'Backup' }]} />
      {tab === 'facility' && <FacilityForm />}
      {tab === 'payments' && <PaymentMethods />}
      {tab === 'email' && <EmailLog />}
      {tab === 'audit' && <AuditLog />}
      {tab === 'legal' && <LegalPages />}
      {tab === 'backup' && <Backup />}
    </AdminPage>
  );
}

/** Edit the Terms & booking policy and the Privacy policy shown on the website. */
function LegalPages() {
  const { settings, reload } = useFacility();
  const toast = useToast();
  const { tz } = useFacility();
  const [page, setPage] = useState<'terms' | 'privacy' | 'party'>('terms');
  const PAGES = {
    terms: { title: 'Terms & booking policy', path: '/terms', saved: settings?.terms_content, updatedAt: settings?.terms_updated_at, fallback: () => defaultTermsText(settings), saveLabel: 'terms' },
    privacy: { title: 'Privacy policy', path: '/privacy', saved: settings?.privacy_content, updatedAt: settings?.privacy_updated_at, fallback: () => defaultPrivacyText(settings), saveLabel: 'privacy policy' },
    party: { title: 'Party rules', path: '/party-rules', saved: settings?.party_rules_content, updatedAt: settings?.party_rules_updated_at, fallback: () => defaultPartyRulesText(settings), saveLabel: 'party rules' },
  } as const;
  const cur = PAGES[page];
  const saved = cur.saved;
  const updatedAt = cur.updatedAt;
  const fallback = cur.fallback();
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  // Load the page's current text (the admin's version, or the default) when switching pages.
  useEffect(() => { setText(saved || fallback); setPreview(false); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, saved]);

  const dirty = text.trim() !== (saved || fallback).trim();
  const title = cur.title;

  const save = async (content: string | null) => {
    setBusy(true);
    try {
      await api.updateLegalPage(page, content);
      await reload();
      toast.success(content === null ? `${title}: default text restored` : `${title} saved`, 'The website shows it now.');
    } catch (e) {
      toast.error("Couldn't save", errorMessage(e));
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rules & policies</CardTitle>
        <CardDescription>
          Edit what customers read on the Terms & booking policy, Privacy policy and Party rules pages (the party rules
          open from the home page). Have someone familiar with Philippine law, including the Data Privacy Act, review the
          final wording of the terms and privacy policy.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs label="Legal page" value={page} onChange={setPage}
          items={[{ value: 'terms', label: 'Terms & booking policy' }, { value: 'privacy', label: 'Privacy policy' }, { value: 'party', label: 'Party rules' }]} />
        <p className="text-sm text-slate-600">
          {saved ? <>Your edited version · last updated <span className="font-medium text-ink-900">{formatDateTime(updatedAt ?? '', tz)}</span></>
            : 'Showing the built-in default text. Edit and save to make it yours.'}
          {' '}<a href={cur.path} target="_blank" rel="noreferrer" className="font-medium text-brand-700 hover:underline">View page</a>
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant={preview ? 'outline' : 'primary'} onClick={() => setPreview(false)}>Edit</Button>
          <Button size="sm" variant={preview ? 'primary' : 'outline'} onClick={() => setPreview(true)}>Preview</Button>
        </div>
        {preview ? (
          <div className="max-h-[60vh] space-y-5 overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 leading-relaxed text-ink-800 [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">
            <LegalText text={text} />
          </div>
        ) : (
          <Field label={title} hint='Formatting: start a line with "## " for a heading and "- " for a bullet point. Leave an empty line between paragraphs.'>
            <Textarea rows={20} value={text} onChange={(e) => setText(e.target.value)} maxLength={30000} className="font-mono text-sm leading-relaxed" />
          </Field>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void save(text)} loading={busy} disabled={!dirty || !text.trim()}>Save {cur.saveLabel}</Button>
          {dirty && <Button variant="ghost" onClick={() => setText(saved || fallback)}>Discard changes</Button>}
          {saved && (
            <Button variant="danger-outline" className="ml-auto" disabled={busy}
              onClick={() => { if (window.confirm('Replace your version with the built-in default text?')) void save(null); }}>
              Restore default text
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const REMINDER_OPTIONS: { value: string; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: '3', label: 'Every 3 days' },
  { value: '7', label: 'Every week' },
  { value: '14', label: 'Every 2 weeks' },
  { value: '30', label: 'Every month' },
];

/**
 * Downloads every business record as one JSON file (the free database plan has no automatic
 * backups) and sets how often admins are reminded to do it. Reminders come from the server:
 * a "Time to back up" notification (bell + phone) at 9:00 AM while a backup is due.
 */
function Backup() {
  const toast = useToast();
  const { tz } = useFacility();
  const status = useAsync(() => api.backupStatus(), []);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [choice, setChoice] = useState<string>('7');
  useEffect(() => { if (status.data) setChoice(status.data.reminder_days == null ? 'off' : String(status.data.reminder_days)); }, [status.data]);

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
      const n = (k: string) => (Array.isArray(data[k]) ? (data[k] as unknown[]).length : 0);
      toast.success('Backup downloaded', `${n('bookings')} bookings, ${n('payments')} payments, ${n('profiles')} accounts.`);
      void status.reload();
    } catch (e) {
      toast.error("Couldn't create the backup", errorMessage(e));
    } finally { setBusy(false); }
  };

  const saveReminder = async () => {
    setSaving(true);
    try {
      await api.setBackupReminder(choice === 'off' ? null : Number(choice));
      toast.success(choice === 'off' ? 'Backup reminders turned off' : 'Backup reminder saved');
      void status.reload();
    } catch (e) {
      toast.error("Couldn't save the reminder", errorMessage(e));
    } finally { setSaving(false); }
  };

  const st = status.data;
  const saved = st ? (st.reminder_days == null ? 'off' : String(st.reminder_days)) : null;
  const overdue = !!st?.next_due_at && Date.parse(st.next_due_at) <= Date.now();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Backup</CardTitle>
        <CardDescription>
          Download a copy of all your data: facility settings, courts, prices, hours, customer accounts, bookings,
          payments and the audit log. The free database plan has no automatic backups, so download one regularly
          and keep it somewhere safe, such as Google Drive.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {status.loading && !st ? <Skeleton className="h-20" /> : status.error ? <ErrorState message={status.error} onRetry={() => void status.reload()} /> : (
          <>
            {overdue && (
              <Alert tone="warning">
                {st?.last_backup_at ? 'A new backup is due.' : 'No backup has been downloaded yet.'} Download one now to keep your data safe.
              </Alert>
            )}
            <div className="space-y-2">
              <Button onClick={() => void download()} loading={busy}>Download backup</Button>
              <p className="text-sm text-slate-600">
                {st?.last_backup_at
                  ? <>Last backup: <span className="font-medium text-ink-900">{formatDateTime(st.last_backup_at, tz)}</span> (by any admin, on any device)</>
                  : 'No backup downloaded yet.'}
              </p>
            </div>

            <div className="space-y-3 border-t border-slate-100 pt-5">
              <div>
                <h3 className="font-semibold text-ink-900">Backup reminder</h3>
                <p className="text-sm text-slate-600">
                  When a backup is due, every admin gets a "Time to back up" notification at 9:00 AM, in the bell and
                  on their phone if phone alerts are on. It repeats each morning until someone downloads a backup.
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Remind me" className="w-56">
                  <Select value={choice} onChange={(e) => setChoice(e.target.value)}>
                    {REMINDER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    {saved && !REMINDER_OPTIONS.some((o) => o.value === saved) && <option value={saved}>Every {saved} days</option>}
                  </Select>
                </Field>
                <Button variant="outline" onClick={() => void saveReminder()} loading={saving} disabled={choice === saved}>Save reminder</Button>
              </div>
              {st?.reminder_days != null && st.next_due_at && (
                <p className="text-sm text-slate-600">
                  {overdue ? 'Next reminder: tomorrow at 9:00 AM, unless a backup is downloaded first.'
                    : <>Next backup due: <span className="font-medium text-ink-900">{formatDateTime(st.next_due_at, tz)}</span></>}
                </p>
              )}
            </div>
          </>
        )}
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
            <div className="min-w-0 flex-1">
              {/* The heading is the method's name: click it to rename (e.g. GCash -> GoTyme Bank). */}
              <label className="group flex max-w-md items-center gap-2 rounded-lg border border-transparent px-2 py-1 -mx-2 focus-within:border-brand-600 focus-within:bg-white hover:border-slate-300">
                <span className="sr-only">Payment method name</span>
                <input value={m.label} maxLength={40} placeholder={paymentMethodLabel[m.method]}
                  onChange={(e) => upd(i, { label: e.target.value })}
                  className="min-w-0 flex-1 bg-transparent text-lg font-semibold text-ink-900 outline-none placeholder:text-slate-400" />
                <Pencil className="size-4 shrink-0 text-slate-400 group-hover:text-ink-700" aria-hidden />
              </label>
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
