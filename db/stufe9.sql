-- ---------- Ausbaustufe 9: Lager (bezahlt, noch nicht im Regal) ----------
-- Einkaufsposten mit lager = true sind als Ausgabe gebucht, zählen aber noch nicht zum Bestand im Regal.
-- Ältere App-Fassungen schicken kein "lager" mit und buchen wie bisher direkt ins Regal.
alter table purchase_items add column if not exists lager boolean not null default false;

-- p_items: [{"id": uuid, "qty": int, "cents": int, "mhd": "YYYY-MM-DD"|null, "lager": bool}]
create or replace function a_purchase(p_day date, p_store text, p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare it jsonb; pu uuid; total int := 0; lg boolean;
begin
  if not is_admin() then raise exception 'nicht erlaubt'; end if;
  insert into purchases(day, store) values (p_day, coalesce(p_store, '')) returning id into pu;
  for it in select * from jsonb_array_elements(p_items) loop
    lg := coalesce((it->>'lager')::boolean, false);
    insert into purchase_items(purchase_id, product_id, qty, cents, mhd, lager)
      values (pu, (it->>'id')::uuid, (it->>'qty')::int, (it->>'cents')::int, nullif(it->>'mhd', '')::date, lg);
    update products set stock = stock + case when lg then 0 else (it->>'qty')::int end,
      cost_cents = case when (it->>'qty')::int > 0 then round((it->>'cents')::numeric / (it->>'qty')::int) else cost_cents end
      where id = (it->>'id')::uuid;
    total := total + (it->>'cents')::int;
  end loop;
  insert into journal(day, text, out_cents, kind, ref) values (p_day, 'Einkauf ' || coalesce(p_store, ''), total, 'einkauf', pu);
end $$;

-- Ware aus dem Lager ins Regal stellen (ganz oder teilweise). Keine neue Ausgabe.
create or replace function a_shelve(p_item uuid, p_qty int) returns void
language plpgsql security definer set search_path = public as $$
declare i purchase_items; q int;
begin
  if not is_admin() then raise exception 'nicht erlaubt'; end if;
  select * into i from purchase_items where id = p_item and lager for update;
  if not found then return; end if;
  q := least(greatest(coalesce(p_qty, i.qty), 1), i.qty);
  update products set stock = stock + q where id = i.product_id;
  if q = i.qty then
    update purchase_items set lager = false where id = i.id;
  else
    update purchase_items set qty = qty - q, cents = cents - round(cents::numeric * q / qty) where id = i.id;
    insert into purchase_items(purchase_id, product_id, qty, cents, mhd, lager)
      values (i.purchase_id, i.product_id, q, round(i.cents::numeric * q / i.qty), i.mhd, false);
  end if;
end $$;

-- Ware aus dem Lager entsorgen (als Verlust zum Einkaufspreis). Der Regalbestand bleibt unberührt.
create or replace function a_lager_waste(p_item uuid, p_qty int) returns void
language plpgsql security definer set search_path = public as $$
declare i purchase_items; q int; pr products;
begin
  if not is_admin() then raise exception 'nicht erlaubt'; end if;
  select * into i from purchase_items where id = p_item and lager for update;
  if not found then return; end if;
  q := least(greatest(coalesce(p_qty, i.qty), 1), i.qty);
  select * into pr from products where id = i.product_id;
  insert into sales(product_id, qty, cents, kind, at) values (pr.id, q, q * coalesce(pr.cost_cents, pr.price_cents), 'verlust', now());
  if q = i.qty then delete from purchase_items where id = i.id;
  else update purchase_items set qty = qty - q, cents = cents - round(cents::numeric * q / qty) where id = i.id; end if;
end $$;

revoke execute on function a_shelve(uuid, int), a_lager_waste(uuid, int) from public, anon;
grant execute on function a_shelve(uuid, int), a_lager_waste(uuid, int) to authenticated;

-- Storno eines Einkaufs: nur Ware zurücknehmen, die schon im Regal steht.
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
    for it in select product_id, qty from purchase_items where purchase_id = j.ref and not lager loop
      update products set stock = greatest(stock - it.qty, 0) where id = it.product_id;
    end loop;
    delete from purchases where id = j.ref; delete from journal where id = j.id; return 'ok';
  end if;
  return 'nicht_moeglich';
end $$;
