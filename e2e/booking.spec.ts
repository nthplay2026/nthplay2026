import { expect, test } from '@playwright/test';
import { facilityDate, register, slot, slotStart, sql, uniqueEmail } from './helpers';

test('home page primary CTA goes to the real booking interface', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your Court');
  await page.getByRole('link', { name: /book a court/i }).first().click();
  await expect(page).toHaveURL(/\/book/);
  await expect(page.getByRole('heading', { name: 'Book a court' })).toBeVisible();
  await expect(page.getByTestId('live-indicator')).toHaveAttribute('data-status', 'live');
});

test('guest can browse; booking requires login and restores the selection', async ({ page }) => {
  const date = facilityDate(3);
  const start = slotStart(date, '09:00');
  await page.goto(`/book?date=${date}`);
  await slot(page, 'Court 2', start).click();
  await expect(page.getByTestId('selection-hours')).toHaveText('1 hour');
  await expect(page.getByTestId('total')).toContainText('350.00');
  await page.getByRole('button', { name: /log in to reserve/i }).click();
  await expect(page).toHaveURL(/\/login\?next=/);
  // Sign up instead, then come back to the same selection.
  await page.getByRole('link', { name: 'Create an account' }).click();
  const email = uniqueEmail('guest');
  await page.getByLabel('Full name').fill('Guest Player');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mobile number').fill('09171234567');
  await page.getByLabel('Password', { exact: true }).fill('Passw0rd!x');
  await page.getByLabel('Confirm password').fill('Passw0rd!x');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/book\?/);
  await expect(page.getByRole('button', { name: /^Reserve \d/ })).toBeEnabled();
});

test('customer books an available court end-to-end and it persists', async ({ page }) => {
  const email = uniqueEmail('booker');
  await register(page, { email, name: 'Booker Bea' });
  const date = facilityDate(4);
  const start = slotStart(date, '17:00'); // price comes from the server
  await page.goto(`/book?date=${date}&court=11111111-1111-4111-8111-111111111111`);
  // Tap two consecutive slots: the summary shows 2 hours.
  await slot(page, 'Court 1', start).click();
  await slot(page, 'Court 1', slotStart(date, '18:00')).click();
  await expect(page.getByTestId('selection-hours')).toHaveText('2 hours');
  const shownTotal = await page.getByTestId('total').innerText();
  await page.getByRole('button', { name: /^Reserve \d/ }).click();

  await expect(page).toHaveURL(/\/checkout\//);
  await expect(page.getByRole('timer')).toContainText('held for you');
  await expect(page.getByLabel('Full name')).toHaveValue('Booker Bea');
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(page.getByText('Please agree to the booking and cancellation policy.')).toBeVisible();
  await page.getByLabel(/I agree to the/).check();
  await page.getByRole('button', { name: 'Confirm booking' }).click();

  await expect(page).toHaveURL(/\/booking\/PB-\d{8}-\d{4}\/confirmed/);
  await expect(page.getByRole('heading', { name: "You're booked!" })).toBeVisible();
  const ref = await page.getByTestId('booking-reference').innerText();
  await expect(page.getByTestId('total')).toHaveText(shownTotal);

  // Persisted in the database with the price snapshot and contact details.
  const row = sql(`select booking_status || '|' || total_amount || '|' || customer_email from bookings where booking_reference = '${ref}'`);
  expect(row).toBe(`confirmed|${shownTotal.replace(/[^\d.]/g, '')}|${email}`);

  await page.getByRole('link', { name: 'View booking' }).click();
  await expect(page.getByText(ref)).toBeVisible();
  await page.goto('/my-bookings');
  await expect(page.getByText(ref)).toBeVisible();
});

test('customers cannot cancel — only reschedule', async ({ page }) => {
  const email = uniqueEmail('rescheduler');
  await register(page, { email });
  const date = facilityDate(5);
  await page.goto(`/book?date=${date}`);
  await slot(page, 'Court 3', slotStart(date, '10:00')).click();
  await page.getByRole('button', { name: /^Reserve \d/ }).click();
  await page.getByLabel(/I agree to the/).check();
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(page).toHaveURL(/confirmed/);
  await page.getByRole('link', { name: 'View booking' }).click();
  await expect(page.getByRole('button', { name: /cancel booking/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reschedule' })).toBeEnabled();
  await expect(page.getByText("Bookings can't be cancelled")).toBeVisible();
});

test('times are shown in the facility time zone regardless of the browser zone', async ({ page }) => {
  // The browser runs in America/Los_Angeles (see config); the first slot must still read 6 AM Manila time.
  const date = facilityDate(6);
  await page.goto(`/book?date=${date}&court=22222222-2222-4222-8222-222222222222`);
  await expect(slot(page, 'Court 2', slotStart(date, '06:00'))).toContainText('6 AM');
});
