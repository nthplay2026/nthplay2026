import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ImagePlus, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import type { Court, CourtPhoto } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { CourtGallery } from '@/components/booking/CourtGallery';

const MAX_PHOTOS = 12;

/**
 * Admin: upload, order, replace and remove a court's photos. Every change is saved
 * immediately; replaced or removed files are deleted from storage right away.
 */
export function CourtPhotosDialog({ court, open, onClose, onChanged }: {
  court: Court; open: boolean; onClose: () => void; onChanged: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [photos, setPhotos] = useState<CourtPhoto[]>(court.photos ?? []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const addInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replaceIndex = useRef<number>(-1);

  const save = async (next: CourtPhoto[], uploaded: CourtPhoto[] = []) => {
    try {
      await api.setCourtPhotos(court.id, next);
      setPhotos(next);
      await onChanged();
      return true;
    } catch (e) {
      await api.discardCourtPhotoFiles(uploaded.map((p) => p.path));
      setError(errorMessage(e));
      return false;
    }
  };

  const add = async (files: File[]) => {
    if (!files.length) return;
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) { setError(`A court can have up to ${MAX_PHOTOS} photos. Remove one first.`); return; }
    const take = files.slice(0, room);
    setError(null);
    const uploaded: CourtPhoto[] = [];
    try {
      for (let i = 0; i < take.length; i++) {
        setBusy(take.length > 1 ? `Uploading ${i + 1} of ${take.length}…` : 'Uploading…');
        uploaded.push(await api.uploadCourtPhoto(court.id, take[i]));
      }
      setBusy('Saving…');
      if (await save([...photos, ...uploaded], uploaded)) {
        toast.success(uploaded.length > 1 ? `${uploaded.length} photos added` : 'Photo added', 'They show on the website now.');
        if (files.length > take.length) setError(`Only ${take.length} added: a court can have up to ${MAX_PHOTOS} photos.`);
      }
    } catch (e) {
      await api.discardCourtPhotoFiles(uploaded.map((p) => p.path));
      setError(errorMessage(e));
    } finally { setBusy(null); }
  };

  const replace = async (index: number, file: File | undefined) => {
    if (!file || index < 0) return;
    setError(null);
    setBusy('Replacing…');
    let uploaded: CourtPhoto | null = null;
    try {
      uploaded = await api.uploadCourtPhoto(court.id, file);
      const next = photos.map((p, i) => (i === index ? uploaded! : p));
      if (await save(next, [uploaded])) toast.success('Photo replaced', 'The old photo was deleted.');
    } catch (e) {
      if (uploaded) await api.discardCourtPhotoFiles([uploaded.path]);
      setError(errorMessage(e));
    } finally { setBusy(null); }
  };

  const remove = async (index: number) => {
    if (!window.confirm('Delete this photo? It will be removed from the website and from storage.')) return;
    setError(null);
    setBusy('Deleting…');
    try {
      if (await save(photos.filter((_, i) => i !== index))) toast.success('Photo deleted');
    } finally { setBusy(null); }
  };

  const move = async (index: number, by: -1 | 1) => {
    const to = index + by;
    if (to < 0 || to >= photos.length) return;
    const next = [...photos];
    [next[index], next[to]] = [next[to], next[index]];
    setError(null);
    setBusy('Saving order…');
    try { await save(next); } finally { setBusy(null); }
  };

  const layoutHint = photos.length === 0 ? 'No photos: nothing is shown on the website.'
    : photos.length === 1 ? 'Shown as one wide photo.'
    : photos.length <= 4 ? `Shown as a collage of ${photos.length}.`
    : `Shown as a swipeable slideshow of ${photos.length}.`;

  return (
    <Dialog open={open} onClose={onClose} size="lg" title={`${court.name} photos`}
      description="Photos appear on the home page and the court page. The first photo is shown first."
      footer={<Button variant="outline" onClick={onClose}>Done</Button>}>
      <div className="space-y-5">
        {error && <Alert tone="error">{error}</Alert>}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">{photos.length} of {MAX_PHOTOS} photos · {layoutHint}</p>
          <Button onClick={() => addInput.current?.click()} loading={!!busy} disabled={photos.length >= MAX_PHOTOS}>
            <ImagePlus /> {busy ?? 'Add photos'}
          </Button>
          <input ref={addInput} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple className="sr-only"
            onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; void add(f); }} />
          <input ref={replaceInput} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" className="sr-only"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void replace(replaceIndex.current, f); }} />
        </div>

        {photos.length > 0 ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photos.map((p, i) => (
              <li key={p.path} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="relative aspect-[4/3] bg-slate-100">
                  <img src={p.url} alt={`Photo ${i + 1}`} className="size-full object-cover" loading="lazy" />
                  {i === 0 && <span className="absolute left-2 top-2 rounded-full bg-ink-900/80 px-2 py-0.5 text-[11px] font-semibold text-white">First</span>}
                </div>
                <div className="flex items-center justify-between gap-1 p-1.5">
                  <span className="flex">
                    <Button size="icon" variant="ghost" aria-label="Move earlier" disabled={!!busy || i === 0} onClick={() => void move(i, -1)}><ArrowLeft /></Button>
                    <Button size="icon" variant="ghost" aria-label="Move later" disabled={!!busy || i === photos.length - 1} onClick={() => void move(i, 1)}><ArrowRight /></Button>
                  </span>
                  <span className="flex">
                    <Button size="icon" variant="ghost" aria-label="Replace photo" title="Replace" disabled={!!busy}
                      onClick={() => { replaceIndex.current = i; replaceInput.current?.click(); }}><RefreshCw /></Button>
                    <Button size="icon" variant="ghost" aria-label="Delete photo" title="Delete" disabled={!!busy} onClick={() => void remove(i)}
                      className="text-red-700 hover:text-red-800"><Trash2 /></Button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <button type="button" onClick={() => addInput.current?.click()} disabled={!!busy}
            className="grid w-full place-items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-sm text-slate-600 hover:bg-slate-100">
            <ImagePlus className="size-6 text-slate-500" aria-hidden />
            Choose photos to upload (JPG, PNG or WebP). You can select several at once.
          </button>
        )}

        {photos.length > 0 && (
          <div className="space-y-2 border-t border-slate-100 pt-4">
            <p className="text-sm font-semibold text-ink-900">Preview on the website</p>
            <CourtGallery photos={photos} name={court.name} />
          </div>
        )}
        <p className="text-xs text-slate-500">
          Photos are resized before uploading to save storage. Replaced or deleted photos are removed from storage
          right away. Court photos are kept until you delete them; they aren't part of the 45-day receipt cleanup.
        </p>
      </div>
    </Dialog>
  );
}
