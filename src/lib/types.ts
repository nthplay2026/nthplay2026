// Shapes returned by the database (see supabase/migrations).

export type AppRole = 'customer' | 'staff' | 'admin';
export type CourtType = 'indoor' | 'outdoor';
export type BookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show' | 'expired';
export type PaymentStatus = 'unpaid' | 'pending' | 'partially_paid' | 'paid' | 'failed' | 'refunded' | 'partially_refunded';
export type PaymentTxnStatus = 'pending' | 'paid' | 'failed' | 'refunded';
export type PaymentMethod = 'cash' | 'bank_transfer' | 'gcash' | 'gateway';
export type SlotStatus =
  | 'available' | 'held' | 'held_by_you' | 'pending' | 'booked' | 'blocked' | 'unavailable' | 'closed' | 'past';

export interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  mobile_number: string | null;
  role: AppRole;
  created_at: string;
  updated_at: string;
}

export interface PaymentMethodConfig {
  method: PaymentMethod;
  enabled: boolean;
  label: string;
  instructions: string;
  /** Optional QR code image customers scan to pay (link or site path such as /media/gcash-qr.jpg). */
  qr_url?: string;
  /** Optional account name / number shown under the QR code. */
  account_name?: string;
  account_number?: string;
}

export interface FacilitySettings {
  id: number;
  /** Public key browsers use to subscribe to push notifications. */
  push_public_key?: string | null;
  facility_name: string;
  tagline: string;
  description: string;
  timezone: string;
  currency: string;
  slot_minutes: number;
  booking_interval_minutes: number;
  min_duration_minutes: number;
  max_duration_minutes: number;
  buffer_minutes: number;
  min_advance_minutes: number;
  max_advance_days: number;
  same_day_cutoff: string | null;
  cancellation_deadline_hours: number;
  reschedule_deadline_hours: number;
  hold_minutes: number;
  booking_confirmation_mode: 'auto' | 'after_payment';
  payment_due_hours: number;
  allow_cross_midnight: boolean;
  reminder_hours_before: number;
  contact_email: string;
  contact_phone: string;
  address: string;
  map_url: string;
  amenities: string[];
  payment_methods: PaymentMethodConfig[];
  admin_alert_email?: string;
  updated_at: string;
}

export interface Court {
  id: string;
  name: string;
  description: string;
  court_type: CourtType;
  image_url: string | null;
  base_hourly_rate: number;
  is_active: boolean;
  allowed_durations: number[] | null;
  min_advance_minutes: number | null;
  max_advance_days: number | null;
  sort_order: number;
  features: string[];
  created_at: string;
  updated_at: string;
}

export interface PricingRule {
  id: string;
  court_id: string | null;
  label: string;
  days_of_week: number[] | null;
  start_time: string;
  end_time: string;
  rate: number;
  currency: string;
  effective_from: string | null;
  effective_to: string | null;
  priority: number;
  is_active: boolean;
}

export interface OperatingHours {
  id: string;
  court_id: string | null;
  day_of_week: number;
  opening_time: string | null;
  closing_time: string | null;
  is_closed: boolean;
}

export interface SpecialHours {
  id: string;
  court_id: string | null;
  date: string;
  is_closed: boolean;
  opening_time: string | null;
  closing_time: string | null;
  reason: string;
}

export interface AvailabilitySlot {
  court_id: string;
  slot_start: string | null;
  slot_end: string | null;
  status: SlotStatus;
  price: number | null;
  hold_expires_at: string | null;
}

export interface BookingOption {
  duration_minutes: number;
  end_at: string;
  total: number | null;
  available: boolean;
  reason: string | null;
}

export interface PriceLine { label: string; rate: number; minutes: number; amount: number }

export interface Quote {
  total: number;
  currency: string;
  minutes: number;
  hourly_rate: number;
  breakdown: PriceLine[];
  court_id: string;
  start_at: string;
  end_at: string;
  duration_minutes: number;
}

export interface Hold extends Quote {
  hold_id: string;
  court_name?: string;
  expires_at: string;
  status?: 'active' | 'converted' | 'released' | 'expired';
  booking_id?: string | null;
}

