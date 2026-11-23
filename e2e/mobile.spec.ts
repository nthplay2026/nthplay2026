import { expect, test } from '@playwright/test';
import { facilityDate, register, slot, slotStart, uniqueEmail } from './helpers';

test('booking works on a phone-sized screen without horizontal scrolling', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Book a Court' })).toBeVisible();

  await register(page, { email: uniqueEmail('mobile') });
  const date = facilityDate(12);
  await page.goto(`/book?date=${date}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await slot(page, 'Court 2', slotStart(date, '11:00')).click();
  await page.getByRole('button', { name: /^Reserve \d/ }).click();
  await page.getByLabel(/I agree to the/).check();
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(page.getByRole('heading', { name: "You're booked!" })).toBeVisible();
});
