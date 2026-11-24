'use strict';
/* Direkte Aufrufe OHNE Anmeldung: Tabellen und Verwalter-Funktionen müssen gesperrt sein. */
const { CFG, step, setGroup, expect, anonApi } = require('./lib');

const TABLES = ['settings', 'admins', 'persons', 'sessions', 'products', 'sales', 'ledger', 'journal', 'purchases',
  'purchase_items', 'counts', 'cash_counts', 'wishes', 'wish_votes', 'alerts', 'requests', 'photo_jobs'];
const NIL = '00000000-0000-0000-0000-000000000000';
/* Alle Verwalter-Funktionen mit harmlosen Werten. */
const ADMIN_FNS = {
  a_claim: { p_code: 'x' },
  a_person: { p_vorname: 'Eindringling', p_pin: '0000' },
  a_persons: { p_names: ['Eindringling'] },
  a_pin: { p_person: NIL, p_pin: '0000' },
  a_person_delete: { p_person: NIL },
  a_pay: { p_person: NIL, p_cents: 1 },
  a_fix: { p_person: NIL, p_cents: 1 },
  a_cash: { p_cents: 1 },
  a_cash_box: { p_cents: 1 },
  a_count: { p_items: [] },
  a_purchase: { p_day: '2020-01-01', p_store: 'x', p_items: [] },
  a_waste: { p_product: NIL, p_qty: 1 },
  a_storno: { p_journal: NIL }
};
/* Interne Helfer und abgeschaltete Funktionen, die ebenfalls nicht offen sein dürfen. */
const OTHER_FNS = {
  is_admin: {}, today: {}, k_code_ok: { p_code: 'x' }, k_person: { p_token: 'x' }, k_cleanup: {},
  k_vote: { p_token: 'x', p_wish: NIL }
};
const INSERTS = {
  settings: { key: 'eindringling', value: '1' },
  products: { name: 'Eindringling', price_cents: 1 },
  journal: { day: '2020-01-01', text: 'Eindringling', in_cents: 1 },
  requests: { text: 'Eindringling' },
  admins: { uid: NIL },
  alerts: { text: 'Eindringling' }
};

