// Opening the GCash app from the payment QR code.
// GCash registers the `gcash://` link scheme (Android package com.globe.gcash.android).

export function mobilePlatform(): 'android' | 'ios' | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  return null;
}

/**
 * Opens GCash on a phone. On computers (no GCash app) it does nothing.
 * If GCash isn't installed, Android browsers stay on the page; iPhone browsers
 * may briefly say the link can't be opened — web pages can't check which apps
 * are installed on iOS.
 */
export function openGcash(): void {
  if (!mobilePlatform()) return;
  try {
    window.location.href = 'gcash://';
  } catch {
    /* no handler: do nothing */
  }
}
