// Sends one email through Gmail's SMTP server (port 465, TLS) with an App Password.
// Loaded only when GMAIL_USER and GMAIL_APP_PASSWORD are set.
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

export interface SmtpConfig { user: string; password: string; from: string }

export function gmailSender(cfg: SmtpConfig) {
  const client = new SMTPClient({
    connection: { hostname: 'smtp.gmail.com', port: 465, tls: true, auth: { username: cfg.user, password: cfg.password } },
  });
  return {
    async send(to: string, subject: string, html: string, text: string) {
      await client.send({ from: cfg.from, to, subject, content: text, html });
    },
    async close() {
      await client.close().catch(() => {});
    },
  };
}
