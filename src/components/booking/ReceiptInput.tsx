import { useEffect, useId, useState } from 'react';
import { ImagePlus, RefreshCw, X } from 'lucide-react';
import { MAX_RECEIPT_BYTES } from '@/lib/image';
import { cn } from '@/lib/utils';

/**
 * Pick a photo or screenshot of the payment receipt (camera or gallery),
 * with a preview. The parent uploads it when the form is submitted.
 */
export function ReceiptInput({ value, onChange, error, label = 'Photo of your payment receipt' }: {
  value: File | null; onChange: (f: File | null) => void; error?: string | null; label?: string;
}) {
  const id = useId();
  const [preview, setPreview] = useState<string | null>(null);
  const [tooBig, setTooBig] = useState(false);

  useEffect(() => {
    if (!value || !value.type.startsWith('image/')) { setPreview(null); return; }
    const url = URL.createObjectURL(value);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  const pick = (f: File | null) => {
    setTooBig(!!f && f.size > MAX_RECEIPT_BYTES * 3); // photos are shrunk before upload; reject only absurd sizes
    onChange(f && f.size <= MAX_RECEIPT_BYTES * 3 ? f : null);
  };

  const message = tooBig ? 'That file is too large. Please choose a screenshot or a smaller photo.' : error;

  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-ink-800">{label}<span className="ml-0.5 text-red-600" aria-hidden>*</span></p>
      {value ? (
        <div className="flex items-center gap-4 rounded-xl border border-brand-200 bg-brand-50/50 p-3">
          {preview
            ? <img src={preview} alt="Selected receipt" className="h-24 w-20 shrink-0 rounded-lg border border-slate-200 bg-white object-cover" />
            : <span className="grid h-24 w-20 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-xs text-slate-500">File</span>}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink-900">{value.name}</p>
            <p className="text-xs text-slate-500">Ready to upload</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-800 hover:bg-slate-50">
                <RefreshCw className="size-3.5" aria-hidden /> Change
              </label>
              <button type="button" onClick={() => pick(null)} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">
                <X className="size-3.5" aria-hidden /> Remove
              </button>
            </div>
          </div>
        </div>
      ) : (
        <label htmlFor={id}
          className={cn('flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors hover:border-brand-500 hover:bg-brand-50/40',
            message ? 'border-red-400 bg-red-50/40' : 'border-slate-300 bg-white')}>
          <ImagePlus className="size-7 text-brand-700" aria-hidden />
          <span className="text-sm font-semibold text-ink-900">Upload receipt photo or screenshot</span>
          <span className="text-xs text-slate-500">Take a screenshot of the payment confirmation screen in your app, then choose it here.</span>
        </label>
      )}
      <input id={id} type="file" accept="image/*" className="sr-only" aria-invalid={message ? true : undefined}
        onChange={(e) => { pick(e.target.files?.[0] ?? null); e.target.value = ''; }} />
      {message && <p className="mt-1.5 text-sm text-red-600" role="alert">{message}</p>}
    </div>
  );
}
