// Supabase Edge Function entry point (Deno). Logic lives in handler.ts.
import { handle } from './handler.ts';

Deno.serve((req: Request) => handle(req, (k) => Deno.env.get(k)));
