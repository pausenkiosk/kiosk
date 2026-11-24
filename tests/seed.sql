-- Testdaten NUR für das Testprojekt. Alles erfunden. Wird vor jedem Testlauf neu eingespielt.
-- Platzhalter __ADMIN_EMAIL__, __GAST_EMAIL__, __ADMIN_PW__, __KIOSK_CODE__ ersetzt tests/run.sh aus Umgebungsvariablen.
truncate settings, admins, persons, sessions, products, sales, ledger, journal, purchases, purchase_items,
  counts, cash_counts, wishes, wish_votes, alerts, requests, photo_jobs cascade;
delete from auth.users where email = '__ADMIN_EMAIL__';

insert into settings(key, value) values ('kiosk_code', '__KIOSK_CODE__'), ('kiosk_code_at', today()::text);
-- Einstellungen ab Ausbaustufe 7 (Kiosk-Express, Adventskalender); schaden älteren Fassungen nicht
insert into settings(key, value) values ('liefer_min', '300'), ('advent_von', '2026-12-01'), ('advent_bis', '2026-12-24'),
  ('advent_max_preis', '30'), ('advent_mhd_bis', '2027-02-28'),
  ('advent_pool', '[{"match":"Knoppers%","w":40},{"match":"Corny Big%Banane%","w":35},{"match":"Corny Erdbeere%","w":8},{"match":"Golden Bridge%","w":6},{"match":"Choceur Milk%","w":6},{"match":"Kinder Country%","w":5}]') on conflict do nothing;

insert into products(name, category, price_cents, stock, active, created_at) values
  ('Cola',         'Getränke', 150, 12, true,  now() - interval '60 days'),
  ('Wasser',       'Getränke',  80, 20, true,  now() - interval '60 days'),
  ('Schokoriegel', 'Süßes',    100,  8, true,  now() - interval '60 days'),
  ('Gummibärchen', 'Süßes',    120,  0, true,  now() - interval '60 days'),
  ('Kaffee',       'Heißes',    50, 30, false, now() - interval '60 days');

insert into persons(vorname, pin_hash, consent_at) values
  ('Anna',  extensions.crypt('1111', extensions.gen_salt('bf', 10)), now()),
  ('Ben',   extensions.crypt('2222', extensions.gen_salt('bf', 10)), null),
  ('Clara', extensions.crypt('3333', extensions.gen_salt('bf', 10)), now()),
  ('Emil',  extensions.crypt('4444', extensions.gen_salt('bf', 10)), now()),
  ('Gerd',  extensions.crypt('5555', extensions.gen_salt('bf', 10)), now());

insert into ledger(person_id, day, amount_cents, kind)
  select id, today() - 3, 450, 'kauf' from persons where vorname = 'Emil';
insert into ledger(person_id, day, amount_cents, kind)
  select id, today() - 2, 200, 'kauf' from persons where vorname = 'Anna';
insert into ledger(person_id, day, amount_cents, kind)
  select id, today() - 50, 300, 'kauf' from persons where vorname = 'Gerd';

-- Kassenstand: 50,00 - 23,50 + 10,00 - 3,00 = 33,50
-- kind wie nach der Umstellung auf Ausbaustufe 3: alter Einkauf ohne Verweis, alte Excel-Zeile
insert into journal(day, text, in_cents, out_cents, source, kind) values
  (today(),       'Startgeld',     5000,    0, 'hand',  'hand'),
  (today() - 40,  'Einkauf Rewe',     0, 2350, 'app',   'einkauf'),
  (today() - 400, 'Altbestand',    1000,  300, 'excel', 'excel');

-- Test-Verwalter und ein zweites Konto OHNE Verwalter-Rechte (für die Gegenprobe)
delete from auth.users where email = '__GAST_EMAIL__';
with u as (
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new)
  select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
    e, extensions.crypt('__ADMIN_PW__', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
  from unnest(array['__ADMIN_EMAIL__', '__GAST_EMAIL__']) e
  returning id, email
), i as (
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), id, id::text, jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true),
    'email', now(), now(), now() from u
)
insert into admins(uid) select id from u where email = '__ADMIN_EMAIL__';
