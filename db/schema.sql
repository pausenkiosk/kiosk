-- Kiosk-App: Datenbank. Grundsatz: Tabellen sind per RLS gesperrt.
-- Kollegen greifen nur über k_*-Funktionen zu (QR-Code + PIN-Sitzung),
-- der Verwalter über Supabase-Anmeldung und is_admin().
-- Verkäufe (sales) tragen keinen Personenbezug, der Schuldschein (ledger) kein Produkt.

create extension if not exists pgcrypto with schema extensions;

create table if not exists settings (key text primary key, value text not null);
create table if not exists admins (uid uuid primary key);
create table if not exists persons (
  id uuid primary key default gen_random_uuid(),
  vorname text not null unique,
  pin_hash text not null,
  consent_at timestamptz,
  fails int not null default 0,
  locked_until timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists sessions (
  token_hash text primary key,
  person_id uuid not null references persons(id) on delete cascade,
  expires timestamptz not null
);
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text not null default 'Sonstiges',
  price_cents int not null default 0,
  sale_cents int,
  cost_cents int,
  stock int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
-- kind: app = per QR gebucht, zaehlung = Abgang laut Zählung (bar/Schwund), verlust = entsorgt
create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  qty int not null,
  cents int not null,
  kind text not null default 'app',
  at timestamptz not null default date_trunc('hour', now())
);
-- amount_cents > 0 erhöht die Schuld, < 0 ist eine Zahlung. sale_id/ts nur 5 Minuten für "Rückgängig".
create table if not exists ledger (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references persons(id) on delete cascade,
  day date not null,
  amount_cents int not null,
  kind text not null,
  sale_id uuid,
  ts timestamptz
);
create table if not exists journal (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  text text not null,
  in_cents int not null default 0,
  out_cents int not null default 0,
  source text not null default 'app'
);
create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  store text not null default ''
);
create table if not exists purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references purchases(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  qty int not null,
  cents int not null,
  mhd date,
  mhd_done boolean not null default false
);
create table if not exists counts (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  product_id uuid not null references products(id) on delete cascade,
  expected int not null,
  counted int not null
);
create table if not exists cash_counts (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  cents int not null
);
create table if not exists wishes (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  created_at timestamptz not null default now(),
  done boolean not null default false
);
create table if not exists wish_votes (
  wish_id uuid references wishes(id) on delete cascade,
  person_id uuid references persons(id) on delete cascade,
  primary key (wish_id, person_id)
);
create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  text text not null,
  seen boolean not null default false
);

create or replace function today() returns date language sql stable as
$$ select (now() at time zone 'Europe/Berlin')::date $$;

create or replace function is_admin() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from admins where uid = auth.uid()) $$;

-- RLS: alles gesperrt, nur der Verwalter darf direkt an die Tabellen.
do $$
declare t text;
begin
  foreach t in array array['settings','admins','persons','sessions','products','sales','ledger','journal',
    'purchases','purchase_items','counts','cash_counts','wishes','wish_votes','alerts'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('drop policy if exists adm on %I', t);
    if t not in ('sessions','admins','persons') then
      execute format('create policy adm on %I for all to authenticated using (is_admin()) with check (is_admin())', t);
      execute format('grant select, insert, update, delete on %I to authenticated', t);
    end if;
  end loop;
end $$;
-- Personen: Verwalter liest nur unkritische Spalten, PIN-Prüfwert nie.
create policy adm on persons for select to authenticated using (is_admin());
grant select (id, vorname, consent_at, locked_until, active, created_at) on persons to authenticated;

-- ---------- interne Helfer ----------
create or replace function k_code_ok(p_code text) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from settings where key = 'kiosk_code' and value = p_code) $$;

create or replace function k_person(p_token text) returns uuid language sql stable security definer set search_path = public, extensions as
$$ select s.person_id from sessions s join persons p on p.id = s.person_id
   where s.token_hash = encode(digest(p_token, 'sha256'), 'hex') and s.expires > now() and p.active $$;

create or replace function k_cleanup() returns void language sql security definer set search_path = public as
$$ update ledger set sale_id = null, ts = null where ts < now() - interval '5 minutes';
   delete from sessions where expires < now(); $$;

-- ---------- Kollegen ----------
create or replace function k_names(p_code text) returns jsonb language sql stable security definer set search_path = public as
$$ select case when k_code_ok(p_code)
     then coalesce((select jsonb_agg(jsonb_build_object('id', id, 'vorname', vorname) order by vorname) from persons where active), '[]'::jsonb)
     else null end $$;

