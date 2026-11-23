/**
 * The facility's Facebook page ("Nth Play"). Customers message the page from there via Messenger.
 * TODO: replace with the page's exact link (facebook.com/<page>) once confirmed; until then this
 * opens a Facebook search for the page name.
 */
export const FACEBOOK_URL = 'https://www.facebook.com/search/pages/?q=Nth%20Play';
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
