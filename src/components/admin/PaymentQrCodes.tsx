import { useState, type FormEvent } from 'react';
import { ImageUp, KeyRound, Lock, Trash2 } from 'lucide-react';
import { useFacility } from '@/hooks/useFacility';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import type { PaymentMethodConfig } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/form';
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';

type QrMethod = 'gcash' | 'bank_transfer';
const QR_METHODS: { method: QrMethod; fallback: string }[] = [
  { method: 'gcash', fallback: 'GCash QR Code' },
  { method: 'bank_transfer', fallback: 'QRPh' },
];

/** Admin: upload the QR codes shown at checkout. Publishing needs the publishing password. */
export function PaymentQrCodes({ methods, onChanged }: { methods: PaymentMethodConfig[]; onChanged: () => Promise<void> | void }) {
  const pw = useAsync(() => api.qrPasswordIsSet(), []);
  const [changing, setChanging] = useState(false);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Payment QR codes</CardTitle>
          <CardDescription>The QR codes customers scan at checkout. Publishing a new one asks for the publishing password.</CardDescription>
        </div>
        {pw.data && <Badge tone="green"><Lock className="size-3" /> Password set</Badge>}
      </CardHeader>
      <CardContent className="space-y-5">
        {pw.loading && pw.data === undefined ? <Skeleton className="h-24" /> : !pw.data ? (
          <PasswordForm mode="create" onDone={() => void pw.reload()} />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              {QR_METHODS.map(({ method, fallback }) => {
                const cfg = methods.find((m) => m.method === method);
                return <QrSlot key={method} method={method} label={cfg?.label || fallback} current={cfg?.qr_url} onChanged={onChanged} />;
              })}
            </div>
            {changing ? (
              <PasswordForm mode="change" onDone={() => setChanging(false)} onCancel={() => setChanging(false)} />
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setChanging(true)}><KeyRound /> Change publishing password</Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PasswordForm({ mode, onDone, onCancel }: { mode: 'create' | 'change'; onDone: () => void; onCancel?: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next.length < 8) return setError('Use at least 8 characters.');
    if (next !== confirm) return setError("The two passwords don't match.");
    setBusy(true); setError(null);
    try {
      const r = await api.setQrPassword(mode === 'change' ? current : null, next);
      if (!r.ok) { setError(r.message ?? 'Could not save the password.'); return; }
      toast.success(mode === 'create' ? 'Publishing password set' : 'Publishing password changed');
      onDone();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4" autoComplete="off">
      <p className="text-sm font-semibold text-ink-900">{mode === 'create' ? 'Create a publishing password' : 'Change the publishing password'}</p>
      {mode === 'create' && (
        <p className="text-sm text-slate-600">
          You'll type this every time you publish a QR code. It's stored scrambled and is never shown again, so keep it somewhere safe.
        </p>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        {mode === 'change' && (
          <Field label="Current password"><Input type="password" autoComplete="off" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
        )}
        <Field label="New password" hint="At least 8 characters."><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        <Field label="Type it again"><Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={busy}><KeyRound /> {mode === 'create' ? 'Set password' : 'Change password'}</Button>
        {onCancel && <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}

function QrSlot({ method, label, current, onChanged }: { method: QrMethod; label: string; current?: string; onChanged: () => Promise<void> | void }) {
  const toast = useToast();
  const { reload } = useFacility();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [asking, setAsking] = useState<null | 'publish' | 'remove'>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = (f: File | null) => {
    if (preview) URL.revokeObjectURL(preview);
    if (f && !/^image\/(jpeg|png|webp)$/.test(f.type)) { toast.error('Use a JPG, PNG or WebP image'); return; }
    if (f && f.size > 5 * 1024 * 1024) { toast.error('That image is over 5 MB'); return; }
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
  };

  const close = () => { setAsking(null); setPassword(''); setError(null); };

  const confirmWithPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return setError('Enter the publishing password.');
    setBusy(true); setError(null);
    let uploaded: { path: string; url: string } | null = null;
    try {
      if (asking === 'publish' && file) uploaded = await api.uploadQr(method, file);
      const r = await api.publishQr(method, asking === 'publish' ? uploaded!.url : null, password);
      if (!r.ok) {
        if (uploaded) await api.removeQrFile(uploaded.path);
        setError(r.message ?? 'Could not publish.');
        return;
      }
      toast.success(asking === 'publish' ? `${label} published` : `${label} removed`,
        asking === 'publish' ? 'Customers see it at checkout now.' : 'It no longer shows at checkout.');
      pick(null);
      close();
      await Promise.all([onChanged(), reload()]);
    } catch (err) {
      if (uploaded) await api.removeQrFile(uploaded.path).catch(() => {});
      setError(errorMessage(err));
    } finally { setBusy(false); }
  };

  const shown = preview ?? current;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-ink-900">{label}</p>
        {preview ? <Badge tone="amber">Not published yet</Badge> : current ? <Badge tone="green">Live</Badge> : <Badge tone="neutral">None</Badge>}
      </div>
      <div className="grid aspect-square w-full max-w-56 place-items-center self-center overflow-hidden rounded-lg border border-dashed border-slate-300 bg-white">
        {shown ? <img src={shown} alt={`${label} preview`} className="size-full object-contain p-2" /> : <span className="px-4 text-center text-xs text-slate-500">No QR code yet</span>}
      </div>
      <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50">
        <ImageUp className="size-4" aria-hidden /> {current || preview ? 'Choose a different image' : 'Choose QR image'}
        <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { pick(e.target.files?.[0] ?? null); e.target.value = ''; }} />
      </label>
      <div className="flex flex-wrap gap-2">
        {file && <Button size="sm" onClick={() => setAsking('publish')}><Lock /> Publish</Button>}
        {file && <Button size="sm" variant="ghost" onClick={() => pick(null)}>Discard</Button>}
        {!file && current && <Button size="sm" variant="danger-outline" onClick={() => setAsking('remove')}><Trash2 /> Remove</Button>}
      </div>

      <Dialog open={!!asking} onClose={close} size="sm" title={asking === 'publish' ? `Publish ${label}` : `Remove ${label}`}
        description="Enter the publishing password to continue.">
        <form onSubmit={confirmWithPassword} className="space-y-3" autoComplete="off">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Publishing password">
            <Input type="password" autoComplete="off" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" loading={busy} variant={asking === 'remove' ? 'danger' : 'primary'}>{asking === 'publish' ? 'Publish' : 'Remove'}</Button>
            <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
