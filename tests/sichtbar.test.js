'use strict';
/* Francos Wünsche (ab app.js v25):
   3. Kollegen-Seite „PIN ändern“: neue PIN zweimal eingeben.
   4. Kollegen sehen nur Produkte, die laut App gerade im Regal liegen (Bestand über 0). */
const { CFG, step, setGroup, expect, eq, newPage, toast, hideToast, idle, fillModal, anzahl, pickName, see, lnIs, anonApi } = require('./lib');

module.exports = async function sichtbar(browser) {
  setGroup('Sichtbare Produkte und PIN-Wiederholung');
  const page = await newPage(browser);     // Verwalter
  const kp = await newPage(browser);       // Kollegin Zoe
  const S = (n, f) => step(n, f, page), K = (n, f) => step(n, f, kp);
  const db = (table, select, filterCol, filterVal) => page.evaluate(async ([t, s, c, v]) => {
    let q = SB.from(t).select(s); if (c) q = q.eq(c, v);
    const { data, error } = await q; if (error) throw new Error(error.message); return data;
  }, [table, select, filterCol, filterVal]);
  const rpc = (fn, args) => page.evaluate(async ([f, a]) => { const { data, error } = await SB.rpc(f, a); return error ? { error: error.message } : { data }; }, [fn, args]);
  const must = async (fn, args) => { const r = await rpc(fn, args); expect(!r.error, `${fn}: ${r.error}`); return r.data; };
  const pid = async n => (await db('products', 'id,stock', 'name', n))[0];
  let code = null, zoe = null;
  const kReload = async () => { await kp.reload(); await see(kp, 'Schuldschein von Zoe'); };
  /* was die Kollegin im Abschnitt „Bestand und Anschreiben“ von den Testprodukten sieht */
  const sicht = () => kp.locator('#app .paper', { hasText: 'Bestand und Anschreiben' }).evaluate(p => ({
    produkte: [...p.querySelectorAll('button.it')].map(b => b.children[1].textContent.trim()).filter(n => n.startsWith('S-')),
    gruppen: [...p.querySelectorAll('h2')].map(h => h.textContent.replace(/\s*i$/, '').trim()).filter(g => g.startsWith('Sichttest')),
    aus: [...p.querySelectorAll('button.it')].filter(b => /\baus\b/.test(b.children[2].textContent)).length }));
  const kauf = async (name, qty) => { await idle(kp); await hideToast(kp); await kp.locator('button.it', { hasText: name }).click(); await anzahl(kp, name, qty); await toast(kp, /angeschrieben/); await idle(kp); };

  await S('Vorbereitung: anmelden, Testprodukte (voll, leer, letztes Stück, Abverkauf) und Kollegin Zoe anlegen', async () => {
    await page.goto(CFG.url + '#verwaltung');
    await page.locator('#alog').waitFor();
    await page.fill('#em', CFG.email); await page.fill('#pw', CFG.pw);
    await page.locator('#alog button.pri').click();
    await see(page, 'KASSENSTAND');
    code = (await db('settings', 'value', 'key', 'kiosk_code'))[0].value;
    await page.evaluate(async () => {
      const { error } = await SB.from('products').insert([
        { name: 'S-Voll', category: 'Sichttest', price_cents: 100, stock: 3 },
        { name: 'S-Letzter', category: 'Sichttest', price_cents: 70, stock: 1 },
        { name: 'S-Angebot', category: 'Sichttest', price_cents: 100, sale_cents: 60, stock: 2 },
        { name: 'S-Leer', category: 'Sichttest leer', price_cents: 200, stock: 0 }]);
      if (error) throw new Error(error.message);
    });
    zoe = await must('a_person', { p_vorname: 'Zoe', p_pin: '6767' });
  });
  await K('Kollegin sieht nur Produkte mit Bestand; das leere Produkt und seine Gruppe fehlen, nichts steht als „aus“ da', async () => {
    await kp.goto(`${CFG.url}?k=${code}`);
    await pickName(kp, 'Zoe');
    await kp.fill('#pin', '6767'); await kp.locator('#kpin button.pri').click();
    await kp.locator('[data-a="k-consent"]').click();
    await see(kp, 'Schuldschein von Zoe');
    const s = await sicht();
    eq(s.produkte.slice().sort().join(','), 'S-Angebot Abverkauf,S-Letzter,S-Voll', 'sichtbare Testprodukte');
    eq(s.gruppen.join(','), 'Sichttest', 'sichtbare Gruppen'); eq(s.aus, 0, 'Zeilen mit „aus“');
    const all = await kp.locator('#app .paper', { hasText: 'Bestand und Anschreiben' }).locator('button.it').evaluateAll(bs => bs.map(b => b.children[2].textContent.trim()));
    expect(all.every(t => /^\d+ St$/.test(t)), 'Zeilen ohne Stückzahl über 0: ' + all.filter(t => !/^\d+ St$/.test(t)).join(', '));
  });
  await K('Abverkaufspreis bei sichtbarem Produkt: Kennzeichnung, durchgestrichener Normalpreis, neuer Preis', async () => {
    const r = kp.locator('button.it', { hasText: 'S-Angebot' });
    eq((await r.innerText()).replace(/\s+/g, ' ').trim(), 'S-Angebot Abverkauf 2 St 1,00 0,60 €', 'Zeile');
    eq((await r.locator('s').innerText()).trim(), '1,00', 'durchgestrichener Preis');
  });
  await S('Verwaltung, Regal: das leere Produkt steht weiterhin in der Liste', async () => {
    await page.reload(); await page.locator('#nav:not([hidden])').waitFor();
    await page.locator('#nav [data-t="regal"]').click();
    await page.locator('#app button.it', { hasText: 'S-Leer' }).waitFor();
    expect(/0 St/.test(await page.locator('#app button.it', { hasText: 'S-Leer' }).innerText()), 'Bestand von S-Leer in der Verwaltung');
  });
  await K('Letztes Stück angeschrieben: Produkt verschwindet (sofort und nach dem Neuladen)', async () => {
    await kauf('S-Letzter', 1);
    eq((await sicht()).produkte.includes('S-Letzter'), false, 'S-Letzter direkt nach dem Kauf sichtbar');
    await kReload();
    eq((await sicht()).produkte.includes('S-Letzter'), false, 'S-Letzter nach dem Neuladen sichtbar');
    await lnIs(kp, 'OFFEN', '0,70 €');
  });
  await K('Rückgängig bringt das Produkt zurück', async () => {
    await hideToast(kp);
    await kp.locator('[data-a="k-undo"]').first().click();
    await toast(kp, /Buchung zurückgenommen\./);
    await idle(kp);
    eq((await sicht()).produkte.includes('S-Letzter'), true, 'S-Letzter nach Rückgängig sichtbar');
    eq((await pid('S-Letzter')).stock, 1, 'Bestand S-Letzter');
  });
  await K('Nach einem Einkauf erscheint das bisher leere Produkt samt Gruppe', async () => {
    const p = await pid('S-Leer');
    await must('a_purchase', { p_day: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date()), p_store: 'Sichttest', p_items: [{ id: p.id, qty: 4, cents: 400, mhd: '' }] });
    await kReload();
    const s = await sicht();
    expect(s.produkte.includes('S-Leer') && s.gruppen.includes('Sichttest leer'), 'sichtbar: ' + JSON.stringify(s));
    expect(/4 St/.test(await kp.locator('button.it', { hasText: 'S-Leer' }).innerText()), 'Stückzahl von S-Leer');
  });
  await K('Zählung auf 0 blendet aus, Zählung auf 2 blendet wieder ein', async () => {
    const p = await pid('S-Leer');
    await must('a_count', { p_items: [{ id: p.id, qty: 0 }] });
    await kReload();
    eq((await sicht()).produkte.includes('S-Leer'), false, 'S-Leer nach Zählung 0 sichtbar');
    await must('a_count', { p_items: [{ id: p.id, qty: 2 }] });
    await kReload();
    eq((await sicht()).produkte.includes('S-Leer'), true, 'S-Leer nach Zählung 2 sichtbar');
    await must('a_count', { p_items: [{ id: p.id, qty: 0 }] });
  });
  await K('Ausgeblendet heißt nur „nicht angezeigt“: der direkte Aufruf bucht weiterhin (so gewollt)', async () => {
    const p = await pid('S-Leer');
    const r = await kp.evaluate(async id => (await SB.rpc('k_buy', { p_token: K.token, p_product: id, p_qty: 1 })).data, p.id);
    eq(r && r.ok, true, 'k_buy auf Bestand 0');
    eq((await pid('S-Leer')).stock, 0, 'Bestand S-Leer bleibt 0');
    await kReload();
    await lnIs(kp, 'OFFEN', '2,00 €');
    const e = (await db('ledger', 'id,kind,ts', 'person_id', zoe)).filter(x => x.ts)[0];
    await kp.evaluate(async id => { await SB.rpc('k_undo', { p_token: K.token, p_entry: id }); }, e.id);
  });
  await K('Ist gar nichts im Regal eingetragen, steht ein Hinweis statt einer leeren Liste', async () => {
    const before = await db('products', 'id,stock');
    await page.evaluate(async () => { const { error } = await SB.from('products').update({ stock: 0 }).gt('stock', 0); if (error) throw new Error(error.message); });
    try {
      await kReload();
      await see(kp, 'Gerade ist nichts im Regal eingetragen.');
      eq(await kp.locator('#app .paper', { hasText: 'Bestand und Anschreiben' }).locator('button.it, h2:not(:first-child)').count(), 0, 'Produkte und Gruppen');
    } finally {
      await page.evaluate(async rows => { for (const r of rows) await SB.from('products').update({ stock: r.stock }).eq('id', r.id); }, before.filter(r => r.stock > 0));
    }
    await kReload();
    expect((await sicht()).produkte.includes('S-Voll'), 'Produkte nach dem Wiederherstellen nicht sichtbar');
  });
  await K('Erklärung „i“ zu Bestand und Anschreiben passt dazu', async () => {
    await kp.locator('#app .ii[data-k="k_buy"]').click();
    await see(kp, 'Angezeigt wird, was laut App im Regal liegt. Fehlt etwas, das du vor dir siehst, sag dem Betreiber Bescheid oder zahle bar.', '#modal');
    await kp.locator('#modal button', { hasText: 'OK' }).click();
  });

  /* ---------- PIN ändern mit Wiederholung ---------- */
  const pinOk = async p => {
    const api = await anonApi();
    const l = await (await api.post('/rest/v1/rpc/k_login', { data: { p_code: code, p_person: zoe, p_pin: p } })).json();
    if (l.ok) await api.post('/rest/v1/rpc/k_logout', { data: { p_token: l.token } });
    else if (l.err === 'pin') await must('a_pin', { p_person: zoe, p_pin: '6767' }).catch(() => {});   // Fehlversuch nicht stehen lassen
    await api.dispose();
    return l.ok === true;
  };
  const pinDialog = async (o, n, w) => {
    await idle(kp); await hideToast(kp);
    await kp.locator('[data-a="k-pin"]').click();
    await fillModal(kp, 'PIN ändern', { o, n, w });
    await kp.waitForFunction(() => !document.querySelector('#toast').hidden);
    const t = await kp.locator('#toast').innerText();
    await idle(kp);
    return t;
  };
  await K('PIN ändern: drei Felder (alte PIN, neue PIN, neue PIN wiederholen), alle verdeckt und auf 4 Zeichen begrenzt', async () => {
    await kp.locator('[data-a="k-pin"]').click();
    const m = kp.locator('#modal:not([hidden])');
    eq((await m.locator('label').allInnerTexts()).join(' | '), 'Alte PIN | Neue PIN (4 Ziffern) | Neue PIN wiederholen', 'Felder');
    eq((await m.locator('input').evaluateAll(is => is.map(i => `${i.type}/${i.maxLength}/${i.inputMode}`))).join(' '), 'password/4/numeric password/4/numeric password/4/numeric', 'Art der Felder');
    await m.locator('[data-a="m-x"]').click(); await idle(kp);
  });
  await K('Zwei verschiedene neue PINs: nicht geändert, alte PIN gilt weiter', async () => {
    eq(await pinDialog('6767', '1234', '1243'), 'Nicht geändert: Die beiden neuen PINs sind nicht gleich.', 'Hinweis');
    eq(await pinDialog('6767', '1234', ''), 'Nicht geändert: Die beiden neuen PINs sind nicht gleich.', 'Hinweis bei leerer Wiederholung');
    eq(await pinOk('6767'), true, 'alte PIN gilt noch');
  });
  await K('Zweimal dieselbe, aber zu kurze PIN: nicht geändert', async () => {
    eq(await pinDialog('6767', '12', '12'), 'Nicht geändert: alte PIN falsch oder neue PIN keine 4 Ziffern.', 'Hinweis');
    eq(await pinOk('6767'), true, 'alte PIN gilt noch');
  });
  await K('Zweimal dieselbe neue PIN, aber falsche alte PIN: nicht geändert', async () => {
    eq(await pinDialog('0000', '1234', '1234'), 'Nicht geändert: alte PIN falsch oder neue PIN keine 4 Ziffern.', 'Hinweis');
    eq(await pinOk('6767'), true, 'alte PIN gilt noch');
  });
  await K('Zweimal dieselbe gültige neue PIN: geändert, neue PIN gilt, alte nicht mehr', async () => {
    eq(await pinDialog('6767', '1234', '1234'), 'PIN geändert.', 'Hinweis');
    eq(await pinOk('1234'), true, 'neue PIN gilt');
    const api = await anonApi();
    const l = await (await api.post('/rest/v1/rpc/k_login', { data: { p_code: code, p_person: zoe, p_pin: '6767' } })).json();
    await api.dispose();
    eq(`${l.ok}/${l.err}`, 'false/pin', 'Anmeldung mit der alten PIN');
  });
  await K('Abbrechen im PIN-Dialog ändert nichts; keine Fehler in der Browser-Konsole', async () => {
    await kp.locator('[data-a="k-pin"]').click();
    await kp.locator('#modal #f_n').fill('9999');
    await kp.locator('#modal [data-a="m-x"]').click(); await idle(kp);
    const real = [...page.problems, ...kp.problems].filter(p => !/favicon/i.test(p));
    expect(real.length === 0, real.join(' · '));
  });
  await kp.context().close();
  await page.context().close();
};
