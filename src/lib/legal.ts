// Default Terms & Privacy text (used until an admin edits them in Settings > Legal pages).
// Light formatting: "## Heading", "- bullet", blank line = new paragraph.
import type { FacilitySettings } from './types';
import { formatDuration } from './time';

export function defaultTermsText(s: FacilitySettings | null | undefined): string {
  const name = s?.facility_name ?? 'the facility';
  const payFirst = s?.booking_confirmation_mode === 'after_payment';
  return [
    `These terms apply to every court reservation made with ${name}. By booking you agree to them.`,
    '',
    '## Reservations',
    `- Bookings can be made up to ${s?.max_advance_days ?? 30} days in advance.`,
    `- Sessions run from ${s ? formatDuration(s.min_duration_minutes) : '1 hour'} to ${s ? formatDuration(s.max_duration_minutes) : '3 hours'}.`,
    `- When you select a time we hold it for ${s?.hold_minutes ?? 10} minutes while you check out. Unconfirmed holds are released automatically.`,
    '- A booking is only valid once you receive a booking reference on screen and by email.',
    '',
    '## Payment',
    payFirst
      ? '- Reservations stay pending until our staff verify your payment. Please pay and upload your receipt during checkout; unpaid reservations are released.'
      : '- Reservations are confirmed immediately. Payment is due before your session starts.',
    '- QR code payments are marked paid only after our staff check your receipt against our records.',
    '- Prices shown at checkout are final for that booking; later price changes do not affect existing bookings.',
    '',
    '## Changes and cancellations',
    "- Bookings can't be cancelled or moved online. Payments aren't refunded for change of plans.",
    "- To reschedule, contact the facility. We'll move your booking to another available time, and the price is recalculated for the new time.",
    "- If we have to close the court (for example for safety, maintenance or weather), we'll offer you a new time or a full refund.",
    '',
    '## On court',
    '- Arriving 10 minutes before your scheduled booking is recommended to ensure you make the most of your time. Please note that late arrivals will not be given an extension beyond the booked end time.',
    '- Non-marking court shoes are required. Players use the facility at their own risk.',
  ].join('\n');
}

/** Starter party / event rules; admins replace them with the facility's own in Settings > Rules & policies. */
export function defaultPartyRulesText(s: FacilitySettings | null | undefined): string {
  const name = s?.facility_name ?? 'the facility';
  return [
    `Planning a birthday, team event or get-together at ${name}? Here's how hosting works.`,
    '',
    '## Booking your party',
    '- Book the court time you need through this website. Your party is confirmed once our staff verify your payment.',
    '- Message us on Facebook or Instagram before booking to tell us the date, time and expected number of guests, so we can help you plan.',
    '- Setting up and cleaning up happen within your booked time, so book a little extra if you need it.',
    '',
    '## During the party',
    '- Only booked guests may use the court during your time slot.',
    '- Non-marking court shoes are required for everyone who plays.',
    '- Keep music at a reasonable volume and be considerate of other players and neighbours.',
    '- Decorations must not damage the court, net, walls or lights. No confetti, glitter or tape on the playing surface.',
    '- Food and drinks stay off the court surface.',
    '',
    '## After the party',
    '- Please leave the area clean and take your trash and decorations with you.',
    '- The host is responsible for any damage caused by their guests.',
    '- Late finishes are not extended past your booked end time.',
  ].join('\n');
}

export function defaultPrivacyText(s: FacilitySettings | null | undefined): string {
  return [
    `${s?.facility_name ?? 'We'} collect only what we need to run your bookings, in line with the Philippine Data Privacy Act of 2012.`,
    '',
    '## What we collect',
    '- Account details: name, email address, mobile number and a securely hashed password.',
    '- Booking details: court, date and time, notes, price and status.',
    '- Payment details you submit: method, amount and a photo of your receipt. We never collect or store card numbers. Receipt photos are deleted automatically 45 days after upload.',
    '',
    '## How we use it',
    '- To reserve courts, send confirmations, reminders and changes, and verify payments.',
    '- To keep an audit trail of changes to bookings and payments, and to prevent abuse.',
    '- To produce aggregated reports (for example, how busy the court is).',
    '',
    '## Who can see it',
    '- Only you and authorised facility staff can see your bookings. Other customers only see whether a time is free.',
    '- We use service providers for hosting (Supabase, Vercel) and email delivery (Resend); they process data on our behalf.',
    '',
    '## Your choices',
    '- You can update your name and mobile number in your account at any time.',
    `- To access or delete your data, contact us${s?.contact_email ? ` at ${s.contact_email}` : ' through our Facebook page'}. Booking and payment records may be kept as required for accounting.`,
  ].join('\n');
}
