// Supabase Edge Function entry point (Deno). Logic lives in handler.ts.
// Deploy with --no-verify-jwt: the provider authenticates with its signature.
import { handle } from './handler.ts';

Deno.serve((req: Request) => handle(req, (k) => Deno.env.get(k)));
