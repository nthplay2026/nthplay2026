/** The facility's Facebook page ("Nth Play"). Customers message the page from there via Messenger. */
export const FACEBOOK_URL = 'https://www.facebook.com/NthPlayPickleballCourt';
export const FACEBOOK_NAME = 'Nth Play';

/** Instagram account. */
export const INSTAGRAM_HANDLE = '@nthplay';
export const INSTAGRAM_URL = 'https://www.instagram.com/nthplay/';

/** "0918 326 4597" → "+639183264597", so call/text links work from any phone. */
export function phoneHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('0')) return `+63${digits.slice(1)}`;
  return digits;
}
