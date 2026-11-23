// Minimal PostgREST client for Edge Functions (service role, server-side only).
// Uses fetch only, so the same code runs on Supabase Edge (Deno) and Node.

export type Env = (key: string) => string | undefined;

export class RpcError extends Error {
  code?: string;
  hint?: string;
  status?: number;
  constructor(message: string, code?: string, hint?: string, status?: number) {
    super(message);
    this.code = code;
    this.hint = hint;
    this.status = status;
  }
}

export function serviceRpc(env: Env) {
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  return async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) throw new RpcError(body?.message ?? `RPC ${fn} failed`, body?.code, body?.hint, res.status);
    return body as T;
  };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
