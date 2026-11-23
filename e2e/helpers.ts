import { execFileSync } from 'node:child_process';
import { expect, type Page } from '@playwright/test';

export const DB = process.env.E2E_DB ?? 'nthplay_e2e';

/** Direct SQL against the local test database (test setup only). */
export function sql(query: string): string {
  return execFileSync('psql', ['-X', '-q', '-t', '-A', '-h', process.env.PGHOST ?? 'localhost', '-p', process.env.PGPORT ?? '54322',
    '-U', process.env.PGUSER ?? 'postgres', '-d', DB, '-c', query], { encoding: 'utf8' }).trim();
}

export const uniqueEmail = (tag: string) => `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@example.com`;

/** A date N days ahead in the facility time zone (Asia/Manila), as YYYY-MM-DD. */
export function facilityDate(daysAhead: number): string {
  return sql(`select (public.local_today() + ${daysAhead})::text`);
}

export async function register(page: Page, opts: { email: string; name?: string; next?: string }) {
  await page.goto(`/register${opts.next ? `?next=${encodeURIComponent(opts.next)}` : ''}`);
  await page.getByLabel('Full name').fill(opts.name ?? 'Test Player');
  await page.getByLabel('Email').fill(opts.email);
  await page.getByLabel('Mobile number').fill('0917 123 4567');
  await page.getByLabel('Password', { exact: true }).fill('Passw0rd!x');
  await page.getByLabel('Confirm password').fill('Passw0rd!x');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('button', { name: /sign out/i }).first()).toBeAttached();
}

export async function login(page: Page, email: string, next = '/my-bookings') {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('Passw0rd!x');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

export function slot(page: Page, courtName: string, startIso: string) {
  return page.locator(`[data-court="${courtName}"][data-slot-start="${startIso}"]:visible`);
}

/** The ISO instant the database uses for a facility-local date + time. */
export function slotStart(date: string, time: string): string {
  return sql(`select to_json(('${date} ${time}'::timestamp at time zone public.facility_tz()))#>>'{}'`);
}
