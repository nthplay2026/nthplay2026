import { useState, type ReactNode } from 'react';
import { MessageSquareText, Phone } from 'lucide-react';
import { FACEBOOK_URL, INSTAGRAM_HANDLE, INSTAGRAM_URL, phoneHref } from '@/lib/contact';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

export function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z" />
    </svg>
  );
}

export function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
      <circle cx="12" cy="12" r="4.25" />
      <circle cx="17.6" cy="6.4" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

const iconButton = cn(buttonVariants({ variant: 'outline', size: 'icon' }), 'size-11 rounded-xl');

/** Opens the facility's Facebook page, where customers can message it. */
export function FacebookButton() {
  return (
    <a href={FACEBOOK_URL} target="_blank" rel="noreferrer" className={cn(iconButton, 'text-[#0866ff] hover:text-[#0866ff]')}
      aria-label="Visit us on Facebook" title="Visit us on Facebook">
      <FacebookIcon className="size-5" />
    </a>
  );
}

/** Opens the facility's Instagram profile. */
export function InstagramButton() {
  return (
    <a href={INSTAGRAM_URL} target="_blank" rel="noreferrer" className={cn(iconButton, 'text-[#d62976] hover:text-[#d62976]')}
      aria-label={`Follow us on Instagram (${INSTAGRAM_HANDLE})`} title={`Instagram ${INSTAGRAM_HANDLE}`}>
      <InstagramIcon className="size-5" />
    </a>
  );
}

/** Asks whether to call or text the facility's number. Renders as an icon button unless given its own content. */
export function PhoneButton({ phone, className, children }: { phone: string; className?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const href = phoneHref(phone);
  return (
    <>
      <button type="button" className={children ? className : cn(iconButton, 'text-brand-700')} onClick={() => setOpen(true)}
        aria-label={`Call or text ${phone}`} title="Call or text us">
        {children ?? <Phone className="size-5" />}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} size="sm" title="Get in touch" description={<>How would you like to reach us at <span className="whitespace-nowrap font-medium">{phone}</span>?</>}>
        <div className="grid gap-2 sm:grid-cols-2">
          <a href={`tel:${href}`} className={buttonVariants({ size: 'lg' })} onClick={() => setOpen(false)}><Phone /> Call</a>
          <a href={`sms:${href}`} className={buttonVariants({ size: 'lg', variant: 'outline' })} onClick={() => setOpen(false)}><MessageSquareText /> Send a text</a>
        </div>
      </Dialog>
    </>
  );
}
