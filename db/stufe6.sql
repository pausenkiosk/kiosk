
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
