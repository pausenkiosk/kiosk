
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
declare pid uuid := k_person(p_token); it jsonb; c int; total int := 0; lst jsonb := '[]'::jsonb; did uuid; o text := trim(coalesce(p_office, ''));
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
  -- kein Rückgängig für Lieferungen: alle Buchungen dieser Transaktion tragen ts = now()
  update ledger set ts = null, sale_id = null where person_id = pid and kind = 'kauf' and ts = now();
  insert into deliveries(person_id, office, items, total_cents) values (pid, o, lst, total) returning id into did;
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
    insert into ledger(person_id, day, amount_cents, kind) values (d.person_id, today(), -d.total_cents, 'korrektur');
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
