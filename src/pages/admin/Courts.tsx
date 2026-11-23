import { useState } from 'react';
import { Images, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { useFacility } from '@/hooks/useFacility';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/lib/api';
import { errorMessage, isAppError } from '@/lib/errors';
import { money } from '@/lib/format';
import { formatDuration } from '@/lib/time';
import type { ConflictBooking, Court, CourtType } from '@/lib/types';
import { AdminPage } from '@/components/admin/AdminPage';
import { ConflictDialog } from '@/components/admin/ConflictDialog';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Alert, Badge, Card, ErrorState, Skeleton } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { CourtImage } from '@/components/booking/CourtVisual';
import { CourtPhotosDialog } from '@/components/admin/CourtPhotos';

interface Draft {
  id?: string; name: string; description: string; court_type: CourtType; image_url: string; base_hourly_rate: string;
  allowed_durations: string; min_advance_minutes: string; max_advance_days: string; sort_order: string; features: string;
}
const empty: Draft = { name: '', description: '', court_type: 'outdoor', image_url: '', base_hourly_rate: '', allowed_durations: '', min_advance_minutes: '', max_advance_days: '', sort_order: '0', features: '' };

export default function Courts() {
  const { currency, reload: reloadFacility } = useFacility();
  const toast = useToast();
  const q = useAsync(() => api.courts(true), []);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ court: Court; list: ConflictBooking[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [photosFor, setPhotosFor] = useState<Court | null>(null);

  const refresh = async () => { await q.reload(); await reloadFacility(); };

  const edit = (c?: Court) => {
    setFormError(null);
    setDraft(c ? {
      id: c.id, name: c.name, description: c.description, court_type: c.court_type, image_url: c.image_url ?? '',
      base_hourly_rate: String(c.base_hourly_rate), allowed_durations: (c.allowed_durations ?? []).join(', '),
      min_advance_minutes: c.min_advance_minutes?.toString() ?? '', max_advance_days: c.max_advance_days?.toString() ?? '',
      sort_order: String(c.sort_order), features: c.features.join(', '),
    } : { ...empty, sort_order: String((q.data?.length ?? 0) + 1) });
  };

  const save = async () => {
    if (!draft) return;
    const rate = Number(draft.base_hourly_rate);
    const durations = draft.allowed_durations.split(',').map((s) => s.trim()).filter(Boolean).map(Number);
    if (draft.name.trim().length < 1) return setFormError('Enter a court name.');
    if (!(rate >= 0) || draft.base_hourly_rate === '') return setFormError('Enter a valid hourly rate.');
    if (durations.some((d) => !Number.isInteger(d) || d <= 0 || d % 15 !== 0)) return setFormError('Durations must be minutes in multiples of 15, e.g. "60, 90, 120".');
    if (draft.image_url && !/^(https?:\/\/|\/)/.test(draft.image_url)) return setFormError('Photo/video must be a full https:// link or a site path like /media/court.mp4');
    setSaving(true); setFormError(null);
    try {
      await api.saveCourt({
        id: draft.id, name: draft.name.trim(), description: draft.description.trim(), court_type: draft.court_type,
        image_url: draft.image_url.trim() || null, base_hourly_rate: rate, allowed_durations: durations.length ? durations : null,
        min_advance_minutes: draft.min_advance_minutes === '' ? null : Number(draft.min_advance_minutes),
        max_advance_days: draft.max_advance_days === '' ? null : Number(draft.max_advance_days),
        sort_order: Number(draft.sort_order) || 0, features: draft.features.split(',').map((s) => s.trim()).filter(Boolean),
      });
      toast.success(draft.id ? 'Court updated' : 'Court added', draft.id ? 'Existing bookings keep their original price.' : undefined);
      setDraft(null);
      await refresh();
    } catch (e) {
      setFormError(isAppError(e) && e.code === 'DUPLICATE' ? 'A court with that name already exists.' : errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (c: Court, acknowledge = false) => {
    setBusy(c.id);
    try {
      const r = await api.setCourtActive(c.id, !c.is_active, acknowledge);
      if (r.status === 'conflicts') { setConflict({ court: c, list: r.conflicts ?? [] }); return; }
      setConflict(null);
      toast.success(c.is_active ? `${c.name} deactivated` : `${c.name} is taking bookings`, c.is_active && r.kept_bookings?.length ? `${r.kept_bookings.length} existing booking(s) were kept.` : undefined);
      await refresh();
    } catch (e) {
      toast.error("Couldn't update court", errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (c: Court) => {
    if (!window.confirm(`Delete ${c.name}? This only works for courts that have never been booked.`)) return;
    try { await api.deleteCourt(c.id); toast.success('Court deleted'); await refresh(); }
    catch (e) { toast.error("Couldn't delete", isAppError(e) && e.code === 'IN_USE' ? 'This court has booking history. Deactivate it instead to keep the records.' : errorMessage(e)); }
  };

  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setDraft((d) => d && { ...d, [k]: e.target.value });

  return (
    <AdminPage title="Courts" description="Add courts, set prices and take courts out of service. Deactivating stops new bookings but keeps history."
      actions={<Button onClick={() => edit()}><Plus /> Add court</Button>}>
      {q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : q.loading ? <Skeleton className="h-64" /> : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {q.data!.map((c) => (
            <Card key={c.id} className={c.is_active ? 'overflow-hidden' : 'overflow-hidden opacity-75'}>
              <div className="aspect-[5/2] bg-slate-100"><CourtImage src={c.photos?.[0]?.url ?? c.image_url} type={c.court_type} name={c.name} /></div>
              <div className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="font-semibold">{c.name}</h2>
                    <p className="text-sm capitalize text-slate-500">{c.court_type} · {money(c.base_hourly_rate, currency)}/hr</p>
                  </div>
                  <Badge tone={c.is_active ? 'green' : 'neutral'} dot>{c.is_active ? 'Active' : 'Inactive'}</Badge>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-slate-600">{c.description || 'No description.'}</p>
                <p className="mt-2 text-xs text-slate-500">
                  Lengths: {c.allowed_durations ? c.allowed_durations.map(formatDuration).join(', ') : 'facility default'}
                  {c.max_advance_days != null && <> · up to {c.max_advance_days} days ahead</>}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => edit(c)}><Pencil /> Edit</Button>
                  <Button size="sm" variant="outline" onClick={() => setPhotosFor(c)}><Images /> Photos{c.photos?.length ? ` (${c.photos.length})` : ''}</Button>
                  <Button size="sm" variant={c.is_active ? 'danger-outline' : 'primary'} loading={busy === c.id} onClick={() => toggle(c)}>
                    <Power /> {c.is_active ? 'Deactivate' : 'Activate'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(c)} aria-label={`Delete ${c.name}`}><Trash2 /></Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!draft} onClose={() => setDraft(null)} size="lg" title={draft?.id ? 'Edit court' : 'Add court'}
        footer={<><Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button><Button onClick={save} loading={saving}>Save court</Button></>}>
        {draft && (
          <div className="grid gap-4 sm:grid-cols-2">
            {formError && <Alert tone="error" className="sm:col-span-2">{formError}</Alert>}
            <Field label="Name" required><Input value={draft.name} onChange={set('name')} maxLength={80} /></Field>
            <Field label="Type"><Select value={draft.court_type} onChange={set('court_type')}><option value="outdoor">Outdoor</option><option value="indoor">Indoor</option></Select></Field>
            <Field label={`Standard hourly rate (${currency})`} required hint="Peak/off-peak overrides live in Pricing & Rules.">
              <Input type="number" min={0} step="0.01" value={draft.base_hourly_rate} onChange={set('base_hourly_rate')} />
            </Field>
            <Field label="Display order"><Input type="number" value={draft.sort_order} onChange={set('sort_order')} /></Field>
            <Field label="Description" className="sm:col-span-2"><Textarea rows={3} value={draft.description} onChange={set('description')} maxLength={2000} /></Field>
            <Field label="Photo or video" optional className="sm:col-span-2" hint="A link (https://…) or a file in the site's public/media folder, e.g. /media/court.mp4. Videos play silently on a loop. Empty = illustrated court."><Input value={draft.image_url} onChange={set('image_url')} placeholder="/media/court.mp4" /></Field>
            <Field label="Features" optional className="sm:col-span-2" hint="Comma separated, e.g. LED lighting, Windscreens"><Input value={draft.features} onChange={set('features')} /></Field>
            <Field label="Allowed booking lengths (minutes)" optional hint="e.g. 60, 90, 120 — empty uses the facility rules."><Input value={draft.allowed_durations} onChange={set('allowed_durations')} /></Field>
            <Field label="Min. notice (minutes)" optional hint="Empty uses the facility rule."><Input type="number" min={0} value={draft.min_advance_minutes} onChange={set('min_advance_minutes')} /></Field>
            <Field label="Max. days ahead" optional hint="Empty uses the facility rule."><Input type="number" min={0} max={365} value={draft.max_advance_days} onChange={set('max_advance_days')} /></Field>
          </div>
        )}
      </Dialog>

      {photosFor && <CourtPhotosDialog key={photosFor.id} court={photosFor} open onClose={() => setPhotosFor(null)} onChanged={refresh} />}

      <ConflictDialog open={!!conflict} conflicts={conflict?.list ?? []} onClose={() => setConflict(null)} busy={busy === conflict?.court.id}
        title={`Deactivate ${conflict?.court.name}?`}
        body="These upcoming bookings are on this court. Deactivating stops new bookings only — these reservations stay valid. Contact the customers or cancel/reschedule them individually if the court won't be playable."
        confirmLabel="Deactivate and keep bookings" onConfirm={() => conflict && void toggle(conflict.court, true)} />
    </AdminPage>
  );
}
