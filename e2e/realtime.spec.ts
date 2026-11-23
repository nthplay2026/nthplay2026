import { expect, test, type Browser } from '@playwright/test';
import { facilityDate, register, slot, slotStart, uniqueEmail } from './helpers';

async function customer(browser: Browser, tag: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await register(page, { email: uniqueEmail(tag), name: `Player ${tag}` });
  return { ctx, page };
}

test('Customer B sees Customer A\'s booking instantly, without refreshing', async ({ browser }) => {
  const a = await customer(browser, 'A');
  const b = await customer(browser, 'B');
  const date = facilityDate(7);
  const start = slotStart(date, '18:00');
  const url = `/book?date=${date}`;

  // 1–2. Both customers open the page and see Court 1 at 6 PM available.
  await a.page.goto(url);
  await b.page.goto(url);
  await expect(b.page.getByTestId('live-indicator')).toHaveAttribute('data-status', 'live');
  await expect(slot(a.page, 'Court 1', start)).toHaveAttribute('data-slot-status', 'available');
  await expect(slot(b.page, 'Court 1', start)).toHaveAttribute('data-slot-status', 'available');

  // 3. A selects it and starts checkout (a hold) — B sees it as held immediately.
  await slot(a.page, 'Court 1', start).click();
  await a.page.getByRole('button', { name: /^Reserve \d/ }).click();
  await expect(a.page).toHaveURL(/\/checkout\//);
  await expect(slot(b.page, 'Court 1', start)).toHaveAttribute('data-slot-status', 'held', { timeout: 5_000 });
  await expect(slot(b.page, 'Court 1', start)).toBeDisabled();

  // A confirms — B sees it booked, still without a reload.
  await a.page.getByLabel(/I agree to the/).check();
  await a.page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(a.page).toHaveURL(/confirmed/);
  await expect(slot(b.page, 'Court 1', start)).toHaveAttribute('data-slot-status', 'booked', { timeout: 5_000 });

  await a.ctx.close();
  await b.ctx.close();
});

test('a selected slot taken by someone else is cleared with a clear message', async ({ browser }) => {
  const a = await customer(browser, 'C');
  const b = await customer(browser, 'D');
  const date = facilityDate(8);
  const start = slotStart(date, '19:00');
  await a.page.goto(`/book?date=${date}`);
  await b.page.goto(`/book?date=${date}`);

  // Both select the same slot.
  await slot(a.page, 'Court 2', start).click();
  await slot(b.page, 'Court 2', start).click();
  await expect(b.page.getByTestId('selection-hours')).toHaveText('1 hour');

  // A reserves first; B's selection is withdrawn live with an explanation.
  await a.page.getByRole('button', { name: /^Reserve \d/ }).click();
  await expect(a.page).toHaveURL(/\/checkout\//);
  await expect(b.page.getByText('That time is no longer available')).toBeVisible({ timeout: 5_000 });
  await expect(b.page.getByText('Tap the time slots you want')).toBeVisible();

  await a.ctx.close();
  await b.ctx.close();
});

test('simultaneous reserve clicks: the server lets exactly one through', async ({ browser }) => {
  const a = await customer(browser, 'E');
  const b = await customer(browser, 'F');
  const date = facilityDate(9);
  const start = slotStart(date, '20:00');
  await a.page.goto(`/book?date=${date}`);
  await b.page.goto(`/book?date=${date}`);
  await slot(a.page, 'Court 3', start).click();
  await slot(b.page, 'Court 3', start).click();

  // Fire both reservations at the same moment.
  await Promise.all([
    a.page.getByRole('button', { name: /^Reserve \d/ }).click(),
    b.page.getByRole('button', { name: /^Reserve \d/ }).click(),
  ]);
  await Promise.race([a.page.waitForURL(/checkout/, { timeout: 8_000 }).catch(() => {}), b.page.waitForURL(/checkout/, { timeout: 8_000 }).catch(() => {})]);
  await a.page.waitForTimeout(1500);
  const wins = [a.page.url(), b.page.url()].filter((u) => u.includes('/checkout/')).length;
  expect(wins).toBe(1);
  // The loser either got a clear server rejection or saw the slot vanish before clicking.
  const loser = a.page.url().includes('/checkout/') ? b.page : a.page;
  await expect(loser.getByText(/just reserved by someone else|no longer available|Just missed it/i).first()).toBeVisible();

  await a.ctx.close();
  await b.ctx.close();
});
