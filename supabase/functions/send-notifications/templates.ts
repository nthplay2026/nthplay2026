// Email templates for the notification outbox. Plain, accessible HTML + text.

export interface NotificationRow {
  id: string;
  notification_type: string;
  recipient_email: string;
  idempotency_key: string;
  payload: Record<string, unknown>;
  created_at: string;
  attempts: number;
}

export interface Email { subject: string; html: string; text: string }

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function money(amount: unknown, currency: unknown) {
  const n = Number(amount ?? 0);
  try {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: String(currency || 'PHP') }).format(n);
  } catch {
    return `${currency ?? ''} ${n.toFixed(2)}`;
  }
}

const label = (s: unknown) => { const t = String(s ?? '').replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };

const METHOD_WORDS: Record<string, string> = { gcash: 'GCash QR Code', bank_transfer: 'QRPh', cash: 'cash' };

interface Block { date: string; time: string }

/** Time blocks grouped by day: [['Sun, Nov 8, 2026', ['1:00 AM – 2:00 AM', …]], …] */
function byDay(blocks: Block[]): [string, string[]][] {
  const days: [string, string[]][] = [];
  for (const b of blocks) {
    const last = days[days.length - 1];
    if (last && last[0] === b.date) last[1].push(b.time); else days.push([b.date, [b.time]]);
  }
  return days;
}