export interface Booking {
  id: string;
  booking_reference: string;
  /** Shared reference of the time blocks booked together (null for a single block). */
  group_ref?: string | null;
  customer_id: string | null;
  court_id: string;
  start_at: string;
  end_at: string;
  duration_minutes: number;
  booking_status: BookingStatus;
  payment_status: PaymentStatus;
  hourly_rate_snapshot: number;
  total_amount: number;
  amount_paid: number;
  currency: string;
  price_breakdown: PriceLine[];
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  players: number | null;
  notes: string | null;
  payment_method: PaymentMethod | null;
  payment_due_at: string | null;
  source: 'online' | 'admin';
  created_by: string | null;
  confirmed_at: string | null;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  rescheduled_count: number;
  created_at: string;
  updated_at: string;
  courts?: { name: string; court_type: CourtType } | null;
}

/** Compact booking returned by booking RPCs. */
export interface BookingResult {
  id: string;
  booking_reference: string;
  court_id: string;
  court_name: string;
  start_at: string;
  end_at: string;
  duration_minutes: number;
  booking_status: BookingStatus;
  payment_status: PaymentStatus;
  total_amount: number;
  amount_paid: number;
  currency: string;
  payment_method: PaymentMethod | null;
  payment_due_at: string | null;
  idempotent_replay?: boolean;
}

export interface Payment {
  id: string;
  booking_id: string;
  amount: number;
  refunded_amount: number;
  currency: string;
  payment_method: PaymentMethod;
  payment_status: PaymentTxnStatus;
  transaction_reference: string | null;
  proof_of_payment_path: string | null;
  /** Set when the receipt image was deleted (45 days after upload). */
  receipt_purged_at?: string | null;
  provider: string | null;
  provider_payment_id: string | null;
  submitted_by: string | null;
  verified_by: string | null;
  verified_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
  bookings?: Pick<Booking, 'booking_reference' | 'group_ref' | 'customer_name' | 'customer_email' | 'start_at' | 'court_id' | 'total_amount' | 'booking_status'> | null;
}

export interface BlockedSlot {
  id: string;
  court_id: string;
  start_at: string;
  end_at: string;
  reason: string;
  created_by: string | null;
  created_at: string;
}

export interface ConflictBooking {
  booking_id: string;
  booking_reference: string;
  court_name?: string;
  start_at: string;
  end_at: string;
  customer_name: string;
  booking_status?: BookingStatus;
}

export interface ConflictResult {
  status: 'saved' | 'conflicts';
  conflicts?: ConflictBooking[];
  kept_bookings?: ConflictBooking[];
}

export interface Overview {
  date: string;
  todays_bookings: number;
  upcoming_bookings: number;
  active_courts: number;
  courts_free_now: number;
  occupied_court_hours: number;
  open_court_hours: number;
  cancellations_today: number;
  pending_reservations: number;
  pending_payment_verifications: number;
  pending_payment_amount: number;
  revenue_today: number | null;
  revenue_month: number | null;
  booking_value_today: number;
  currency: string;
}

export interface Report {
  from: string;
  to: string;
  currency: string;
  totals: {
    bookings: number; confirmed: number; completed: number; pending: number; cancelled: number;
    no_show: number; expired: number; booking_value: number; paid_revenue: number; refunds: number;
    outstanding: number; paid_bookings: number; unpaid_bookings: number; booked_minutes: number;
    open_minutes: number; utilization_pct: number; cancellation_rate_pct: number;
  };
  by_day: { day: string; bookings: number; cancelled: number; booking_value: number; paid_revenue: number }[];
  by_court: { court_id: string; court_name: string; bookings: number; booked_minutes: number; booking_value: number }[];
  by_hour: { hour: number; bookings: number }[];
  by_weekday: { dow: number; bookings: number }[];
}

export interface CustomerRow {
  id: string;
  full_name: string | null;
  email: string | null;
  mobile_number: string | null;
  role: AppRole;
  created_at: string;
  total_bookings: number;
  upcoming_bookings: number;
  last_booking_at: string | null;
  total_count: number;
}

export interface NotificationRow {
  id: string;
  recipient_email: string | null;
  booking_id: string | null;
  notification_type: string;
  delivery_status: 'queued' | 'sending' | 'sent' | 'failed' | 'skipped';
  attempts: number;
  last_error: string | null;
  provider_message_id: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface AuditLog {
  id: number;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface UserNotification {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  booking_id: string | null;
  read_at: string | null;
  created_at: string;
}
