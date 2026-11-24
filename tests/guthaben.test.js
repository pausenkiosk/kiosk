'use strict';
/* Guthaben aufladen (Ausbaustufe 4). Zwei Browser: Verwalter und Kollege „Karl“, dazu „Lena“ für Gegenproben.
   Eigene Testprodukte (1,20 / 1,00 / 0,50) und eigene Personen, damit der Teil für sich allein rechnet. */
const { CFG, step, setGroup, expect, eq, newPage, toast, hideToast, idle, fillModal, anzahl, listSaldo, pickName, see, prow, rowHas, lnIs, lnValue, anonApi } = require('./lib');

const eur = c => (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NIL = '00000000-0000-0000-0000-000000000000';

module.exports = async function guthaben(browser) {
  setGroup('Guthaben');
  const page = await newPage(browser);     // Verwalter
  const kp = await newPage(browser);       // Kollege Karl
  const S = (n, f) => step(n, f, page), K = (n, f) => step(n, f, kp);
  const tab = async t => { await idle(page); await page.locator(`#nav [data-t="${t}"]`).click(); await page.locator(`#nav [data-t="${t}"].on`).waitFor(); };
  const db = (table, select, filterCol, filterVal) => page.evaluate(async ([t, s, c, v]) => {
    let q = SB.from(t).select(s); if (c) q = q.eq(c, v);
    const { data, error } = await q; if (error) throw new Error(error.message); return data;
  }, [table, select, filterCol, filterVal]);
  const rpc = (fn, args) => page.evaluate(async ([f, a]) => { const { data, error } = await SB.rpc(f, a); return error ? { error: error.message } : { data }; }, [fn, args]);
  const adminReload = async () => { await page.reload(); await page.locator('#nav:not([hidden])').waitFor(); };
  const person = async n => (await db('persons', 'id,vorname', 'vorname', n))[0];
  const saldo = async n => (await db('ledger', 'amount_cents', 'person_id', (await person(n)).id)).reduce((a, l) => a + l.amount_cents, 0);
  const journalN = async () => (await db('journal', 'id')).length;
  const stand = async () => { const j = await db('journal', 'in_cents,out_cents'); return j.reduce((a, x) => a + x.in_cents - x.out_cents, 0); };
  /* Einzahlung über die Oberfläche; liefert [Text im Dialog, Hinweis danach] */
  const einzahlung = async (name, amount, reload = true) => {
    if (reload) await adminReload();
    await tab('leute'); await hideToast(page);
    await prow(page, name).locator('[data-a="a-pay"]').click();
    const m = page.locator('#modal:not([hidden])');
    await m.locator('h2', { hasText: 'Einzahlung von ' + name }).waitFor();
    const intro = (await m.locator('p.small').first().innerText()).trim();
    await fillModal(page, 'Einzahlung von ' + name, { c: amount });
    await page.waitForFunction(() => { const t = document.querySelector('#toast'); return !t.hidden && /^Gebucht\. /.test(t.textContent); });
    const hint = await page.locator('#toast').innerText();
    await idle(page);
    return [intro, hint];
  };
  /* Kollege schreibt über die Oberfläche an (höchstens 5 je Buchung) */
  const kauf = async (name, qty) => {
    await idle(kp); await hideToast(kp);
    await kp.locator('button.it', { hasText: name }).click();
    await anzahl(kp, name, qty);
    await toast(kp, new RegExp(name + ' angeschrieben'));
    await idle(kp);
  };
  let code = null, n0 = 0, stand0 = 0;

  await S('Vorbereitung: Verwalter anmelden, Testprodukte und Personen Karl und Lena anlegen, Kassensturz als Ausgangspunkt', async () => {
    await page.goto(CFG.url + '#verwaltung');
    await page.locator('#alog').waitFor();
    await page.fill('#em', CFG.email); await page.fill('#pw', CFG.pw);
    await page.locator('#alog button.pri').click();
    await see(page, 'KASSENSTAND');
    code = (await db('settings', 'value', 'key', 'kiosk_code'))[0].value;
    await page.evaluate(async () => {
      const { error } = await SB.from('products').insert([
        { name: 'G-Limo', category: 'Guthabentest', price_cents: 120, stock: 50 },
        { name: 'G-Riegel', category: 'Guthabentest', price_cents: 100, stock: 50 },
        { name: 'G-Bonbon', category: 'Guthabentest', price_cents: 50, stock: 50 }]);
      if (error) throw new Error(error.message);
    });
    for (const [n, p] of [['Karl', '6161'], ['Lena', '6262']]) { const r = await rpc('a_person', { p_vorname: n, p_pin: p }); expect(!r.error, `a_person ${n}: ${r.error}`); }
    const r = await rpc('a_cash_box', { p_cents: 0 });   // ab hier zählen nur die Einzahlungen dieses Teils
    expect(!r.error, 'a_cash_box: ' + r.error);
    n0 = await journalN(); stand0 = await stand();
  });
  await K('Kollege ohne Schulden: „OFFEN 0,00“ und Hinweis aufs Aufladen', async () => {
    expect(code, 'Vorbereitung fehlgeschlagen');
    await kp.goto(`${CFG.url}?k=${code}`);
    await pickName(kp, 'Karl');
    await kp.fill('#pin', '6161');
    await kp.locator('#kpin button.pri').click();
    await kp.locator('[data-a="k-consent"]').click();
    await see(kp, 'Schuldschein von Karl');
    await lnIs(kp, 'OFFEN', '0,00 €');
    await see(kp, 'Bezahlen oder Guthaben aufladen: Betrag dem Betreiber geben, er trägt ihn ein.');
  });
  await S('Einzahlung 20,00 ohne offenen Betrag: Dialog sagt „wird Guthaben“, Hinweis nennt das neue Guthaben', async () => {
    const [intro, hint] = await einzahlung('Karl', '20,00');
    eq(intro, 'Nichts offen. Der Betrag wird Guthaben.', 'Text im Dialog');
    eq(hint, 'Gebucht. Karl hat jetzt 20,00 € Guthaben.', 'Hinweis');
    eq(await saldo('Karl'), -2000, 'Saldo Karl in Cent');
  });
  await S('Verwalter-Liste zeigt das Guthaben von 20,00 als Guthaben, nicht als „-20,00“', async () => {
    eq(await listSaldo(page, 'Karl'), -2000, 'Anzeige bei Karl (Cent, negativ = Guthaben)');
    expect(!(await page.locator('#app .paper').first().innerText()).includes('-20,00'), 'Negativer Betrag in der Liste');
  });
  await S('Kassenbuch: Einzahlung ist eine Einnahme (20,00, Art „zahlung“)', async () => {
    eq(await journalN(), n0 + 1, 'Anzahl Kassenbuch-Zeilen');
    eq(await stand(), stand0 + 2000, 'Kassenstand in Cent');
    const z = (await db('journal', 'in_cents,kind,text,at', 'kind', 'zahlung')).sort((a, b) => a.at < b.at ? 1 : -1)[0];
    eq(`${z.text}/${z.in_cents}`, 'Zahlung Schuldschein/2000', 'neueste Zahlungs-Zeile');
  });
  await S('Bon trennt „Offene Schuldscheine“ (nur Schulden) und „Guthaben der Kollegen“ (nur Guthaben)', async () => {
    const saldi = {}; (await db('ledger', 'person_id,amount_cents')).forEach(l => { saldi[l.person_id] = (saldi[l.person_id] || 0) + l.amount_cents; });
    const offen = Object.values(saldi).filter(v => v > 0).reduce((a, v) => a + v, 0), gut = -Object.values(saldi).filter(v => v < 0).reduce((a, v) => a + v, 0);
    expect(gut >= 2000, 'Guthaben laut Datenbank: ' + gut);
    await tab('bon');
    await lnIs(page, 'Offene Schuldscheine', eur(offen));
    await lnIs(page, 'Guthaben der Kollegen', eur(gut));
  });
  await K('Kollege sieht „DEIN GUTHABEN 20,00“, den Guthaben-Hinweis und die Einzahlung in seinen Buchungen', async () => {
    await kp.reload();
    await lnIs(kp, 'DEIN GUTHABEN', '20,00 €');
    await see(kp, 'Einkäufe werden von deinem Guthaben abgezogen. Ist es aufgebraucht, schreibst du wie gewohnt an.');
    await rowHas(kp, 'Einzahlung', /20,00/);
    expect(await kp.locator('#app .it', { hasText: 'Einzahlung' }).locator('[data-a="k-undo"]').count() === 0, 'Einzahlung hat einen Rückgängig-Knopf');
  });
  await K('Anschreiben vom Guthaben: 8 × 1,20, dann 9 × 1,00 – Guthaben sinkt auf 10,40 und 1,40', async () => {
    await kauf('G-Limo', 5); await kauf('G-Limo', 3);
    await lnIs(kp, 'DEIN GUTHABEN', '10,40 €');
    await kauf('G-Riegel', 5); await kauf('G-Riegel', 4);
    await lnIs(kp, 'DEIN GUTHABEN', '1,40 €');
  });
  await K('Guthaben aufgebraucht: nach 3 × 0,50 steht „OFFEN 0,10“ und wieder der normale Hinweis', async () => {
    await kauf('G-Bonbon', 3);
    await lnIs(kp, 'OFFEN', '0,10 €');
    await see(kp, 'Bezahlen oder Guthaben aufladen');
    expect(!(await kp.locator('#app').innerText()).includes('DEIN GUTHABEN'), '„DEIN GUTHABEN“ steht trotz Schulden da');
  });
  await S('Anschreiben vom Guthaben erzeugt keine weitere Einnahme; Kassenstand unverändert', async () => {
    eq(await journalN(), n0 + 1, 'Anzahl Kassenbuch-Zeilen');
    eq(await stand(), stand0 + 2000, 'Kassenstand in Cent');
    eq(await saldo('Karl'), 10, 'Saldo Karl in Cent');
    eq((await db('products', 'stock', 'name', 'G-Limo'))[0].stock, 42, 'Bestand G-Limo');
  });
  await K('Rückgängig innerhalb von 5 Minuten stellt das Guthaben wieder her (1,40)', async () => {
    await hideToast(kp);
    await kp.locator('[data-a="k-undo"]').first().click();   // neueste Buchung: 3 × 0,50
    await toast(kp, /Buchung zurückgenommen\./);
    await lnIs(kp, 'DEIN GUTHABEN', '1,40 €');
    await idle(kp);
    await kauf('G-Bonbon', 3);
    await lnIs(kp, 'OFFEN', '0,10 €');
  });
  await S('Zweite Aufladung bei offenem Betrag: offen 0,10, Einzahlung 20,00 → Guthaben 19,90', async () => {
    const [intro, hint] = await einzahlung('Karl', '20');
    eq(intro, 'Offen: 0,10 €. Alles darüber wird Guthaben.', 'Text im Dialog');
    eq(hint, 'Gebucht. Karl hat jetzt 19,90 € Guthaben.', 'Hinweis');
    eq(await listSaldo(page, 'Karl'), -1990, 'Anzeige bei Karl (Cent, negativ = Guthaben)');
    await kp.reload();
    await lnIs(kp, 'DEIN GUTHABEN', '19,90 €');
  });
  await S('Aufladen bei vorhandenem Guthaben: Dialog nennt das Guthaben, Betrag kommt dazu', async () => {
    const [intro, hint] = await einzahlung('Karl', '0,10');
    eq(intro, 'Vorhandenes Guthaben: 19,90 €. Der Betrag kommt dazu.', 'Text im Dialog');
    eq(hint, 'Gebucht. Karl hat jetzt 20,00 € Guthaben.', 'Hinweis');
  });
  await S('Einzahlung unter dem offenen Betrag nennt den Rest; genau der Rest gleicht aus', async () => {
    const api = await anonApi();
    const lena = await person('Lena');
    const l = await (await api.post('/rest/v1/rpc/k_login', { data: { p_code: code, p_person: lena.id, p_pin: '6262' } })).json();
    expect(l.ok, 'Anmeldung Lena: ' + JSON.stringify(l));
    await api.post('/rest/v1/rpc/k_consent', { data: { p_token: l.token } });
    const limo = (await db('products', 'id', 'name', 'G-Limo'))[0].id;
    const b = await (await api.post('/rest/v1/rpc/k_buy', { data: { p_token: l.token, p_product: limo, p_qty: 1 } })).json();
    expect(b.ok, 'Kauf Lena: ' + JSON.stringify(b));
    await api.post('/rest/v1/rpc/k_logout', { data: { p_token: l.token } }); await api.dispose();
    let [intro, hint] = await einzahlung('Lena', '1,00');
    eq(intro, 'Offen: 1,20 €. Alles darüber wird Guthaben.', 'Text im Dialog');
    eq(hint, 'Gebucht. Noch offen: 0,20 €.', 'Hinweis');
    [intro, hint] = await einzahlung('Lena', '0,20');
    eq(hint, 'Gebucht. Schuldschein ist ausgeglichen.', 'Hinweis');
    eq(await listSaldo(page, 'Lena'), 0, 'Anzeige bei Lena');
  });
  await S('Einzahlungs-Dialog und Hinweis stimmen auch, wenn der Kollege seit dem Laden der Verwaltung angeschrieben hat', async () => {
    await adminReload();                 // Verwalter hat die Seite offen (Karl: Guthaben 20,00) …
    await kauf('G-Limo', 1);             // … inzwischen schreibt Karl 1,20 an (Guthaben 18,80)
    const [intro, hint] = await einzahlung('Karl', '1,20', false);
    await adminReload(); await tab('leute');
    eq(await listSaldo(page, 'Karl'), -2000, 'Anzeige bei Karl nach dem Neuladen (Cent)');
    eq(intro, 'Vorhandenes Guthaben: 18,80 €. Der Betrag kommt dazu.', 'Text im Dialog');
    eq(hint, 'Gebucht. Karl hat jetzt 20,00 € Guthaben.', 'Hinweis');
  });
  await S('Kassensturz nach Kasseninhalt zieht alle Einzahlungen ab (20 + 20 + 0,10 + 1,00 + 0,20 + 1,20 = 42,50)', async () => {
    await tab('kasse'); await hideToast(page);
    await page.locator('#app [data-a="a-cash"]').click();
    await fillModal(page, 'Kassensturz', { c: '50,00' });
    await toast(page, /^Gebucht: 7,50 € Barverkäufe, 42,50 € stammen aus Einzahlungen\.$/);
    await idle(page);
  });
  await S('Rangliste zählt nur Käufe, keine Einzahlungen', async () => {
    await tab('leute');
    const rows = await page.locator('#app .paper').nth(1).locator('tr').evaluateAll(trs => trs.slice(1).map(tr => [...tr.children].map(td => td.textContent).join('|')));
    expect(rows.includes('Karl|21,30|21,30'), 'Rangliste Karl (Käufe 9,60 + 9,00 + 1,50 + 1,20): ' + rows.filter(r => r.startsWith('Karl')).join());
    expect(rows.includes('Lena|1,20|1,20'), 'Rangliste Lena: ' + rows.filter(r => r.startsWith('Lena')).join());
  });
  await S('Person mit Guthaben lässt sich nicht löschen', async () => {
    await idle(page); await hideToast(page);
    await prow(page, 'Karl').locator('[data-a="a-more"]').click();
    await fillModal(page, 'Karl', { a: 'del', x: '' });
    await toast(page, /Nicht gelöscht: Der Schuldschein ist nicht ausgeglichen\./);
    expect(await person('Karl'), 'Karl wurde trotz Guthaben gelöscht');
  });

  /* ---------- Abschottung: niemand kommt an fremdes Guthaben, niemand macht aus Guthaben Geld ---------- */
  await S('Anderer Kollege sieht kein fremdes Guthaben und keine fremden Buchungen', async () => {
    const api = await anonApi();
    const lena = await person('Lena'), karl = await person('Karl');
    const l = await (await api.post('/rest/v1/rpc/k_login', { data: { p_code: code, p_person: lena.id, p_pin: '6262' } })).json();
    const st = await (await api.post('/rest/v1/rpc/k_state', { data: { p_token: l.token } })).json();
    eq(Object.keys(st).sort().join(','), 'consent,entries,products,saldo,vorname', 'Felder in k_state');
    eq(st.saldo, 0, 'Saldo Lena'); eq(st.entries.length, 3, 'Buchungen Lena (1 Kauf, 2 Einzahlungen)');
    const raw = JSON.stringify(st);
    expect(!raw.includes('Karl') && !raw.includes(karl.id), 'k_state von Lena enthält Angaben zu Karl');
    const names = await (await api.post('/rest/v1/rpc/k_names', { data: { p_code: code } })).json();
    expect(names.every(n => Object.keys(n).sort().join() === 'id,vorname'), 'Namensliste enthält mehr als id und vorname');
    // Lena versucht, eine Buchung von Karl zurückzunehmen bzw. auf Karls Kosten zu kaufen: geht nicht, Karls Saldo bleibt.
    const before = await saldo('Karl');
    const kEntries = await db('ledger', 'id,kind,ts', 'person_id', karl.id);
    for (const e of kEntries.filter(x => x.kind === 'kauf' && x.ts).slice(0, 3)) {
      const u = await (await api.post('/rest/v1/rpc/k_undo', { data: { p_token: l.token, p_entry: e.id } })).json();
      eq(JSON.stringify(u), '{"ok":false}', 'Lena nimmt Karls Buchung zurück');
    }
    eq(await saldo('Karl'), before, 'Saldo Karl nach den Versuchen');
    await api.post('/rest/v1/rpc/k_logout', { data: { p_token: l.token } }); await api.dispose();
  });
  await S('Kollege kann sein Guthaben nicht selbst erhöhen oder auszahlen (negative Menge, Einzahlung zurücknehmen, Verwalter-Funktionen)', async () => {
    const token = await kp.evaluate(() => localStorage.getItem('ktoken'));
    const api = await anonApi();
    const before = await saldo('Karl');
    const limo = (await db('products', 'id', 'name', 'G-Limo'))[0].id, karl = await person('Karl');
    for (const q of [-5, 0, 11]) {
      const r = await (await api.post('/rest/v1/rpc/k_buy', { data: { p_token: token, p_product: limo, p_qty: q } })).json();
      eq(JSON.stringify(r), '{"ok":false,"err":"menge"}', `Kauf mit Menge ${q}`);
    }
    const zahl = (await db('ledger', 'id,kind', 'person_id', karl.id)).filter(x => x.kind === 'zahlung');
    for (const z of zahl) {
      const u = await (await api.post('/rest/v1/rpc/k_undo', { data: { p_token: token, p_entry: z.id } })).json();
      eq(JSON.stringify(u), '{"ok":false}', 'Rückgängig auf eine Einzahlung');
    }
    for (const [fn, args] of [['a_pay', { p_person: karl.id, p_cents: 5000 }], ['a_fix', { p_person: karl.id, p_cents: -5000 }]]) {
      const r = await api.post('/rest/v1/rpc/' + fn, { data: args });
      expect(r.status() >= 400, `${fn} als Kollege: Status ${r.status()}`);
    }
    const w = await api.post('/rest/v1/ledger', { data: { person_id: karl.id, day: '2026-01-01', amount_cents: -5000, kind: 'zahlung' } });
    expect(w.status() >= 400, 'Direktes Schreiben in den Schuldschein: Status ' + w.status());
    eq(await saldo('Karl'), before, 'Saldo Karl nach den Versuchen');
    await api.dispose();
  });
  await S('Doppeltes Rückgängig bringt kein doppeltes Guthaben', async () => {
    await kauf('G-Riegel', 1);
    const token = await kp.evaluate(() => localStorage.getItem('ktoken'));
    const karl = await person('Karl');
    const before = await saldo('Karl'), stock = (await db('products', 'stock', 'name', 'G-Riegel'))[0].stock;
    const e = (await db('ledger', 'id,kind,ts,amount_cents', 'person_id', karl.id)).filter(x => x.ts).sort((a, b) => a.ts < b.ts ? 1 : -1)[0];
    const api = await anonApi();
    const rs = await Promise.all([1, 2, 3].map(() => api.post('/rest/v1/rpc/k_undo', { data: { p_token: token, p_entry: e.id } }).then(r => r.json())));
    await api.dispose();
    eq(await saldo('Karl'), before - 100, 'Saldo Karl nach dreifachem gleichzeitigem Rückgängig');
    eq((await db('products', 'stock', 'name', 'G-Riegel'))[0].stock, stock + 1, 'Bestand G-Riegel nach dreifachem gleichzeitigem Rückgängig (Antworten: ' + JSON.stringify(rs) + ')');
  });
  await S('Keine Fehler in der Browser-Konsole (Guthaben)', async () => {
    const real = [...page.problems, ...kp.problems].filter(p => !/favicon/i.test(p));
    expect(real.length === 0, real.join(' · '));
  });
  await kp.context().close();
  await page.context().close();
};
