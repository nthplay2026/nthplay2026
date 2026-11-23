-- =============================================================================
-- Test fixtures (3 courts, peak/weekend pricing, 06:00-22:00 hours).
-- Used only by the automated test-suites; the real facility data is supabase/seed.sql.
-- =============================================================================

update public.facility_settings set
  facility_name = 'Nth Play',
  tagline = 'Your Court. Your Time. Your Game.',
  description = 'Three tournament-spec pickleball courts with pro lighting, shaded seating and a friendly community of players at every level.',
  contact_email = 'hello@nthplay.example',
  contact_phone = '+63 917 000 0000',
  address = 'Sample address — update in Admin → Settings',
  map_url = '',
  amenities = array['Free parking', 'Paddle rental', 'Shaded seating', 'Drinking water', 'Restrooms & showers', 'LED night lighting'],
  admin_alert_email = 'admin@nthplay.example',
  payment_methods = '[
    {"method":"cash","enabled":true,"label":"Cash at the facility","instructions":"Pay at the front desk before your session starts."},
    {"method":"gcash","enabled":true,"label":"GCash","instructions":"Send the total to 0917 000 0000 (Nth Play) and enter the reference number from your GCash receipt."},
    {"method":"bank_transfer","enabled":true,"label":"Bank transfer","instructions":"Sample Bank · Account name: Nth Play · Account no.: 0000-0000-0000. Enter the transfer reference after paying."},
    {"method":"gateway","enabled":false,"label":"Online payment","instructions":""}
  ]'::jsonb
where id = 1;

insert into public.courts (id, name, description, court_type, image_url, base_hourly_rate, sort_order, features) values
  ('11111111-1111-4111-8111-111111111111', 'Court 1', 'Climate-controlled indoor court with cushioned acrylic surface and tournament lighting.',
   'indoor', null, 500.00, 1,
   array['Indoor', 'Air-conditioned', 'Cushioned surface']),
  ('22222222-2222-4222-8222-222222222222', 'Court 2', 'Outdoor hard court with windscreens and LED lighting for evening play.',
   'outdoor', null, 350.00, 2,
   array['Outdoor', 'LED lighting', 'Windscreens']),
  ('33333333-3333-4333-8333-333333333333', 'Court 3', 'Outdoor hard court beside the shaded viewing deck — great for groups.',
   'outdoor', null, 350.00, 3,
   array['Outdoor', 'LED lighting', 'Viewing deck']);

-- Peak pricing: weekday evenings and all day on weekends.
insert into public.court_pricing (court_id, label, days_of_week, start_time, end_time, rate) values
  ('11111111-1111-4111-8111-111111111111', 'Peak', array[1,2,3,4,5]::smallint[], '17:00', '22:00', 650.00),
  ('11111111-1111-4111-8111-111111111111', 'Weekend', array[0,6]::smallint[], '06:00', '23:00', 650.00),
  ('22222222-2222-4222-8222-222222222222', 'Peak', array[1,2,3,4,5]::smallint[], '17:00', '22:00', 450.00),
  ('22222222-2222-4222-8222-222222222222', 'Weekend', array[0,6]::smallint[], '06:00', '23:00', 450.00),
  ('33333333-3333-4333-8333-333333333333', 'Peak', array[1,2,3,4,5]::smallint[], '17:00', '22:00', 450.00),
  ('33333333-3333-4333-8333-333333333333', 'Weekend', array[0,6]::smallint[], '06:00', '23:00', 450.00);

-- Weekend hours run until 23:00.
update public.operating_hours set closing_time = '23:00' where court_id is null and day_of_week in (5, 6);