create or replace function k_login(p_code text, p_person uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare p persons; t text;
begin
  if not k_code_ok(p_code) then return jsonb_build_object('ok', false, 'err', 'code'); end if;
  select * into p from persons where id = p_person and active for update;
  if not found then return jsonb_build_object('ok', false, 'err', 'unbekannt'); end if;
  if p.locked_until is not null and p.locked_until > now() then
    return jsonb_build_object('ok', false, 'err', 'gesperrt', 'bis', p.locked_until);
  end if;
  if p.pin_hash = crypt(p_pin, p.pin_hash) then
    update persons set fails = 0, locked_until = null where id = p.id;
    t := encode(gen_random_bytes(24), 'hex');
    insert into sessions values (encode(digest(t, 'sha256'), 'hex'), p.id, now() + interval '90 days');
    return jsonb_build_object('ok', true, 'token', t);
  end if;
  if p.fails + 1 >= 3 then
    update persons set fails = 0, locked_until = now() + interval '1 hour' where id = p.id;
    insert into alerts(text) values ('Anmeldung von ' || p.vorname || ' nach 3 falschen PINs für 1 Stunde gesperrt');
    return jsonb_build_object('ok', false, 'err', 'gesperrt', 'bis', now() + interval '1 hour');
  end if;
  update persons set fails = fails + 1 where id = p.id;
  return jsonb_build_object('ok', false, 'err', 'pin', 'rest', 3 - (p.fails + 1));
end $$;

create or replace function k_logout(p_token text) returns void language sql security definer set search_path = public, extensions as
$$ delete from sessions where token_hash = encode(digest(p_token, 'sha256'), 'hex') $$;

create or replace function k_consent(p_token text) returns void language sql security definer set search_path = public as
$$ update persons set consent_at = now() where id = k_person(p_token) and consent_at is null $$;

create or replace function k_state(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid uuid := k_person(p_token);
begin
  if pid is null then return null; end if;
  perform k_cleanup();
  return jsonb_build_object(
    'vorname', (select vorname from persons where id = pid),
    'consent', (select consent_at is not null from persons where id = pid),
    'saldo', coalesce((select sum(amount_cents) from ledger where person_id = pid), 0),
    'entries', coalesce((select jsonb_agg(e) from (
        select jsonb_build_object('id', id, 'day', day, 'cents', amount_cents, 'kind', kind, 'undo', ts is not null) e
        from ledger where person_id = pid order by day desc, ts desc nulls last limit 30) x), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'cat', category,
        'cents', coalesce(sale_cents, price_cents), 'normal', price_cents, 'sale', sale_cents is not null, 'stock', stock)
        order by category, name) from products where active), '[]'::jsonb),
    'wishes', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'text', w.text,
        'votes', (select count(*) from wish_votes v where v.wish_id = w.id),
        'mine', exists (select 1 from wish_votes v where v.wish_id = w.id and v.person_id = pid)) order by w.created_at desc)
        from wishes w where not w.done), '[]'::jsonb));
end $$;