module.exports = async function sperren() {
  setGroup('Sperren ohne Anmeldung');
  const api = await anonApi();
  const body = async r => { const t = await r.text(); return t.length > 200 ? t.slice(0, 200) + '…' : t; };

  await step('Gegenprobe: Schlüssel gilt, Namensliste nur mit richtigem Kiosk-Code', async () => {
    const good = await api.post('/rest/v1/rpc/k_names', { data: { p_code: CFG.code } });
    expect(good.status() === 200, `k_names mit richtigem Code: Status ${good.status()} ${await body(good)}`);
    const names = await good.json();
    expect(Array.isArray(names) && names.some(n => n.vorname === 'Anna'), 'k_names liefert die Testpersonen nicht: ' + JSON.stringify(names));
    expect(names.every(n => Object.keys(n).sort().join() === 'id,vorname'), 'k_names liefert mehr als id und vorname');
    const bad = await api.post('/rest/v1/rpc/k_names', { data: { p_code: 'falsch' } });
    expect(bad.status() === 200 && (await bad.json()) === null, `k_names mit falschem Code liefert nicht „nichts“: ${await body(bad)}`);
  });

  for (const t of TABLES) {
    await step(`Tabelle ${t}: Lesen gesperrt`, async () => {
      const r = await api.get(`/rest/v1/${t}?select=*&limit=5`);
      const txt = await body(r);
      expect(r.status() >= 400, `Lesen von ${t} ohne Anmeldung: erwartet Ablehnung (401/403), tatsächlich Status ${r.status()} mit ${txt}`);
    });
  }
  for (const [t, row] of Object.entries(INSERTS)) {
    await step(`Tabelle ${t}: Schreiben gesperrt`, async () => {
      const r = await api.post(`/rest/v1/${t}`, { data: row });
      expect(r.status() >= 400, `Einfügen in ${t} ohne Anmeldung: erwartet Ablehnung, tatsächlich Status ${r.status()} ${await body(r)}`);
    });
  }
  await step('Tabelle products: Ändern und Löschen gesperrt', async () => {
    const u = await api.patch('/rest/v1/products?name=eq.Cola', { data: { price_cents: 1 } });
    expect(u.status() >= 400, `Ändern ohne Anmeldung: Status ${u.status()} ${await body(u)}`);
    const d = await api.delete('/rest/v1/products?name=eq.Cola');
    expect(d.status() >= 400, `Löschen ohne Anmeldung: Status ${d.status()} ${await body(d)}`);
  });
  for (const [fn, args] of Object.entries(ADMIN_FNS)) {
    await step(`Funktion ${fn}: gesperrt`, async () => {
      const r = await api.post(`/rest/v1/rpc/${fn}`, { data: args });
      expect(r.status() >= 400, `${fn} ohne Anmeldung: erwartet Ablehnung, tatsächlich Status ${r.status()} ${await body(r)}`);
      const txt = await r.text();
      expect(/permission denied|42501|PGRST202|PGRST301|not find/i.test(txt), `${fn}: abgelehnt, aber nicht wegen fehlender Rechte: ${txt.slice(0, 200)}`);
    });
  }
  for (const [fn, args] of Object.entries(OTHER_FNS)) {
    await step(`Hilfsfunktion ${fn}: gesperrt`, async () => {
      const r = await api.post(`/rest/v1/rpc/${fn}`, { data: args });
      expect(r.status() >= 400, `${fn} ohne Anmeldung: erwartet Ablehnung, tatsächlich Status ${r.status()} ${await body(r)}`);
    });
  }
  await step('Kollegen-Funktionen ohne gültige Sitzung liefern nichts', async () => {
    const st = await api.post('/rest/v1/rpc/k_state', { data: { p_token: 'erfunden' } });
    expect(st.status() === 200 && (await st.json()) === null, `k_state mit erfundener Sitzung: ${await body(st)}`);
    const buy = await api.post('/rest/v1/rpc/k_buy', { data: { p_token: 'erfunden', p_product: NIL, p_qty: 1 } });
    const b = await buy.json();
    expect(b && b.ok === false && b.err === 'sitzung', `k_buy mit erfundener Sitzung: ${JSON.stringify(b)}`);
    const pin = await api.post('/rest/v1/rpc/k_pin', { data: { p_token: 'erfunden', p_old: '1111', p_new: '2222' } });
    expect((await pin.json()) === false, `k_pin mit erfundener Sitzung: ${await body(pin)}`);
    const wish = await api.post('/rest/v1/rpc/k_wish', { data: { p_token: 'erfunden', p_text: 'Eindringling-Wunsch' } });
    expect(wish.status() < 300, `k_wish ist für Kollegen freigegeben, Status ${wish.status()} ${await body(wish)}`);   // ob wirklich nichts angelegt wurde, prüft der Teil „wunsch“
    const login = await api.post('/rest/v1/rpc/k_login', { data: { p_code: 'falsch', p_person: NIL, p_pin: '1111' } });
    const l = await login.json();
    expect(l && l.ok === false && l.err === 'code', `k_login mit falschem Kiosk-Code: ${JSON.stringify(l)}`);
  });
  await step('Fotospeicher: ohne Anmeldung nichts sichtbar, kein Hochladen', async () => {
    const ls = await api.post('/storage/v1/object/list/fotos', { data: { prefix: 'regal', limit: 10 } });
    const j = await ls.json().catch(() => null);
    expect(ls.status() >= 400 || (Array.isArray(j) && j.length === 0), `Liste des Fotospeichers ohne Anmeldung: Status ${ls.status()} ${JSON.stringify(j).slice(0, 200)}`);
    const up = await api.post('/storage/v1/object/fotos/regal/eindringling.jpg', { headers: { 'Content-Type': 'image/jpeg' }, data: Buffer.from('x') });
    expect(up.status() >= 400, `Hochladen ohne Anmeldung: Status ${up.status()} ${await body(up)}`);
  });
  await api.dispose();
};
