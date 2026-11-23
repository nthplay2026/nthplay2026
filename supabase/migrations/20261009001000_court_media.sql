-- =============================================================================
-- Migration 1000: a court's media (photo or video) may also be a file hosted
-- with the website, e.g. '/media/nthplay.mp4', not only a full https:// URL.
-- =============================================================================
alter table public.courts drop constraint if exists courts_image_url_check;
alter table public.courts add constraint courts_image_url_check
  check (image_url is null or image_url ~ '^(https?://|/)');