create or replace function k_buy(p_token text, p_product uuid, p_qty int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid uuid := k_person(p_token); pr products; sid uuid; c int;
begin
  if pid is null then return jsonb_build_object('ok', false, 'err', 'sitzung'); end if;
  if not exists (select 1 from persons where id = pid and consent_at is not null) then
    return jsonb_build_object('ok', false, 'err', 'einwilligung'); end if;
  if p_qty < 1 or p_qty > 10 then return jsonb_build_object('ok', false, 'err', 'menge'); end if;
  select * into pr from products where id = p_product and active for update;
  if not found then return jsonb_build_object('ok', false, 'err', 'produkt'); end if;
  c := coalesce(pr.sale_cents, pr.price_cents) * p_qty;
  insert into sales(product_id, qty, cents, kind) values (pr.id, p_qty, c, 'app') returning id into sid;
  insert into ledger(person_id, day, amount_cents, kind, sale_id, ts) values (pid, today(), c, 'kauf', sid, now());
  update products set stock = greatest(stock - p_qty, 0) where id = pr.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function k_undo(p_token text, p_entry uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid uuid := k_person(p_token); l ledger; s sales;
begin
  select * into l from ledger where id = p_entry and person_id = pid and kind = 'kauf'
    and ts > now() - interval '5 minutes' and sale_id is not null;
  if not found then return jsonb_build_object('ok', false); end if;
  select * into s from sales where id = l.sale_id;
  if found then
    update products set stock = stock + s.qty where id = s.product_id;
    delete from sales where id = s.id;
  end if;
  delete from ledger where id = l.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function k_pin(p_token text, p_old text, p_new text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare pid uuid := k_person(p_token);
begin
  if pid is null or p_new !~ '^[0-9]{4}$' then return false; end if;
  update persons set pin_hash = crypt(p_new, gen_salt('bf', 10)) where id = pid and pin_hash = crypt(p_old, pin_hash);
  return found;
end $$;

create or replace function k_wish(p_token text, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare pid uuid := k_person(p_token); wid uuid;
begin
  if pid is null or length(trim(p_text)) < 2 or length(p_text) > 60 then return; end if;
  if (select count(*) from wishes where not done) >= 40 then return; end if;
  insert into wishes(text) values (trim(p_text)) returning id into wid;
  insert into wish_votes values (wid, pid);
end $$;

create or replace function k_vote(p_token text, p_wish uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pid uuid := k_person(p_token);
begin
  if pid is null then return; end if;
  delete from wish_votes where wish_id = p_wish and person_id = pid;
  if not found then insert into wish_votes values (p_wish, pid); end if;
end $$;

-- ---------- Verwalter ----------
create or replace function a_claim(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or exists (select 1 from admins) then return false; end if;
  if not exists (select 1 from settings where key = 'setup_code' and value = p_code) then return false; end if;
  insert into admins values (auth.uid());
  delete from settings where key = 'setup_code';
  return true;
end $$;

create or replace function a_person(p_vorname text, p_pin text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare r uuid;
begin
  if not is_admin() or p_pin !~ '^[0-9]{4}$' then raise exception 'nicht erlaubt'; end if;
  insert into persons(vorname, pin_hash) values (trim(p_vorname), crypt(p_pin, gen_salt('bf', 10))) returning id into r;
  return r;
end $$;

create or replace function a_pin(p_person uuid, p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_admin() or p_pin !~ '^[0-9]{4}$' then raise exception 'nicht erlaubt'; end if;
  update persons set pin_hash = crypt(p_pin, gen_salt('bf', 10)), fails = 0, locked_until = null where id = p_person;
  delete from sessions where person_id = p_person;
end $$;

create or replace function a_person_delete(p_person uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'nicht erlaubt'; end if;
  if coalesce((select sum(amount_cents) from ledger where person_id = p_person), 0) <> 0 then return false; end if;
  delete from persons where id = p_person;
  return true;
end $$;

create or replace function a_pay(p_person uuid, p_cents int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() or p_cents = 0 then raise exception 'nicht erlaubt'; end if;
  insert into ledger(person_id, day, amount_cents, kind) values (p_person, today(), -p_cents, 'zahlung');
  insert into journal(day, text, in_cents) values (today(), 'Zahlung Schuldschein', p_cents);
end $$;

create or replace function a_fix(p_person uuid, p_cents int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'nicht erlaubt'; end if;
  insert into ledger(person_id, day, amount_cents, kind) values (p_person, today(), p_cents, 'korrektur');
end $$;

create or replace function a_cash(p_cents int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'nicht erlaubt'; end if;
  insert into cash_counts(day, cents) values (today(), p_cents);
  if p_cents > 0 then insert into journal(day, text, in_cents) values (today(), 'Barverkäufe', p_cents); end if;
end $$;

-- p_items: [{"id": uuid, "qty": int}]
create or replace function a_count(p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare it jsonb; pr products; q int; d int;
begin
  if not is_admin() then raise exception 'nicht erlaubt'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into pr from products where id = (it->>'id')::uuid for update;
    q := (it->>'qty')::int; d := pr.stock - q;
    insert into counts(day, product_id, expected, counted) values (today(), pr.id, pr.stock, q);
    if d > 0 then insert into sales(product_id, qty, cents, kind) values (pr.id, d, d * pr.price_cents, 'zaehlung'); end if;
    update products set stock = q where id = pr.id;
  end loop;
end $$;

-- p_items: [{"id": uuid, "qty": int, "cents": int, "mhd": "YYYY-MM-DD"|null}]
create or replace function a_purchase(p_day date, p_store text, p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare it jsonb; pu uuid; total int := 0;
begin
  if not is_admin() then raise exception 'nicht erlaubt'; end if;
  insert into purchases(day, store) values (p_day, coalesce(p_store, '')) returning id into pu;
  for it in select * from jsonb_array_elements(p_items) loop
    insert into purchase_items(purchase_id, product_id, qty, cents, mhd)
      values (pu, (it->>'id')::uuid, (it->>'qty')::int, (it->>'cents')::int, nullif(it->>'mhd', '')::date);
    update products set stock = stock + (it->>'qty')::int,
      cost_cents = case when (it->>'qty')::int > 0 then round((it->>'cents')::numeric / (it->>'qty')::int) else cost_cents end
      where id = (it->>'id')::uuid;
    total := total + (it->>'cents')::int;
  end loop;
  insert into journal(day, text, out_cents) values (p_day, 'Einkauf ' || coalesce(p_store, ''), total);
end $$;

create or replace function a_waste(p_product uuid, p_qty int) returns void
language plpgsql security definer set search_path = public as $$
declare pr products;
begin
  if not is_admin() then raise exception 'nicht erlaubt'; end if;
  select * into pr from products where id = p_product for update;
  insert into sales(product_id, qty, cents, kind) values (pr.id, p_qty, p_qty * coalesce(pr.cost_cents, pr.price_cents), 'verlust');
  update products set stock = greatest(stock - p_qty, 0) where id = pr.id;
end $$;

-- Rechte: Funktionen sind nicht öffentlich, nur gezielt freigegeben.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function today(), is_admin() to authenticated;
grant execute on function k_names(text), k_login(text, uuid, text), k_logout(text), k_consent(text), k_state(text),
  k_buy(text, uuid, int), k_undo(text, uuid), k_pin(text, text, text), k_wish(text, text), k_vote(text, uuid) to anon, authenticated;
grant execute on function a_claim(text), a_person(text, text), a_pin(uuid, text), a_person_delete(uuid), a_pay(uuid, int),
  a_fix(uuid, int), a_cash(int), a_count(jsonb), a_purchase(date, text, jsonb), a_waste(uuid, int) to authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ---------- Ausbaustufe 2: Wünsche an Claude, Regalfotos, Personenliste ----------
create table if not exists requests (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  text text not null,
  status text not null default 'neu',   -- neu | erledigt | rueckfrage
  answer text
);
create table if not exists photo_jobs (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  paths text[] not null,
  status text not null default 'neu',   -- neu | vorschlag | fertig
  result jsonb,                         -- [{"id": Produkt, "qty": Stückzahl}]
  note text
);
do $$
declare t text;
begin
  foreach t in array array['requests','photo_jobs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('drop policy if exists adm on %I', t);
    execute format('create policy adm on %I for all to authenticated using (is_admin()) with check (is_admin())', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

-- Mehrere Personen auf einmal, jede mit zufälliger Start-PIN. Liefert die PINs genau einmal zurück.
create or replace function a_persons(p_names text[]) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare n text; pin text; b bytea; res jsonb := '[]'::jsonb;
begin
  if not is_admin() then raise exception 'nicht erlaubt'; end if;
  foreach n in array p_names loop
    n := trim(n);
    continue when length(n) < 2 or exists (select 1 from persons where lower(vorname) = lower(n));
    b := gen_random_bytes(2);
    pin := lpad(((get_byte(b, 0) * 256 + get_byte(b, 1)) % 10000)::text, 4, '0');
    insert into persons(vorname, pin_hash) values (n, crypt(pin, gen_salt('bf', 10)));
    res := res || jsonb_build_object('vorname', n, 'pin', pin);
  end loop;
  return res;
end $$;
revoke execute on function a_persons(text[]) from public, anon;
grant execute on function a_persons(text[]) to authenticated;

-- Privater Fotospeicher, nur für den Verwalter.
insert into storage.buckets (id, name, public) values ('fotos', 'fotos', false) on conflict do nothing;
drop policy if exists kiosk_fotos_adm on storage.objects;
create policy kiosk_fotos_adm on storage.objects for all to authenticated
  using (bucket_id = 'fotos' and public.is_admin()) with check (bucket_id = 'fotos' and public.is_admin());

-- ---------- Kollegen-Ansicht gekürzt: nur Bestand, Schuldschein, Anschreiben, PIN ----------
revoke execute on function k_wish(text, text), k_vote(text, uuid) from anon, authenticated;
create or replace function k_state(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid uuid := k_person(p_token);
begin
  if pid is null then return null; end if;
  perform k_cleanup();
  return jsonb_build_object(
    'vorname', (select vorname from persons where id = pid),
    'consent', (select consent_at is not null from persons where id = pid),
    'saldo', coalesce((select sum(amount_cents) from ledger where person_id = pid), 0),
    'entries', coalesce((select jsonb_agg(e) from (
        select jsonb_build_object('id', id, 'day', day, 'cents', amount_cents, 'kind', kind, 'undo', ts is not null) e
        from ledger where person_id = pid order by day desc, ts desc nulls last limit 30) x), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'cat', category,
        'cents', coalesce(sale_cents, price_cents), 'normal', price_cents, 'sale', sale_cents is not null, 'stock', stock)
        order by category, name) from products where active), '[]'::jsonb));
end $$;

-- ---------- Haltbarkeitsdaten auch ohne Einkauf (z. B. aus Produktfotos) ----------
alter table purchase_items alter column purchase_id drop not null;

-- ---------- Einkauf per Bon-Foto, Screenshot oder Ansage ----------
-- kind 'foto': Regal- oder Produktfotos. kind 'einkauf': Bon/Screenshot (paths) und/oder Ansage (text);
-- result = {"store": text, "day": "YYYY-MM-DD", "items": [{"id": Produkt, "qty": int, "cents": int}]}
alter table photo_jobs add column if not exists kind text not null default 'foto';
alter table photo_jobs add column if not exists text text;

-- ---------- Ausbaustufe 3: Kassensturz nach Kasseninhalt, Storno, QR-Code-Alter ----------
-- journal.kind: excel | hand | bar | zahlung | einkauf. journal.ref zeigt auf den Kassensturz bzw. Einkauf, damit ein Storno beides entfernt.
alter table journal add column if not exists kind text;
alter table journal add column if not exists ref uuid;
-- Zeitpunkt: neue Zeilen bekommen now(). Alte Zeilen kennen nur den Tag; Buchungen gelten als mittags,
-- Kassenstürze als Tagesende, damit Zahlungen nach einem alten Kassensturz beim nächsten abgezogen werden.
alter table journal add column if not exists at timestamptz;
alter table cash_counts add column if not exists at timestamptz;
update journal set at = least((day + time '12:00') at time zone 'Europe/Berlin', now()) where at is null;
update cash_counts set at = least((day + time '23:59') at time zone 'Europe/Berlin', now()) where at is null;
alter table journal alter column at set default now();
alter table journal alter column at set not null;
alter table cash_counts alter column at set default now();
alter table cash_counts alter column at set not null;
alter table cash_counts add column if not exists bar_cents int;
update journal set kind = case when source = 'excel' then 'excel' when source = 'hand' then 'hand' when text = 'Barverkäufe' then 'bar'
  when text = 'Zahlung Schuldschein' then 'zahlung' when text like 'Einkauf %' then 'einkauf' else 'hand' end where kind is null;
update cash_counts set bar_cents = cents where bar_cents is null;
update journal j set ref = c.id from cash_counts c where j.kind = 'bar' and j.ref is null and j.day = c.day and j.in_cents = c.cents;
insert into settings values ('kiosk_code_at', today()::text) on conflict do nothing;

create or replace function a_pay(p_person uuid, p_cents int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() or p_cents = 0 then raise exception 'nicht erlaubt'; end if;
  insert into ledger(person_id, day, amount_cents, kind) values (p_person, today(), -p_cents, 'zahlung');
  insert into journal(day, text, in_cents, kind) values (today(), 'Zahlung Schuldschein', p_cents, 'zahlung');
end $$;

-- Bisherige App-Fassung: p_cents sind die Barverkäufe seit der letzten Zählung. Bleibt für ältere Fassungen im Handy-Speicher erhalten.
create or replace function a_cash(p_cents int) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if not is_admin() then raise exception 'nicht erlaubt'; end if;
  insert into cash_counts(day, cents, bar_cents) values (today(), p_cents, p_cents) returning id into cid;
  if p_cents > 0 then insert into journal(day, text, in_cents, kind, ref) values (today(), 'Barverkäufe', p_cents, 'bar', cid); end if;
end $$;

-- Kassensturz nach Kasseninhalt: p_cents ist der gesamte Inhalt der Kasse beim Leeren.
-- Schuldschein-Zahlungen seit dem letzten Kassensturz liegen mit in der Kasse und sind schon gebucht; der Rest sind Barverkäufe.
create or replace function a_cash_box(p_cents int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare last timestamptz; paid int; bar int; cid uuid;
begin
  if not is_admin() or p_cents < 0 then raise exception 'nicht erlaubt'; end if;
  select max(at) into last from cash_counts;
  select coalesce(sum(in_cents), 0) into paid from journal where kind = 'zahlung' and (last is null or at > last);
  bar := p_cents - paid;
  insert into cash_counts(day, cents, bar_cents) values (today(), p_cents, bar) returning id into cid;
  insert into journal(day, text, in_cents, kind, ref) values (today(), 'Barverkäufe', greatest(bar, 0), 'bar', cid);
  return jsonb_build_object('paid', paid, 'bar', bar);
end $$;

create or replace function a_purchase(p_day date, p_store text, p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare it jsonb; pu uuid; total int := 0;
begin
  if not is_admin() then raise exception 'nicht erlaubt'; end if;
  insert into purchases(day, store) values (p_day, coalesce(p_store, '')) returning id into pu;
  for it in select * from jsonb_array_elements(p_items) loop
    insert into purchase_items(purchase_id, product_id, qty, cents, mhd)
      values (pu, (it->>'id')::uuid, (it->>'qty')::int, (it->>'cents')::int, nullif(it->>'mhd', '')::date);
    update products set stock = stock + (it->>'qty')::int,
      cost_cents = case when (it->>'qty')::int > 0 then round((it->>'cents')::numeric / (it->>'qty')::int) else cost_cents end
      where id = (it->>'id')::uuid;
    total := total + (it->>'cents')::int;
  end loop;
  insert into journal(day, text, out_cents, kind, ref) values (p_day, 'Einkauf ' || coalesce(p_store, ''), total, 'einkauf', pu);
end $$;

-- Zählung und Entsorgung mit genauem Zeitpunkt, damit der Fehlbetrag zwischen zwei Kassenstürzen stimmt.
create or replace function a_count(p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare it jsonb; pr products; q int; d int;
begin
  if not is_admin() then raise exception 'nicht erlaubt'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into pr from products where id = (it->>'id')::uuid for update;
    q := (it->>'qty')::int; d := pr.stock - q;
    insert into counts(day, product_id, expected, counted) values (today(), pr.id, pr.stock, q);
    if d > 0 then insert into sales(product_id, qty, cents, kind, at) values (pr.id, d, d * pr.price_cents, 'zaehlung', now()); end if;
    update products set stock = q where id = pr.id;
  end loop;
end $$;

create or replace function a_waste(p_product uuid, p_qty int) returns void
language plpgsql security definer set search_path = public as $$
declare pr products;
begin
  if not is_admin() then raise exception 'nicht erlaubt'; end if;
  select * into pr from products where id = p_product for update;
  insert into sales(product_id, qty, cents, kind, at) values (pr.id, p_qty, p_qty * coalesce(pr.cost_cents, pr.price_cents), 'verlust', now());
  update products set stock = greatest(stock - p_qty, 0) where id = pr.id;
end $$;

-- Storno eigener Eingaben: Buchung von Hand, letzter Kassensturz, Einkauf (Bestand wird zurückgenommen).
create or replace function a_storno(p_journal uuid) returns text
language plpgsql security definer set search_path = public as $$
declare j journal; it record;
begin
  if not is_admin() then raise exception 'nicht erlaubt'; end if;
  select * into j from journal where id = p_journal for update;
  if not found then return 'fehlt'; end if;
  if coalesce(j.kind, j.source) = 'hand' then
    delete from journal where id = j.id; return 'ok';
  elsif j.kind = 'bar' and j.ref is not null then
    if j.ref is distinct from (select id from cash_counts order by at desc limit 1) then return 'nicht_letzter'; end if;
    delete from cash_counts where id = j.ref; delete from journal where id = j.id; return 'ok';
  elsif j.kind = 'einkauf' and j.ref is not null then
    for it in select product_id, qty from purchase_items where purchase_id = j.ref loop
      update products set stock = greatest(stock - it.qty, 0) where id = it.product_id;
    end loop;
    delete from purchases where id = j.ref; delete from journal where id = j.id; return 'ok';
  end if;
  return 'nicht_moeglich';
end $$;

revoke execute on function a_cash(int), a_cash_box(int), a_storno(uuid) from public, anon;
grant execute on function a_cash(int), a_cash_box(int), a_storno(uuid) to authenticated;

-- ---------- Ausbaustufe 4: Wunsch der Kollegen wieder möglich, gleiche Wünsche zusammengezählt ----------
create or replace function k_wish(p_token text, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare pid uuid := k_person(p_token); wid uuid; t text := trim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g'));
begin
  if pid is null or length(t) < 2 or length(t) > 60 then return; end if;
  select id into wid from wishes where not done and lower(text) = lower(t) limit 1;
  if wid is null then
    if (select count(*) from wishes where not done) >= 60 then return; end if;
    insert into wishes(text) values (t) returning id into wid;
  end if;
  insert into wish_votes values (wid, pid) on conflict do nothing;
end $$;
revoke execute on function k_wish(text, text) from public;
grant execute on function k_wish(text, text) to anon, authenticated;

-- Rückgängig: Buchung sperren, damit gleichzeitige Aufrufe den Bestand nicht doppelt erhöhen
create or replace function k_undo(p_token text, p_entry uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid uuid := k_person(p_token); l ledger; s sales;
begin
  select * into l from ledger where id = p_entry and person_id = pid and kind = 'kauf'
    and ts > now() - interval '5 minutes' and sale_id is not null for update;
  if not found then return jsonb_build_object('ok', false); end if;
  delete from sales where id = l.sale_id returning * into s;
  if found then update products set stock = stock + s.qty where id = s.product_id; end if;
  delete from ledger where id = l.id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- Ausbaustufe 5: Guthaben auszahlen ----------
-- Auszahlung aus der Kioskkasse: erhöht den Saldo (Guthaben sinkt) und ist eine Ausgabe im Kassenbuch.
create or replace function a_payout(p_person uuid, p_cents int) returns text
language plpgsql security definer set search_path = public as $$
declare saldo int;
begin
  if not is_admin() or p_cents <= 0 then raise exception 'nicht erlaubt'; end if;
  perform 1 from persons where id = p_person for update;
  select coalesce(sum(amount_cents), 0) into saldo from ledger where person_id = p_person;
  if p_cents > -saldo then return 'zu_viel'; end if;
  insert into ledger(person_id, day, amount_cents, kind) values (p_person, today(), p_cents, 'auszahlung');
  insert into journal(day, text, out_cents, kind) values (today(), 'Auszahlung Guthaben', p_cents, 'auszahlung');
  return 'ok';
end $$;
revoke execute on function a_payout(uuid, int) from public, anon;
grant execute on function a_payout(uuid, int) to authenticated;

-- Kassensturz nach Kasseninhalt: Auszahlungen aus der Kasse seit dem letzten Kassensturz werden gegengerechnet.
create or replace function a_cash_box(p_cents int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare last timestamptz; paid int; bar int; cid uuid;
begin
  if not is_admin() or p_cents < 0 then raise exception 'nicht erlaubt'; end if;
  select max(at) into last from cash_counts;
  select coalesce(sum(case when kind = 'zahlung' then in_cents else -out_cents end), 0) into paid
    from journal where kind in ('zahlung', 'auszahlung') and (last is null or at > last);
  bar := p_cents - paid;
  insert into cash_counts(day, cents, bar_cents) values (today(), p_cents, bar) returning id into cid;
  insert into journal(day, text, in_cents, kind, ref) values (today(), 'Barverkäufe', greatest(bar, 0), 'bar', cid);
  return jsonb_build_object('paid', paid, 'bar', bar);
end $$;

-- ---------- Ausbaustufe 6: Zuordnung Kauf–Produkt zuverlässig nach 5 Minuten entfernen ----------
-- Bisher nur beim Öffnen der Kollegen-Ansicht. Jetzt zusätzlich bei jedem Kauf, beim Laden der Verwaltung
-- und, wo pg_cron verfügbar ist, alle 5 Minuten.
create or replace function a_cleanup() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'nicht erlaubt'; end if;
  perform k_cleanup();
end $$;
revoke execute on function a_cleanup() from public, anon;
grant execute on function a_cleanup() to authenticated;

create or replace function k_buy(p_token text, p_product uuid, p_qty int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid uuid := k_person(p_token); pr products; sid uuid; c int;
begin
  if pid is null then return jsonb_build_object('ok', false, 'err', 'sitzung'); end if;
  perform k_cleanup();
  if not exists (select 1 from persons where id = pid and consent_at is not null) then
    return jsonb_build_object('ok', false, 'err', 'einwilligung'); end if;
  if p_qty < 1 or p_qty > 10 then return jsonb_build_object('ok', false, 'err', 'menge'); end if;
  select * into pr from products where id = p_product and active for update;
  if not found then return jsonb_build_object('ok', false, 'err', 'produkt'); end if;
  c := coalesce(pr.sale_cents, pr.price_cents) * p_qty;
  insert into sales(product_id, qty, cents, kind) values (pr.id, p_qty, c, 'app') returning id into sid;
  insert into ledger(person_id, day, amount_cents, kind, sale_id, ts) values (pid, today(), c, 'kauf', sid, now());
  update products set stock = greatest(stock - p_qty, 0) where id = pr.id;
  return jsonb_build_object('ok', true);
end $$;

do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('kiosk-cleanup', '*/5 * * * *', 'select public.k_cleanup()');
exception when others then
  raise notice 'pg_cron nicht verfügbar: %', sqlerrm;
end $$;

-- ---------- Ausbaustufe 7: Lieferdienst „Kiosk-Express“ und Adventskalender ----------
create extension if not exists pg_net;

-- Lieferungen. Büro und Artikel stehen nur, solange die Lieferung offen ist; nach „geliefert“ oder „storniert“ werden sie geleert.
create table if not exists deliveries (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references persons(id) on delete cascade,
  office text,
  items jsonb,
  total_cents int not null,
  status text not null default 'neu',          -- neu | unterwegs | geliefert | storniert
  rating int,
  tip text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
-- Adventskalender: höchstens ein Gewinn pro Tag.
alter table deliveries add column if not exists ledger_ids uuid[];
alter table deliveries add column if not exists sale_ids uuid[];
create table if not exists advent_wins (
  day date primary key,
  person_id uuid references persons(id) on delete set null,
  product_id uuid references products(id) on delete set null,
  at timestamptz not null default now()
);
do $$
declare t text;
begin
  foreach t in array array['deliveries', 'advent_wins'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('drop policy if exists adm on %I', t);
    execute format('create policy adm on %I for all to authenticated using (is_admin()) with check (is_admin())', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;
insert into settings values ('liefer_min', '300') on conflict do nothing;
insert into settings values ('advent_von', '2026-12-01') on conflict do nothing;
insert into settings values ('advent_bis', '2026-12-24') on conflict do nothing;
-- Gewinnliste: Namensmuster (% = beliebig) mit Gewicht. Knoppers 40 %, Corny Big Banane 35 % (andere Corny-Big-Sorten
-- halten länger und werden verkauft).
insert into settings values ('advent_pool', '[{"match":"Knoppers%","w":40},{"match":"Corny Big%Banane%","w":35},{"match":"Choceur Peanut%","w":8},{"match":"Corny Erdbeere%","w":8},{"match":"Golden Bridge%","w":8},{"match":"Choceur Milk%","w":8}]') on conflict do nothing;

-- Benachrichtigung an den Betreiber über ntfy (nur wenn ein Kanal eingerichtet ist). Text ohne Namen.
create or replace function k_notify(p_title text, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare topic text := (select value from settings where key = 'ntfy_topic');
begin
  if topic is null or topic = '' then return; end if;
  -- JSON-Schnittstelle von ntfy (pg_net sendet nur application/json)
  perform net.http_post(url := 'https://ntfy.sh/',
    body := jsonb_build_object('topic', topic, 'title', p_title, 'message', p_body, 'tags', jsonb_build_array('package')));
exception when others then
  insert into alerts(text) values ('Benachrichtigung konnte nicht gesendet werden: ' || p_title);
end $$;

-- Kauf eines Produkts (intern, gemeinsam für Anschreiben und Lieferung)
create or replace function k_buy_one(pid uuid, p_product uuid, p_qty int) returns int
language plpgsql security definer set search_path = public as $$
declare pr products; sid uuid; c int;
begin
  select * into pr from products where id = p_product and active for update;
  if not found then return null; end if;
  c := coalesce(pr.sale_cents, pr.price_cents) * p_qty;
  insert into sales(product_id, qty, cents, kind) values (pr.id, p_qty, c, 'app') returning id into sid;
  insert into ledger(person_id, day, amount_cents, kind, sale_id, ts) values (pid, today(), c, 'kauf', sid, now());
  update products set stock = greatest(stock - p_qty, 0) where id = pr.id;
  return c;
end $$;

-- Adventskalender: nach einem Kauf prüfen, ob heute gewonnen wird.
-- Regeln: höchstens ein Gewinn pro Tag, höchstens 2 pro Person; wer noch nie gewonnen hat, gewinnt zuerst,
-- ein zweiter Gewinn erst ab der zweiten Hälfte des Zeitraums. Gewinn: aus der Gewinnliste advent_pool
-- (Namensmuster mit Gewichten); erst wird eine vorrätige Gruppe nach Gewicht gezogen, darin das Produkt mit dem
-- frühesten Haltbarkeitsdatum. Abgelaufenes ist ausgeschlossen. Auch ausgeblendete Produkte mit Bestand können
-- gewinnen (reine Gewinn-Ware). Wird als Verlust zum Einkaufspreis gebucht. Ohne Kauf an einem Tag verfällt der Gewinn.
create or replace function k_advent(pid uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare von date; bis date; wins int; pr products; mitte date; r numeric; gm text;
begin
  begin
  von := (select value::date from settings where key = 'advent_von');
  bis := (select value::date from settings where key = 'advent_bis');
  if von is null or today() < von or today() > bis then return null; end if;
  perform pg_advisory_xact_lock(hashtext('advent'));
  if exists (select 1 from advent_wins where day = today()) then return jsonb_build_object('tag', today() - von + 1, 'gewonnen', false); end if;
  select count(*) into wins from advent_wins where person_id = pid;
  mitte := von + ((bis - von) / 2);
  if wins >= 2 or (wins = 1 and today() < mitte) then return jsonb_build_object('tag', today() - von + 1, 'gewonnen', false); end if;
  r := random();
  with g as (
    select e->>'match' m, (e->>'w')::numeric w
      from jsonb_array_elements(coalesce((select value::jsonb from settings where key = 'advent_pool'), '[]'::jsonb)) e
     where (e->>'w')::numeric > 0
       and exists (select 1 from products p where p.name ilike e->>'match' and p.stock > 0
                   and not exists (select 1 from purchase_items i where i.product_id = p.id and not i.mhd_done and i.mhd < today()))),
  c as (select m, sum(w) over (order by m) cw, sum(w) over () tw from g)
  select m into gm from c where cw >= r * tw order by cw limit 1;
  if gm is null then return jsonb_build_object('tag', today() - von + 1, 'gewonnen', false); end if;
  select p.* into pr from products p
   where p.name ilike gm and p.stock > 0
     and not exists (select 1 from purchase_items i where i.product_id = p.id and not i.mhd_done and i.mhd < today())
   order by (select min(i.mhd) from purchase_items i where i.product_id = p.id and not i.mhd_done) nulls last, p.name
   limit 1 for update;
  if not found then return jsonb_build_object('tag', today() - von + 1, 'gewonnen', false); end if;
  insert into advent_wins(day, person_id, product_id) values (today(), pid, pr.id);
  insert into sales(product_id, qty, cents, kind, at) values (pr.id, 1, coalesce(pr.cost_cents, pr.price_cents), 'verlust', now());
  update products set stock = stock - 1 where id = pr.id;
  insert into alerts(text) values ('Adventskalender: ' || (select vorname from persons where id = pid) || ' hat heute ' || pr.name || ' gewonnen');
  -- Mitteilung ans Handy ohne Namen; wer gewonnen hat, steht auf der Startseite der Verwaltung
  perform k_notify('Adventskalender: heute gewonnen', 'Gewinn: ' || pr.name || '. Wer gewonnen hat, steht auf der Startseite der Kiosk-App.');
  return jsonb_build_object('tag', today() - von + 1, 'gewonnen', true, 'produkt', pr.name);
  exception when others then
    return null;  -- z. B. fehlerhafte Gewinnliste: dann heute kein Gewinn, der Kauf bleibt gültig
  end;
end $$;

create or replace function k_buy(p_token text, p_product uuid, p_qty int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid uuid := k_person(p_token); c int;
begin
  if pid is null then return jsonb_build_object('ok', false, 'err', 'sitzung'); end if;
  perform k_cleanup();
  if not exists (select 1 from persons where id = pid and consent_at is not null) then
    return jsonb_build_object('ok', false, 'err', 'einwilligung'); end if;
  if p_qty < 1 or p_qty > 10 then return jsonb_build_object('ok', false, 'err', 'menge'); end if;
  c := k_buy_one(pid, p_product, p_qty);
  if c is null then return jsonb_build_object('ok', false, 'err', 'produkt'); end if;
  return jsonb_build_object('ok', true, 'advent', k_advent(pid));
end $$;

-- Lieferung bestellen: p_items = [{"id": Produkt, "qty": n}], sofort gebucht
create or replace function k_deliver(p_token text, p_items jsonb, p_office text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid uuid := k_person(p_token); it jsonb; c int; total int := 0; lst jsonb := '[]'::jsonb; did uuid; o text := trim(coalesce(p_office, '')); lids uuid[]; sids uuid[];
begin
  if pid is null then return jsonb_build_object('ok', false, 'err', 'sitzung'); end if;
  perform k_cleanup();
  if not exists (select 1 from persons where id = pid and consent_at is not null) then return jsonb_build_object('ok', false, 'err', 'einwilligung'); end if;
  if length(o) < 1 or length(o) > 40 then return jsonb_build_object('ok', false, 'err', 'buero'); end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 20 then return jsonb_build_object('ok', false, 'err', 'leer'); end if;
  if exists (select 1 from deliveries where person_id = pid and status in ('neu', 'unterwegs')) then return jsonb_build_object('ok', false, 'err', 'offen'); end if;
  -- Mindestwert vorab prüfen, damit nichts halb gebucht wird
  select coalesce(sum(coalesce(p.sale_cents, p.price_cents) * (x->>'qty')::int), 0) into total
    from jsonb_array_elements(p_items) x join products p on p.id = (x->>'id')::uuid and p.active
   where (x->>'qty')::int between 1 and 10;
  if total < (select value::int from settings where key = 'liefer_min') then return jsonb_build_object('ok', false, 'err', 'mindest', 'summe', total); end if;
  total := 0;
  for it in select * from jsonb_array_elements(p_items) loop
    if (it->>'qty')::int not between 1 and 10 then continue; end if;
    c := k_buy_one(pid, (it->>'id')::uuid, (it->>'qty')::int);
    if c is null then continue; end if;
    total := total + c;
    lst := lst || jsonb_build_object('name', (select name from products where id = (it->>'id')::uuid), 'qty', (it->>'qty')::int);
  end loop;
  -- Buchungen dieser Lieferung merken (für ein sauberes Storno); alle tragen ts = now()
  select array_agg(id), array_agg(sale_id) filter (where sale_id is not null) into lids, sids
    from ledger where person_id = pid and kind = 'kauf' and ts = now();
  -- kein Rückgängig für Lieferungen
  update ledger set ts = null, sale_id = null where id = any(lids);
  insert into deliveries(person_id, office, items, total_cents, ledger_ids, sale_ids) values (pid, o, lst, total, lids, sids) returning id into did;
  perform k_notify('Kiosk-Express: neue Lieferung', 'Büro ' || o || ', ' || jsonb_array_length(lst) || ' Posten. Details in der Kiosk-App.');
  return jsonb_build_object('ok', true, 'id', did, 'summe', total, 'advent', k_advent(pid));
end $$;

-- Lieferstatus für den Kollegen (nur die eigene, neueste Lieferung der letzten 2 Tage)
create or replace function k_delivery(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(x) from (select id, status, rating, tip, total_cents, created_at from deliveries
   where person_id = k_person(p_token) and created_at > now() - interval '2 days' and status <> 'storniert'
   order by created_at desc limit 1) x
$$;

create or replace function k_rate(p_token text, p_id uuid, p_rating int, p_tip text) returns boolean
language plpgsql security definer set search_path = public as $$
declare pid uuid := k_person(p_token); d deliveries;
begin
  select * into d from deliveries where id = p_id and person_id = pid and status = 'geliefert' and rating is null for update;
  if not found or p_rating not between 1 and 5 then return false; end if;
  if p_tip not in ('laecheln', 'danke', '10cent') then p_tip := null; end if;
  update deliveries set rating = p_rating, tip = p_tip where id = d.id;
  if p_tip = '10cent' then insert into ledger(person_id, day, amount_cents, kind) values (pid, today(), 10, 'trinkgeld'); end if;
  return true;
end $$;

-- Verwalter: Status setzen; bei „geliefert“/„storniert“ werden Büro und Artikel gelöscht. Storno bucht den Betrag zurück.
create or replace function a_delivery(p_id uuid, p_status text) returns text
language plpgsql security definer set search_path = public as $$
declare d deliveries;
begin
  if not is_admin() or p_status not in ('unterwegs', 'geliefert', 'storniert') then raise exception 'nicht erlaubt'; end if;
  select * into d from deliveries where id = p_id and status in ('neu', 'unterwegs') for update;
  if not found then return 'fehlt'; end if;
  if p_status = 'storniert' then
    if d.ledger_ids is not null then
      -- Storno nimmt die Lieferung vollständig zurück: Buchungen, Verkäufe und Bestand
      update products p set stock = p.stock + x.qty
        from (select product_id, sum(qty) qty from sales where id = any(d.sale_ids) group by product_id) x where p.id = x.product_id;
      delete from sales where id = any(d.sale_ids);
      delete from ledger where id = any(d.ledger_ids);
    else
      insert into ledger(person_id, day, amount_cents, kind) values (d.person_id, today(), -d.total_cents, 'korrektur');
    end if;
  end if;
  update deliveries set status = p_status,
    office = case when p_status in ('geliefert', 'storniert') then null else office end,
    items = case when p_status in ('geliefert', 'storniert') then null else items end,
    done_at = case when p_status in ('geliefert', 'storniert') then now() else null end
  where id = d.id;
  return 'ok';
end $$;

-- Liefer- und Gewinndaten nicht länger als nötig aufheben
create or replace function k_cleanup() returns void language sql security definer set search_path = public as
$$ update ledger set sale_id = null, ts = null where ts < now() - interval '5 minutes';
   delete from sessions where expires < now();
   update deliveries set office = null, items = null where status in ('neu', 'unterwegs') and created_at < now() - interval '2 days';
   delete from deliveries where created_at < now() - interval '30 days';
   delete from advent_wins where day < current_date - 60; $$;

revoke execute on function k_notify(text, text), k_buy_one(uuid, uuid, int), k_advent(uuid) from public, anon, authenticated;
revoke execute on function a_delivery(uuid, text) from public, anon;
grant execute on function a_delivery(uuid, text) to authenticated;
grant execute on function k_buy(text, uuid, int), k_deliver(text, jsonb, text), k_delivery(text), k_rate(text, uuid, int, text) to anon, authenticated;
