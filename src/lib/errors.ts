// Maps database / network errors to clear, user-facing messages.
// Our SQL functions raise with HINT = a stable machine code (see migration 0200).

export interface AppError {
  code: string;
  message: string;
  detail?: unknown;
  retryable: boolean;
}

const FRIENDLY: Record<string, string> = {
  SLOT_TAKEN: 'Sorry — that time was just reserved by someone else. Please pick another slot.',
  HOLD_EXPIRED_SLOT_TAKEN: 'Your hold expired and someone else has since reserved this time. Please choose another slot.',
  AUTH_REQUIRED: 'Please sign in to continue.',
  SESSION_EXPIRED: 'Your session has expired. Please sign in again.',
  FORBIDDEN: "You don't have permission to do that.",
  NETWORK: "We couldn't reach the server. Check your connection and try again.",
  RATE_LIMITED: 'Too many attempts. Please wait a few minutes and try again.',
};


interface PgLikeError { message?: string; hint?: string | null; code?: string; details?: string | null; status?: number; name?: string }

export function toAppError(err: unknown): AppError {
  if (!err) return { code: 'UNKNOWN', message: 'Something went wrong.', retryable: true };
  if (typeof err === 'string') return { code: 'UNKNOWN', message: err, retryable: false };

  const e = err as PgLikeError;
  const msg = e.message ?? String(err);

  if (e.name === 'TypeError' && /fetch|network|load failed/i.test(msg)) {
    return { code: 'NETWORK', message: FRIENDLY.NETWORK, retryable: true };
  }
  // PostgREST: invalid/expired JWT
  if (e.code === 'PGRST301' || e.code === 'PGRST303' || (e.status === 401 && /jwt/i.test(msg))) {
    return { code: 'SESSION_EXPIRED', message: FRIENDLY.SESSION_EXPIRED, retryable: false };
  }
  // Our own coded errors
  if (e.hint && /^[A-Z_]+$/.test(e.hint)) {
    let detail: unknown = e.details;
    if (typeof e.details === 'string' && e.details.startsWith('[')) {
      try { detail = JSON.parse(e.details); } catch { /* keep string */ }
    }
    // Database messages for coded errors are already written for customers.
    return { code: e.hint, message: msg || FRIENDLY[e.hint] || 'Something went wrong.', detail, retryable: false };
  }
  if (e.code === '42501') return { code: 'FORBIDDEN', message: FRIENDLY.FORBIDDEN, retryable: false };
  if (e.code === '23505') return { code: 'DUPLICATE', message: 'That already exists.', retryable: false };
  if (e.code === '23503') return { code: 'IN_USE', message: 'This item is still referenced by other records (e.g. bookings) and cannot be removed.', retryable: false };
  if (e.code === '23P01') return { code: 'SLOT_TAKEN', message: FRIENDLY.SLOT_TAKEN, retryable: false };
  if (typeof e.status === 'number' && e.status >= 500) return { code: 'SERVER', message: 'The server had a problem. Please try again.', retryable: true };
  return { code: e.code ?? 'UNKNOWN', message: msg || 'Something went wrong.', retryable: true };
}

/** Throws a normalized error when a Supabase response carries one. */
export function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw toAppError(res.error);
  return res.data as T;
}

export function isAppError(e: unknown): e is AppError {
  return typeof e === 'object' && e !== null && 'code' in e && 'message' in e && 'retryable' in e;
}

export function errorMessage(e: unknown): string {
  return isAppError(e) ? e.message : toAppError(e).message;
}
