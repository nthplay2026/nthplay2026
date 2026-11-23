import { expect, test } from '@playwright/test';
import { facilityDate, login, register, slot, slotStart, sql, uniqueEmail } from './helpers';

test('customers cannot open the admin area', async ({ page }) => {
  await register(page, { email: uniqueEmail('nosy') });
  await page.goto('/admin');
  await expect(page.getByText('Staff only')).toBeVisible();
});

test('admin manages bookings: create, view live, cancel with reason, verify payment', async ({ page, browser }) => {
  // Bootstrap an administrator the documented way (SQL, not the UI).
  const adminEmail = uniqueEmail('admin');
  await register(page, { email: adminEmail, name: 'Ada Admin' });
  sql(`update public.profiles set role = 'admin' where email = '${adminEmail}'`);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByText("Today's bookings")).toBeVisible();

  // A customer books and submits a GCash payment.
  const cust = await browser.newContext();
  const cp = await cust.newPage();
  const custEmail = uniqueEmail('payer');
  await register(cp, { email: custEmail, name: 'Paying Pat' });
  const date = facilityDate(10);
  const start = slotStart(date, '08:00');
  await cp.goto(`/book?date=${date}`);
  await slot(cp, 'Court 2', start).click();
  await cp.getByRole('button', { name: /^Reserve \d/ }).click();
  await cp.getByLabel('GCash').check();
  await expect(cp.getByRole('img', { name: /GCash QR code/ })).toBeVisible();
  await cp.locator('input[type="file"]').setInputFiles('public/brand/logo.png'); // any image stands in for the receipt
  await expect(cp.getByAltText('Selected receipt')).toBeVisible();
  await cp.getByLabel(/I agree to the/).check();
  await cp.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(cp).toHaveURL(/confirmed/);
  await expect(cp.getByText('GCash receipt received for verification')).toBeVisible();
  const ref = await cp.getByTestId('booking-reference').innerText();
  await cp.getByRole('link', { name: 'View booking' }).click();

  // Admin sees it in the live schedule and verifies the payment.
  await page.goto(`/admin/schedule?date=${date}`);
  await page.getByTestId('schedule-booking').filter({ hasText: 'Paying Pat' }).click();
  const panel = page.getByRole('dialog');
  await expect(panel.getByText(ref)).toBeVisible();
  await panel.getByRole('button', { name: 'Verify' }).click();
  await expect(panel.getByText('Verified')).toBeVisible();
  // The customer's page updates live.
  await expect(cp.getByText('Paid', { exact: true })).toBeVisible({ timeout: 8_000 });

  // Admin cancels with a reason; the reason is required and audited.
  await panel.getByRole('button', { name: 'Cancel booking' }).click();
  await panel.getByLabel(/Reason/).fill('Court resurfacing');
  await panel.getByRole('button', { name: 'Cancel booking' }).last().click();
  await expect(panel.getByText('Cancelled').first()).toBeVisible();
  expect(sql(`select booking_status || '|' || cancellation_reason from bookings where booking_reference = '${ref}'`)).toBe('cancelled|Court resurfacing');
  expect(Number(sql(`select count(*) from audit_logs where entity_type = 'bookings' and metadata -> 'changes' ? 'booking_status' and entity_id = (select id::text from bookings where booking_reference = '${ref}')`))).toBeGreaterThan(0);

  // Walk-in booking through the admin dialog uses the same conflict check.
  await page.goto(`/admin/schedule?date=${date}`);
  await page.getByRole('button', { name: 'New booking' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Date').fill(date);
  await dlg.getByLabel('Start time').selectOption({ index: 1 });
  await dlg.getByLabel('Name', { exact: true }).fill('Walk In Wendy');
  await dlg.getByRole('button', { name: /Create booking/ }).click();
  await expect(page.getByTestId('schedule-booking').filter({ hasText: 'Walk In Wendy' })).toBeVisible();
  await cust.close();
});

test('admin blocks time; customers immediately see it as unavailable', async ({ page, browser }) => {
  const adminEmail = uniqueEmail('admin2');
  await register(page, { email: adminEmail });
  sql(`update public.profiles set role = 'admin' where email = '${adminEmail}'`);
  const date = facilityDate(11);
  const viewer = await browser.newContext();
  const vp = await viewer.newPage();
  await vp.goto(`/book?date=${date}`);
  const start = slotStart(date, '14:00');
  await expect(slot(vp, 'Court 1', start)).toHaveAttribute('data-slot-status', 'available');

  await login(page, adminEmail, '/admin/blocks');
  await page.getByText('Court 1', { exact: true }).click();
  await page.getByLabel('From').fill(`${date}T14:00`);
  await page.getByLabel('Until').fill(`${date}T16:00`);
  await page.getByLabel('Reason').fill('Net repair');
  await page.getByRole('button', { name: 'Block time' }).click();
  await expect(page.getByText(/Net repair/)).toBeVisible();

  await expect(slot(vp, 'Court 1', start)).toHaveAttribute('data-slot-status', 'blocked', { timeout: 5_000 });
  await viewer.close();
});
