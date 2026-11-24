
-- ---------- Ausbaustufe 8: Kiosk-Express an- und ausschalten ----------
insert into settings values ('liefer_aktiv', '1') on conflict do nothing;

-- Öffentliche Kiosk-Infos ohne Personenbezug (nur mit gültigem Kiosk-Code oder Sitzung)
create or replace function k_info(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when k_person(p_token) is null then null
    else jsonb_build_object('liefer_aktiv', coalesce((select value from settings where key = 'liefer_aktiv'), '1') = '1') end
$$;
revoke execute on function k_info(text) from public;
grant execute on function k_info(text) to anon, authenticated;

create or replace function k_deliver(p_token text, p_items jsonb, p_office text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid uuid := k_person(p_token); it jsonb; c int; total int := 0; lst jsonb := '[]'::jsonb; did uuid; o text := trim(coalesce(p_office, '')); lids uuid[]; sids uuid[];
begin
  if pid is null then return jsonb_build_object('ok', false, 'err', 'sitzung'); end if;
  -- gleichzeitige Bestellungen derselben Person nacheinander abarbeiten
  perform pg_advisory_xact_lock(hashtext('deliver:' || pid::text));
  perform k_cleanup();
  if coalesce((select value from settings where key = 'liefer_aktiv'), '1') <> '1' then return jsonb_build_object('ok', false, 'err', 'pause'); end if;
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
grant execute on function k_deliver(text, jsonb, text) to anon, authenticated;
