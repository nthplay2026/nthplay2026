// Generates a local JWT secret plus anon / service_role API keys (HS256),
// the same shape Supabase issues. Writes scripts/e2e/.keys.json (git-ignored).
import { createHmac, randomBytes } from 'node:crypto';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';

const file = new URL('./.keys.json', import.meta.url);
if (existsSync(file)) { process.stdout.write(readFileSync(file, 'utf8')); process.exit(0); }

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const secret = randomBytes(32).toString('hex');
const sign = (payload) => {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(payload);
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
};
const iat = Math.floor(Date.now() / 1000);
const keys = {
  jwtSecret: secret,
  anonKey: sign({ iss: 'supabase-local', role: 'anon', iat, exp: iat + 10 * 365 * 86400 }),
  serviceKey: sign({ iss: 'supabase-local', role: 'service_role', iat, exp: iat + 10 * 365 * 86400 }),
};
writeFileSync(file, JSON.stringify(keys, null, 2));
process.stdout.write(JSON.stringify(keys, null, 2));