export function render(n: NotificationRow, appUrl: string): Email {
  const p = n.payload as Record<string, string | number | null>;
  const facility = String(p.facility_name ?? "Nth Play");
  const ref = String(p.booking_reference ?? '');
  const link = appUrl ? `${appUrl.replace(/\/$/, '')}/my-bookings/${encodeURIComponent(ref)}` : '';
  const adminLink = appUrl ? `${appUrl.replace(/\/$/, '')}/admin/bookings?ref=${encodeURIComponent(ref)}` : '';
  // A booking with several time blocks lists them all in one email, grouped by day.
  const multi = Number(p.blocks_count ?? 1) > 1;
  const blocks = Array.isArray((n.payload as { blocks?: unknown }).blocks) ? (n.payload as { blocks: Block[] }).blocks : null;
  const days = blocks?.length ? byDay(blocks) : null;
  const whenText = days
    ? days.map(([d, times]) => [d, ...times.map((t) => `  ${t}`)].join('\n')).join('\n')
    : p.when_local ? String(p.when_local).split('; ').join('\n') : `${p.start_local} – ${p.end_local}`;
  const whenHtml = days
    ? days.map(([d, times]) => `<div style="margin-top:6px">${esc(d)}</div>${times.map((t) => `<div style="font-weight:500;color:#334155">${esc(t)}</div>`).join('')}`).join('')
    : esc(whenText).replace(/\n/g, '<br>');
  // The payload is captured a moment before the booking's payment status updates,
  // so a "payment verified" email always says Paid.
  const PAYMENT_WORDS: Record<string, string> = {
    unpaid: 'Not paid yet', pending: 'Pending review', partially_paid: 'Partly paid', paid: 'Paid',
    failed: 'Rejected', refunded: 'Refunded', partially_refunded: 'Partly refunded',
  };
  const paymentLabel = n.notification_type === 'payment_verified' ? 'Paid'
    : PAYMENT_WORDS[String(p.payment_status)] ?? label(p.payment_status);
  // [label, text version, html version]
  const details: [string, string, string][] = [
    ['Reference', ref, esc(ref)],
    ['Court', String(p.court_name ?? ''), esc(p.court_name)],
    [multi ? 'Time blocks' : 'When', whenText, whenHtml],
    ['Total', money(p.total_amount, p.currency), esc(money(p.total_amount, p.currency))],
    ['Payment', paymentLabel, esc(paymentLabel)],
  ];

  let subject = '';
  let intro = '';
  let extra = '';
  let cta = link;
  let to = 'customer';

  switch (n.notification_type) {
    case 'booking_confirmed':
      subject = `Booking confirmed · ${ref}`;
      intro = multi
        ? `Hi ${p.customer_name}, all ${p.blocks_count} of your time blocks are booked. See you on the court!`
        : `Hi ${p.customer_name}, your court is booked. See you on the court!`;
      break;
    case 'booking_received':
      subject = `Booking received · ${ref} (payment needed)`;
      intro = `Hi ${p.customer_name}, we've reserved your court. Please complete payment${p.payment_due_local ? ` by ${p.payment_due_local}` : ''} to confirm it.`;
      break;
    case 'booking_cancelled':
      subject = `Booking cancelled · ${ref}`;
      intro = `Hi ${p.customer_name}, your booking has been cancelled.`;
      if (p.cancellation_reason) extra = `Reason: ${p.cancellation_reason}`;
      break;
    case 'booking_expired':
      subject = `Booking expired · ${ref}`;
      intro = `Hi ${p.customer_name}, we didn't receive payment in time, so this reservation was released.`;
      break;
    case 'booking_rescheduled':
      subject = `Booking rescheduled · ${ref}`;
      intro = `Hi ${p.customer_name}, your booking has moved${p.previous_start_local ? ` from ${p.previous_start_local}` : ''} to the time below.`;
      break;
    case 'booking_reminder':
      subject = `Reminder: you're playing ${p.start_local}`;
      intro = `Hi ${p.customer_name}, this is a friendly reminder about your upcoming session.`;
      break;
    case 'payment_verified':
      subject = `Payment received · ${ref}`;
      intro = `Hi ${p.customer_name}, we've verified your payment of ${money(p.payment_amount, p.currency)}. Thank you!`;
      break;
    case 'payment_rejected':
      subject = `Payment could not be verified · ${ref}`;
      intro = `Hi ${p.customer_name}, we couldn't verify your payment of ${money(p.payment_amount, p.currency)}.`;
      if (p.review_note) extra = `Note from the facility: ${p.review_note}`;
      break;
    case 'admin_new_booking':
      to = 'admin';
      subject = `New booking · ${p.court_name} · ${p.start_local}`;
      intro = `${p.customer_name} booked ${p.court_name}.`;
      cta = adminLink;
      break;
    case 'admin_payment_submitted':
      to = 'admin';
      subject = `Payment to verify · ${ref}`;
      intro = `${p.customer_name} uploaded a ${METHOD_WORDS[String(p.payment_method)] ?? label(p.payment_method)} receipt for ${money(p.payment_amount, p.currency)}${
        p.transaction_reference ? ` (reference ${p.transaction_reference})` : ''}. Verify it to confirm the booking.`;
      cta = adminLink;
      break;
    default:
      subject = `Update on booking ${ref}`;
      intro = `There's an update on your booking.`;
  }

  const contact = [p.facility_phone, p.facility_email].filter(Boolean).join(' · ');
  // Label above value: reads well on narrow phone screens.
  const rows = details.map(([k, , h]) =>
    `<tr><td style="padding:10px 0;border-top:1px solid #e2e8f0"><div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.04em">${esc(k)}</div><div style="margin-top:2px;font-size:15px;line-height:1.5;font-weight:600;color:#0f172a">${h}</div></td></tr>`).join('');
  const html = `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 10px">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;padding:24px;border:1px solid #e2e8f0">
<tr><td style="font-size:14px;font-weight:700;color:#15803d;letter-spacing:.04em;text-transform:uppercase">${esc(facility)}</td></tr>
<tr><td style="padding-top:12px;font-size:20px;line-height:1.3;font-weight:700;color:#0f172a">${esc(subject.split(' · ')[0])}</td></tr>
<tr><td style="padding-top:12px;font-size:15px;line-height:1.6;color:#334155">${esc(intro)}</td></tr>
${extra ? `<tr><td style="padding-top:8px;font-size:15px;line-height:1.6;color:#334155">${esc(extra)}</td></tr>` : ''}
<tr><td style="padding-top:16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>
${cta ? `<tr><td style="padding-top:24px"><a href="${esc(cta)}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">${to === 'admin' ? 'Open in admin' : 'View booking'}</a></td></tr>` : ''}
${contact ? `<tr><td style="padding-top:28px;font-size:13px;color:#64748b">${esc(facility)} · ${esc(contact)}</td></tr>` : ''}
</table></td></tr></table></body></html>`;
  const text = [subject, '', intro, extra, '', ...details.map(([k, v]) => (v.includes('\n') ? `${k}:\n${v}` : `${k}: ${v}`)), '', cta ? `${to === 'admin' ? 'Open in admin' : 'View booking'}: ${cta}` : '', contact ? `${facility} · ${contact}` : '']
    .filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
  return { subject, html, text };
}
