
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
