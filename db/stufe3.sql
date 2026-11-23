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
