// Typed wrappers around the database API. Every mutation that matters goes
// through a server-side SECURITY DEFINER function which re-validates it.
import { supabase } from './supabase';
import { groupBookings, type BookingGroup } from './bookingGroups';
import { toAppError, unwrap } from './errors';
import { prepareReceipt } from './image';
import type {
  AppRole, AuditLog, AvailabilitySlot, BlockedSlot, Booking, BookingOption, BookingResult, BookingStatus, ConflictResult, Court, CustomerRow, FacilitySettings, Hold, NotificationRow, OperatingHours, Overview, Payment, PaymentMethod, PaymentStatus, PricingRule, Profile, Quote, Report, SpecialHours, UserNotification,
} from './types';

/** Fired when the server rejects the session (expired / revoked JWT). */
export const SESSION_EXPIRED_EVENT = 'nthplay:session-expired';

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return unwrap(await supabase.rpc(fn, args)) as T;
  } catch (e) {
    const err = toAppError(e);
    if (err.code === 'SESSION_EXPIRED' && typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    throw err;
  }
}

const num = (v: unknown) => (v == null ? v : Number(v));

// ---------------------------------------------------------------- public ----
export const api = {
  async settings(): Promise<FacilitySettings> {
    const data = unwrap(await supabase.from('facility_settings').select(
      'id, facility_name, tagline, description, timezone, currency, slot_minutes, booking_interval_minutes, min_duration_minutes, max_duration_minutes, buffer_minutes, min_advance_minutes, max_advance_days, same_day_cutoff, cancellation_deadline_hours, reschedule_deadline_hours, hold_minutes, booking_confirmation_mode, payment_due_hours, allow_cross_midnight, reminder_hours_before, contact_email, contact_phone, address, map_url, amenities, payment_methods, push_public_key, updated_at',
    ).eq('id', 1).single());
    return data as unknown as FacilitySettings;
  },

  async courts(includeInactive = false): Promise<Court[]> {
    let q = supabase.from('courts').select('*').order('sort_order').order('name');
    if (!includeInactive) q = q.eq('is_active', true);
    return (unwrap(await q) as Court[]).map((c) => ({ ...c, base_hourly_rate: Number(c.base_hourly_rate) }));
  },

  async court(id: string): Promise<Court | null> {
    const data = unwrap(await supabase.from('courts').select('*').eq('id', id).maybeSingle()) as Court | null;
    return data && { ...data, base_hourly_rate: Number(data.base_hourly_rate) };
  },

  async pricingRules(courtId?: string): Promise<PricingRule[]> {
    let q = supabase.from('court_pricing').select('*').order('priority', { ascending: false }).order('start_time');
    if (courtId) q = q.or(`court_id.eq.${courtId},court_id.is.null`);
    return (unwrap(await q) as PricingRule[]).map((r) => ({ ...r, rate: Number(r.rate) }));
  },

  async operatingHours(): Promise<OperatingHours[]> {
    return unwrap(await supabase.from('operating_hours').select('*').order('day_of_week')) as OperatingHours[];
  },

  async specialHours(fromDate: string): Promise<SpecialHours[]> {
    return unwrap(await supabase.from('special_hours').select('*').gte('date', fromDate).order('date')) as SpecialHours[];
  },

  async availability(date: string, courtId?: string | null): Promise<AvailabilitySlot[]> {
    const rows = await rpc<AvailabilitySlot[]>('get_availability', { p_date: date, p_court: courtId ?? null });
    return rows.map((r) => ({ ...r, price: num(r.price) as number | null }));
  },

  async bookingOptions(courtId: string, start: string): Promise<BookingOption[]> {
    const rows = await rpc<BookingOption[]>('get_booking_options', { p_court: courtId, p_start: start });
    return rows.map((r) => ({ ...r, total: num(r.total) as number | null }));
  },

  quote: (courtId: string, start: string, duration: number) =>
    rpc<Quote>('get_quote', { p_court: courtId, p_start: start, p_duration: duration }),

  // ------------------------------------------------------------- customer --
  createHold: (courtId: string, start: string, duration: number) =>
    rpc<Hold>('create_hold', { p_court: courtId, p_start: start, p_duration: duration }),

  /** Holds several separate blocks at once (all or nothing). */
  createHolds: (items: { courtId: string; start: string; duration: number }[]) =>
    rpc<Hold[]>('create_holds', { p_items: items.map((i) => ({ court: i.courtId, start: i.start, duration: i.duration })) }),

  releaseHold: (holdId: string) => rpc<void>('release_hold', { p_hold: holdId }),

  myHold: (holdId: string) => rpc<Hold | null>('get_my_hold', { p_hold: holdId }),

  confirmBooking: (args: {
    holdId: string; name: string; email: string; phone: string; players?: number | null; notes?: string | null;
    paymentMethod: PaymentMethod; acceptTerms: boolean;
  }) => rpc<BookingResult>('confirm_booking', {
    p_hold: args.holdId, p_name: args.name, p_email: args.email, p_phone: args.phone,
    p_players: args.players ?? null, p_notes: args.notes ?? null,
    p_payment_method: args.paymentMethod, p_accept_terms: args.acceptTerms,
  }),

  /** Confirms several holds with the same details (all or nothing). */
  confirmBookings: (args: {
    holdIds: string[]; name: string; email: string; phone: string; players?: number | null; notes?: string | null;
    paymentMethod: PaymentMethod; acceptTerms: boolean;
  }) => rpc<BookingResult[]>('confirm_bookings', {
    p_holds: args.holdIds, p_name: args.name, p_email: args.email, p_phone: args.phone,
    p_players: args.players ?? null, p_notes: args.notes ?? null,
    p_payment_method: args.paymentMethod, p_accept_terms: args.acceptTerms,
  }),

  cancelBooking: (bookingId: string, reason?: string) =>
    rpc<BookingResult>('cancel_booking', { p_booking: bookingId, p_reason: reason ?? null }),

  rescheduleBooking: (bookingId: string, start: string, duration?: number) =>
    rpc<BookingResult>('reschedule_booking', { p_booking: bookingId, p_new_start: start, p_new_duration: duration ?? null }),

  submitPayment: (bookingId: string, method: PaymentMethod, reference: string, amount?: number | null, proofPath?: string | null) =>
    rpc<Payment>('submit_payment', { p_booking: bookingId, p_method: method, p_reference: reference, p_amount: amount ?? null, p_proof_path: proofPath ?? null }),

  async uploadProof(userId: string, file: File): Promise<string> {
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${userId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from('payment-proofs').upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw toAppError({ message: `Upload failed: ${error.message}` });
    return path;
  },

  /** Shrinks the receipt photo, uploads it to the private bucket and submits it for verification. */
  /**
   * One receipt for several bookings booked together: the image is uploaded once
   * and recorded against each booking for its own amount. Returns the first error.
   */
  async submitReceiptForMany(targets: { bookingId: string; amount: number }[], userId: string, file: File, method: PaymentMethod): Promise<unknown | null> {
    const path = await api.uploadProof(userId, await prepareReceipt(file));
    let firstError: unknown | null = null;
    for (const t of targets) {
      try { await api.submitPayment(t.bookingId, method, '', t.amount, path); }
      catch (e) { firstError ??= e; }
    }
    return firstError;
  },

  async submitReceipt(bookingId: string, userId: string, file: File, method: PaymentMethod = 'gcash', amount?: number | null): Promise<Payment> {
    const path = await api.uploadProof(userId, await prepareReceipt(file));
    return api.submitPayment(bookingId, method, '', amount ?? null, path);
  },

  // ------------------------------------------------ payment QR publishing --
  qrPasswordIsSet: () => rpc<boolean>('qr_password_is_set'),

  setQrPassword: (current: string | null, next: string) =>
    rpc<{ ok: boolean; code?: string; message?: string }>('set_qr_publish_password', { p_current: current, p_new: next }),

  /** Uploads a QR image to the public payment-qr bucket and returns its link. */
  async uploadQr(method: string, file: File): Promise<{ path: string; url: string }> {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${method}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('payment-qr').upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw toAppError({ message: error.message });
    return { path, url: supabase.storage.from('payment-qr').getPublicUrl(path).data.publicUrl };
  },

  async removeQrFile(path: string) {
    await supabase.storage.from('payment-qr').remove([path]);
  },

  publishQr: (method: 'gcash' | 'bank_transfer', url: string | null, password: string) =>
    rpc<{ ok: boolean; code?: string; message?: string }>('publish_payment_qr', { p_method: method, p_qr_url: url, p_password: password }),

  /** Admin: every business record (settings, courts, prices, hours, customers, bookings, payments, audit log) as one object. */
  exportBackup: () => rpc<Record<string, unknown>>('admin_export_backup'),

  async proofUrl(path: string): Promise<string> {
    const { data, error } = await supabase.storage.from('payment-proofs').createSignedUrl(path, 300);
    if (error || !data) throw toAppError({ message: 'Could not open the file.' });
    return data.signedUrl;
  },

  /** The customer's bookings, with blocks booked together combined into one entry. */
  async myBookings(opts: { upcoming: boolean; page: number; pageSize: number; userId: string }) {
    const nowIso = new Date().toISOString();
    let q = supabase.from('bookings').select('*, courts(name, court_type)').eq('customer_id', opts.userId);
    q = opts.upcoming
      ? q.gte('end_at', nowIso).in('booking_status', ['pending', 'confirmed']).order('start_at', { ascending: true })
      : q.or(`end_at.lt."${nowIso}",booking_status.not.in.(pending,confirmed)`).order('start_at', { ascending: false });
    const groups = groupBookings((unwrap(await q.limit(1000)) as Booking[]).map(normalizeBooking));
    const from = opts.page * opts.pageSize;
    return { rows: groups.slice(from, from + opts.pageSize), count: groups.length };
  },

  /** Every block of the booking with this reference (one block, or a group booked together). */
  async bookingGroup(reference: string): Promise<Booking[]> {
    const sel = '*, courts(name, court_type)';
    const own = unwrap(await supabase.from('bookings').select(sel).eq('booking_reference', reference).maybeSingle()) as Booking | null;
    const ref = own?.group_ref || reference;
    const rows = unwrap(await supabase.from('bookings').select(sel).or(`booking_reference.eq.${ref},group_ref.eq.${ref}`).order('start_at')) as Booking[];
    return rows.map(normalizeBooking);
  },

  async groupPayments(bookingIds: string[]): Promise<Payment[]> {
    if (!bookingIds.length) return [];
    const rows = unwrap(await supabase.from('payments').select('*').in('booking_id', bookingIds).order('created_at', { ascending: false })) as Payment[];
    return rows.map(normalizePayment);
  },

  async bookingByReference(reference: string): Promise<Booking | null> {
    const data = unwrap(await supabase.from('bookings').select('*, courts(name, court_type)').eq('booking_reference', reference).maybeSingle()) as Booking | null;
    return data && normalizeBooking(data);
  },

  async bookingPayments(bookingId: string): Promise<Payment[]> {
    const rows = unwrap(await supabase.from('payments').select('*').eq('booking_id', bookingId).order('created_at', { ascending: false })) as Payment[];
    return rows.map(normalizePayment);
  },

  async myProfile(userId: string): Promise<Profile | null> {
    return unwrap(await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()) as Profile | null;
  },

  async updateMyProfile(userId: string, patch: { full_name: string; mobile_number: string | null }) {
    unwrap(await supabase.from('profiles').update(patch).eq('id', userId).select('id').single());
  },

  // ---------------------------------------------------------------- staff --
  overview: (date?: string) => rpc<Overview>('admin_overview', { p_date: date ?? null }),

  report: (from: string, to: string, courtId?: string | null, status?: BookingStatus | null) =>
    rpc<Report>('admin_report', { p_from: from, p_to: to, p_court: courtId ?? null, p_status: status ?? null }),

  async bookingsBetween(fromIso: string, toIso: string, opts: { courtId?: string | null; statuses?: BookingStatus[] } = {}) {
    let q = supabase.from('bookings').select('*, courts(name, court_type)').lt('start_at', toIso).gt('end_at', fromIso).order('start_at');
    if (opts.courtId) q = q.eq('court_id', opts.courtId);
    if (opts.statuses?.length) q = q.in('booking_status', opts.statuses);
    return (unwrap(await q.limit(2000)) as Booking[]).map(normalizeBooking);
  },

  async searchBookings(opts: {
    search?: string; fromIso?: string; toIso?: string; courtId?: string | null; status?: BookingStatus | '';
    paymentStatus?: PaymentStatus | ''; page: number; pageSize: number; sortAsc?: boolean;
  }) {
    let q = supabase.from('bookings').select('*, courts(name, court_type)', { count: 'exact' });
    const s = opts.search?.trim().replace(/[,()*%]/g, ' ').trim();
    if (s) q = q.or(`booking_reference.ilike.*${s}*,customer_name.ilike.*${s}*,customer_email.ilike.*${s}*,customer_phone.ilike.*${s}*`);
    if (opts.fromIso) q = q.gte('start_at', opts.fromIso);
    if (opts.toIso) q = q.lt('start_at', opts.toIso);
    if (opts.courtId) q = q.eq('court_id', opts.courtId);
    if (opts.status) q = q.eq('booking_status', opts.status);
    if (opts.paymentStatus) q = q.eq('payment_status', opts.paymentStatus);
    const from = opts.page * opts.pageSize;
    const res = await q.order('start_at', { ascending: !!opts.sortAsc }).range(from, from + opts.pageSize - 1);
    return { rows: (unwrap(res) as Booking[]).map(normalizeBooking), count: res.count ?? 0 };
  },

  /** searchBookings, with blocks booked together combined into one entry (siblings fetched even if filtered out of the page). */
  async searchBookingGroups(opts: {
    search?: string; fromIso?: string; toIso?: string; courtId?: string | null; status?: BookingStatus | '';
    paymentStatus?: PaymentStatus | ''; page: number; pageSize: number; sortAsc?: boolean;
  }): Promise<{ rows: BookingGroup[]; count: number }> {
    const { rows, count } = await api.searchBookings(opts);
    const refs = [...new Set(rows.map((b) => b.group_ref).filter((r): r is string => !!r))];
    let all = rows;
    if (refs.length) {
      const sibs = (unwrap(await supabase.from('bookings').select('*, courts(name, court_type)').in('group_ref', refs)) as Booking[]).map(normalizeBooking);
      const seen = new Set(rows.map((b) => b.id));
      all = [...rows, ...sibs.filter((b) => !seen.has(b.id))];
    }
    const groups = groupBookings(all);
    return { rows: groups, count: count - (all.length - groups.length) };
  },

  async bookingById(id: string): Promise<Booking | null> {
    const data = unwrap(await supabase.from('bookings').select('*, courts(name, court_type)').eq('id', id).maybeSingle()) as Booking | null;
    return data && normalizeBooking(data);
  },

  adminCreateBooking: (a: {
    courtId: string; start: string; duration: number; name: string; email?: string | null; phone?: string | null;
    customerId?: string | null; players?: number | null; notes?: string | null; paymentMethod: PaymentMethod; status: 'pending' | 'confirmed';
  }) => rpc<BookingResult>('admin_create_booking', {
    p_court: a.courtId, p_start: a.start, p_duration: a.duration, p_name: a.name, p_email: a.email || null,
    p_phone: a.phone || null, p_customer_id: a.customerId ?? null, p_players: a.players ?? null, p_notes: a.notes || null,
    p_payment_method: a.paymentMethod, p_status: a.status,
  }),

  adminUpdateDetails: (bookingId: string, d: { name: string; email: string | null; phone: string | null; players: number | null; notes: string | null }) =>
    rpc<BookingResult>('admin_update_booking_details', {
      p_booking: bookingId, p_name: d.name, p_email: d.email, p_phone: d.phone, p_players: d.players, p_notes: d.notes,
    }),

  setBookingStatus: (bookingId: string, status: BookingStatus) =>
    rpc<BookingResult>('set_booking_status', { p_booking: bookingId, p_status: status }),

  recordCash: (bookingId: string, amount?: number | null, note?: string | null) =>
    rpc<Payment>('record_cash_payment', { p_booking: bookingId, p_amount: amount ?? null, p_note: note ?? null }),

  reviewPayment: (paymentId: string, approve: boolean, note?: string | null) =>
    rpc<Payment>('review_payment', { p_payment: paymentId, p_approve: approve, p_note: note ?? null }),

  refundPayment: (paymentId: string, amount: number, note: string) =>
    rpc<Payment>('refund_payment', { p_payment: paymentId, p_amount: amount, p_note: note }),

  async payments(opts: { status?: string; page: number; pageSize: number }) {
    let q = supabase.from('payments')
      .select('*, bookings(booking_reference, group_ref, customer_name, customer_email, start_at, court_id, total_amount, booking_status)', { count: 'exact' });
    if (opts.status) q = q.eq('payment_status', opts.status);
    const from = opts.page * opts.pageSize;
    const res = await q.order('created_at', { ascending: opts.status === 'pending' }).range(from, from + opts.pageSize - 1);
    return { rows: (unwrap(res) as Payment[]).map(normalizePayment), count: res.count ?? 0 };
  },

  async blockedSlots(fromIso: string, toIso?: string): Promise<BlockedSlot[]> {
    let q = supabase.from('blocked_slots').select('*').gt('end_at', fromIso).order('start_at');
    if (toIso) q = q.lt('start_at', toIso);
    return unwrap(await q.limit(500)) as BlockedSlot[];
  },

  createBlock: (courtIds: string[], start: string, end: string, reason: string) =>
    rpc<{ blocked_slot_ids: string[] }>('create_blocked_slot', { p_court_ids: courtIds, p_start: start, p_end: end, p_reason: reason }),

  deleteBlock: (id: string) => rpc<void>('delete_blocked_slot', { p_block: id }),

  searchCustomers: (query: string, limit: number, offset: number) =>
    rpc<CustomerRow[]>('search_customers', { p_query: query || null, p_limit: limit, p_offset: offset }),

  async staffMembers(): Promise<Profile[]> {
    return unwrap(await supabase.from('profiles').select('*').in('role', ['staff', 'admin']).order('role').order('full_name')) as Profile[];
  },

  setUserRole: (userId: string, role: AppRole) => rpc<void>('set_user_role', { p_user: userId, p_role: role }),

  // ---------------------------------------------------------------- admin --
  adminSettings: () => rpc<FacilitySettings>('admin_get_settings'),

  async saveSettings(patch: Partial<FacilitySettings>) {
    const { id: _id, updated_at: _u, ...rest } = patch;
    unwrap(await supabase.from('facility_settings').update(rest).eq('id', 1).select('id').single());
  },

  async saveCourt(court: Partial<Court> & { id?: string }) {
    const { id, created_at: _c, updated_at: _u, is_active: _a, ...fields } = court;
    if (id) return unwrap(await supabase.from('courts').update(fields).eq('id', id).select('*').single()) as Court;
    return unwrap(await supabase.from('courts').insert({ ...fields, is_active: true }).select('*').single()) as Court;
  },

  async deleteCourt(id: string) {
    unwrap(await supabase.from('courts').delete().eq('id', id).select('id'));
  },

  setCourtActive: (courtId: string, active: boolean, acknowledge = false) =>
    rpc<ConflictResult>('set_court_active', { p_court: courtId, p_active: active, p_acknowledge: acknowledge }),

  async savePricingRule(rule: Partial<PricingRule> & { id?: string }) {
    const { id, ...fields } = rule;
    if (id) unwrap(await supabase.from('court_pricing').update(fields).eq('id', id).select('id').single());
    else unwrap(await supabase.from('court_pricing').insert(fields).select('id').single());
  },

  async deletePricingRule(id: string) {
    unwrap(await supabase.from('court_pricing').delete().eq('id', id).select('id'));
  },

  saveOperatingHours: (courtId: string | null, hours: { day_of_week: number; is_closed: boolean; opening_time: string | null; closing_time: string | null }[], acknowledge = false) =>
    rpc<ConflictResult>('save_operating_hours', { p_court: courtId, p_hours: hours, p_acknowledge: acknowledge }),

  clearCourtHours: (courtId: string) => rpc<void>('clear_court_hours', { p_court: courtId }),

  saveSpecialHours: (a: { courtId: string | null; date: string; isClosed: boolean; open: string | null; close: string | null; reason: string }, acknowledge = false) =>
    rpc<ConflictResult>('save_special_hours', {
      p_court: a.courtId, p_date: a.date, p_is_closed: a.isClosed, p_open: a.open, p_close: a.close, p_reason: a.reason, p_acknowledge: acknowledge,
    }),

  deleteSpecialHours: (id: string) => rpc<void>('delete_special_hours', { p_id: id }),

  async auditFor(entityType: string, entityId: string): Promise<AuditLog[]> {
    return unwrap(await supabase.from('audit_logs').select('*').eq('entity_type', entityType).eq('entity_id', entityId).order('created_at', { ascending: false }).limit(50)) as AuditLog[];
  },

  async recentAudit(page: number, pageSize: number) {
    const from = page * pageSize;
    // Deletions and cancellations are kept in the database but not listed.
    const res = await supabase.from('audit_logs').select('*', { count: 'exact' })
      .neq('action', 'delete').is('metadata->changes->>cancelled_at', null)
      .order('created_at', { ascending: false }).range(from, from + pageSize - 1);
    return { rows: unwrap(res) as AuditLog[], count: res.count ?? 0 };
  },

  async notifications(page: number, pageSize: number) {
    const from = page * pageSize;
    const res = await supabase.from('notifications')
      .select('id, recipient_email, booking_id, notification_type, delivery_status, attempts, last_error, provider_message_id, sent_at, created_at', { count: 'exact' })
      .order('created_at', { ascending: false }).range(from, from + pageSize - 1);
    return { rows: unwrap(res) as NotificationRow[], count: res.count ?? 0 };
  },

  // ------------------------------------------------ in-app notifications --
  async myNotifications(limit = 30): Promise<UserNotification[]> {
    return unwrap(await supabase.from('user_notifications').select('*').order('created_at', { ascending: false }).limit(limit)) as UserNotification[];
  },

  markNotificationsRead: (ids?: string[]) => rpc<void>('mark_notifications_read', { p_ids: ids ?? null }),

  savePushSubscription: (s: { endpoint: string; p256dh: string; auth: string }) =>
    rpc<void>('save_push_subscription', { p_endpoint: s.endpoint, p_p256dh: s.p256dh, p_auth: s.auth, p_user_agent: navigator.userAgent }),

  deletePushSubscription: (endpoint: string) => rpc<void>('delete_push_subscription', { p_endpoint: endpoint }),

  startPaymentReview: (paymentId: string) =>
    rpc<{ ok: boolean; code?: string; message?: string }>('start_payment_review', { p_payment: paymentId }),

  releasePaymentReview: (paymentId: string) => rpc<void>('release_payment_review', { p_payment: paymentId }),

  async profilesByIds(ids: string[]): Promise<Pick<Profile, 'id' | 'full_name' | 'email'>[]> {
    if (!ids.length) return [];
    return unwrap(await supabase.from('profiles').select('id, full_name, email').in('id', ids)) as Pick<Profile, 'id' | 'full_name' | 'email'>[];
  },
};

function normalizeBooking(b: Booking): Booking {
  return {
    ...b,
    total_amount: Number(b.total_amount),
    amount_paid: Number(b.amount_paid),
    hourly_rate_snapshot: Number(b.hourly_rate_snapshot),
  };
}

function normalizePayment(p: Payment): Payment {
  return { ...p, amount: Number(p.amount), refunded_amount: Number(p.refunded_amount) };
}
