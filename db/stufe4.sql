
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
