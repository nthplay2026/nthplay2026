-- =============================================================================
-- Facility data: Nth Play, one outdoor pickleball court, open 6:00 AM – 11:00 PM daily.
-- Rates (per hour):
--   Mon–Thu  6:00 AM – 4:00 PM  ₱350   |  4:00 PM – 11:00 PM  ₱400
--   Fri–Sun  6:00 AM – 4:00 PM  ₱400   |  4:00 PM – 11:00 PM  ₱450
-- Payment: GCash (add the QR code in Admin → Settings once available).
-- Everything here is editable later in the admin dashboard.
-- Safe to run more than once.
-- =============================================================================

update public.facility_settings set
  facility_name = 'Nth Play',
  tagline = 'Your Court. Your Time. Your Game.',
  description = 'An outdoor pickleball court with a shade canopy and night lighting — open 6 AM to 11 PM, every day.',
  allow_cross_midnight = false,
  contact_email = '',
  contact_phone = '',
  address = '',
  map_url = '',
  amenities = array['Shade canopy', 'Night lighting', 'Open 6 AM – 11 PM daily'],
  admin_alert_email = '',
  max_duration_minutes = 720,  -- customers can tap up to 12 one-hour slots
  min_advance_minutes = 0,     -- a slot stays bookable until it ends (e.g. 4-5 PM until 5 PM)
  payment_methods = '[
    {"method":"gcash","enabled":true,"label":"GCash","instructions":"Pay the exact total via GCash (or any InstaPay bank app), then upload a screenshot of your receipt."},
    {"method":"cash","enabled":false,"label":"Cash at the facility","instructions":""},
    {"method":"bank_transfer","enabled":false,"label":"Bank transfer","instructions":""},
    {"method":"gateway","enabled":false,"label":"Online payment","instructions":""}
  ]'::jsonb
where id = 1;

-- The one court. No photo/video yet, so the site shows the court illustration.
insert into public.courts (id, name, description, court_type, image_url, base_hourly_rate, sort_order, features)
values ('11111111-1111-4111-8111-111111111111', 'Court 1',
        'Outdoor pickleball court with a shade canopy, regulation net and lines, and night lighting.',
        'outdoor', null, 400.00, 1, array['Outdoor', 'Shade canopy', 'Night lighting'])
on conflict (id) do update set
  description = excluded.description, court_type = excluded.court_type, image_url = excluded.image_url,
  base_hourly_rate = excluded.base_hourly_rate, features = excluded.features, is_active = true;

-- Day and evening rates. days_of_week: 0 = Sunday … 6 = Saturday.
delete from public.court_pricing;
insert into public.court_pricing (court_id, label, days_of_week, start_time, end_time, rate, priority) values
  (null, 'Weekday day',     array[1,2,3,4]::smallint[], '06:00', '16:00', 350.00, 0),
  (null, 'Weekday evening', array[1,2,3,4]::smallint[], '16:00', '23:00', 400.00, 0),
  (null, 'Weekend day',     array[5,6,0]::smallint[],   '06:00', '16:00', 400.00, 0),
  (null, 'Weekend evening', array[5,6,0]::smallint[],   '16:00', '23:00', 450.00, 0);

-- Open 6:00 AM – 11:00 PM, every day.
delete from public.operating_hours where court_id is not null;
insert into public.operating_hours (court_id, day_of_week, opening_time, closing_time, is_closed)
select null, d, '06:00', '23:00', false from generate_series(0, 6) as d
on conflict (court_id, day_of_week) do update
  set opening_time = excluded.opening_time, closing_time = excluded.closing_time, is_closed = false;
