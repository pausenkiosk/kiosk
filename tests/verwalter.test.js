'use strict';
/* Verwalter-Bereich komplett: Anmeldung, Bon, Regal, Regalfoto, Einkauf, Haltbarkeit, Kasse, Leute, Nachricht an Claude.
   Läuft nach dem Kollegen-Teil: Ben hat 1 Wasser angeschrieben (0,80 €), Clara ist gesperrt. */
const { CFG, step, setGroup, expect, eq, newPage, toast, hideToast, idle, fillModal, see, row, prow, rowHas, lnIs, anonApi, isoDay } = require('./lib');

const dshort = iso => { const [, m, d] = iso.split('-'); return `${d}.${m}.`; };

module.exports = async function verwalter(browser) {
  setGroup('Verwalter');
  const page = await newPage(browser, { permissions: ['clipboard-read', 'clipboard-write'] });
  const S = (n, f) => step(n, f, page);
  const tab = async t => { await idle(page); await page.locator(`#nav [data-t="${t}"]`).click(); await page.locator(`#nav [data-t="${t}"].on`).waitFor(); };
  const act = async a => { await idle(page); await page.locator(`#app [data-a="${a}"]`).first().click(); };
  /* Datenbankwert über die angemeldete Sitzung der App nachlesen. */
  const db = (table, select, filterCol, filterVal) => page.evaluate(async ([t, s, c, v]) => {
    let q = SB.from(t).select(s); if (c) q = q.eq(c, v);
    const { data, error } = await q; if (error) throw new Error(error.message); return data;
  }, [table, select, filterCol, filterVal]);
  const product = async name => (await db('products', '*', 'name', name))[0];

  /* ---------- Anmeldung ---------- */
  await S('Anmeldung: Verwaltung über die Startseite erreichbar', async () => {
    await page.goto(CFG.url);
    await page.evaluate(() => localStorage.clear());
    await page.goto(CFG.url);
    await see(page, 'Bitte den QR-Code am Kiosk scannen');
    await page.locator('[data-a="go-admin"]').click();
    await page.locator('#alog').waitFor();
    expect(await page.locator('#nav').isHidden(), 'Leiste vor der Anmeldung sichtbar');
  });
  await S('Anmeldung: falsches Passwort wird abgelehnt', async () => {
    await page.fill('#em', CFG.email);
    await page.fill('#pw', 'ganz-falsches-passwort');
    await page.locator('#alog button.pri').click();
    await toast(page, /Anmeldung fehlgeschlagen\./);
    expect(await page.locator('#alog').count() === 1, 'Trotz falschem Passwort angemeldet');
  });
  await S('Anmeldung: Konto anlegen verlangt E-Mail und 10 Zeichen', async () => {
    await hideToast(page);
    await page.fill('#pw', 'kurz');
    await page.locator('[data-a="a-signup"]').click();
    await toast(page, /mindestens 10 Zeichen/);
  });
  await S('Anmeldung: richtiges Passwort öffnet den Bon mit fünf Bereichen', async () => {
    await page.fill('#em', CFG.email);
    await page.fill('#pw', CFG.pw);
    await page.locator('#alog button.pri').click();
    await page.locator('#nav:not([hidden])').waitFor();
    eq((await page.locator('#nav button').allInnerTexts()).join(','), 'Bon,Regal,Einkauf,Kasse,Leute', 'Bereiche');
    await see(page, 'KASSENSTAND');
  });
  await S('Anmeldung bleibt nach neuem Laden bestehen', async () => {
    await page.goto(CFG.url + '#verwaltung');
    await page.reload();
    await page.locator('#nav:not([hidden])').waitFor();
    await see(page, 'KASSENSTAND');
  });

  /* ---------- Bon ---------- */
  await S('Bon: Kassenstand, Monatswerte, offene Schuldscheine', async () => {
    await lnIs(page, 'KASSENSTAND', '33,50');
    await lnIs(page, 'Einnahmen Monat', '50,00');
    await lnIs(page, 'Offene Schuldscheine', '10,30');   // Emil 4,50 + Anna 2,00 + Gerd 3,00 + Ben 0,80
    await lnIs(page, 'Fehlbetrag letzte Zählung', '–');
  });
  await S('Bon: Datum und Kalenderwoche in der Kopfzeile', async () => {
    const sub = await page.locator('#app .sub').first().innerText();
    expect(/^(So|Mo|Di|Mi|Do|Fr|Sa) \d{1,2}\.\d{1,2}\.\d{4} · KW \d{1,2}$/.test(sub.trim()), 'Kopfzeile: ' + sub);
  });
  await S('Bon: leeres Produkt steht unter „Nachbestellen“', async () => {
    await see(page, 'Nachbestellen (1)');
    await rowHas(page, 'Gummibärchen', /0 St.*leer/);
    await lnIs(page, 'Im grünen Bereich', '3 Artikel');
  });
  await S('Bon: Hinweis auf die gesperrte Anmeldung, „OK“ blendet ihn aus', async () => {
    await see(page, 'Hinweise');
    await rowHas(page, 'Anmeldung von Clara', /nach 3 falschen PINs für 1 Stunde gesperrt/);
    await row(page, 'Anmeldung von Clara').locator('[data-a="a-seen"]').click();
    await page.waitForFunction(() => !document.querySelector('#app').textContent.includes('Anmeldung von Clara'));
  });
  await S('Bon: Schnelltasten Zählen, Einkauf, Zahlung', async () => {
    await page.locator('#app [data-a="a-go"][data-t="regal"]').click();
    await see(page, 'Bestand zählen');
    await act('a-cnt-x');
    await tab('bon');
    await page.locator('#app [data-a="a-go"][data-t="einkauf"]').click();
    await see(page, 'Einkauf erfassen');
    await tab('bon');
    await page.locator('#app [data-a="a-go"][data-t="leute"]').click();
    await see(page, 'Schuldscheine');
    await tab('bon');
  });

  /* ---------- Nachricht an Claude ---------- */
  await S('Nachricht an Claude: leere Nachricht wird nicht gespeichert', async () => {
    await act('a-req');
    await fillModal(page, 'Nachricht an Claude', { t: '   ' });
    await page.locator('#modal[hidden]').waitFor({ state: 'attached' });
    eq((await db('requests', 'id')).length, 0, 'Anzahl gespeicherter Nachrichten');
  });
  await S('Nachricht an Claude: wird gespeichert und in der Liste gezeigt', async () => {
    await act('a-req');
    await fillModal(page, 'Nachricht an Claude', { t: 'Testnachricht: Bitte die Schrift größer machen.' });
    await toast(page, /Gespeichert\. Claude liest es beim nächsten Durchlauf\./);
    await rowHas(page, 'Testnachricht: Bitte die Schrift größer machen.', new RegExp(dshort(isoDay()).replace(/\./g, '\\.')));
    const q = await db('requests', 'text,status');
    eq(q.length, 1, 'Anzahl gespeicherter Nachrichten'); eq(q[0].status, 'neu', 'Status der Nachricht');
  });

  /* ---------- Regal ---------- */
  await S('Regal: Liste mit Bestand und Preis, ausgeblendetes Produkt markiert', async () => {
    await tab('regal');
    await rowHas(page, 'Cola', /12 St.*1,50/);
    await rowHas(page, 'Kaffee', /\(aus\).*30 St.*0,50/);
    await rowHas(page, 'Wasser', /19 St/);
  });
  await S('Regal: Produkt bearbeiten (Preis und Gruppe)', async () => {
    await page.locator('#app button.it', { hasText: 'Cola' }).click();
    const m = page.locator('#modal');
    eq(await m.locator('#f_name').inputValue(), 'Cola', 'Name im Dialog');
    eq(await m.locator('#f_price').inputValue(), '1,50', 'Preis im Dialog');
    await fillModal(page, 'Produkt bearbeiten', { price: '1,60', cat: 'Kaltgetränke' });
    await rowHas(page, 'Cola', /1,60/);
    const p = await product('Cola');
    eq(p.price_cents, 160, 'Preis in der Datenbank'); eq(p.category, 'Kaltgetränke', 'Gruppe in der Datenbank');
  });
  await S('Regal: Produkt bearbeiten – Abbrechen ändert nichts', async () => {
    await page.locator('#app button.it', { hasText: 'Wasser' }).click();
    await fillModal(page, 'Produkt bearbeiten', { price: '9,99' }, false);
    await page.locator('#modal [data-a="m-x"]').click();
    eq((await product('Wasser')).price_cents, 80, 'Preis von Wasser');
  });
  await S('Regal: Abverkaufspreis setzen und wieder entfernen', async () => {
    await page.locator('#app button.it', { hasText: 'Wasser' }).click();
    await fillModal(page, 'Produkt bearbeiten', { sale: '0,50' });
    await rowHas(page, 'Wasser', /%/);
    eq((await product('Wasser')).sale_cents, 50, 'Abverkaufspreis');
    await page.locator('#app button.it', { hasText: 'Wasser' }).click();
    eq(await page.locator('#modal #f_sale').inputValue(), '0,50', 'Abverkaufspreis im Dialog');
    await fillModal(page, 'Produkt bearbeiten', { sale: '' });
    await page.waitForFunction(() => ![...document.querySelectorAll('#app .it')].find(e => e.textContent.includes('Wasser')).textContent.includes('%'));
    eq((await product('Wasser')).sale_cents, null, 'Abverkaufspreis nach dem Leeren');
  });
  await S('Regal: neues Produkt ohne Preis darf nicht sichtbar sein', async () => {
    await hideToast(page);
    await page.locator('#app [data-a="a-prod"][data-id=""]').click();
    await fillModal(page, 'Neues Produkt', { name: 'Testkeks', cat: 'Süßes', price: '' });
    await toast(page, /Sichtbare Produkte brauchen einen Verkaufspreis\./);
    eq((await db('products', 'id', 'name', 'Testkeks')).length, 0, 'Produkt ohne Preis angelegt');
  });
  await S('Regal: neues Produkt anlegen', async () => {
    await page.locator('#app [data-a="a-prod"][data-id=""]').click();
    await fillModal(page, 'Neues Produkt', { name: 'Testkeks', cat: 'Süßes', price: '0,90' });
    await rowHas(page, 'Testkeks', /0 St.*0,90/);
    const p = await product('Testkeks');
    eq(p.price_cents, 90, 'Preis'); eq(p.category, 'Süßes', 'Gruppe'); eq(p.active, true, 'sichtbar'); eq(p.stock, 0, 'Bestand');
  });
  await S('Regal: neues Produkt mit schon vergebenem Namen meldet einen Fehler', async () => {
    await hideToast(page);
    await page.locator('#app [data-a="a-prod"][data-id=""]').click();
    await fillModal(page, 'Neues Produkt', { name: 'Cola', cat: 'Getränke', price: '1,00' });
    await toast(page, /Das hat nicht geklappt/);
  });
  await S('Regal: Zählen – Abbrechen speichert nichts', async () => {
    await act('a-cnt');
    await see(page, 'Bestand zählen');
    expect(await page.locator('[data-cnt]').count() === 5, 'Zählfelder: erwartet 5 sichtbare Produkte, gefunden ' + await page.locator('[data-cnt]').count());
    await page.locator(`[aria-label="Gezählt Cola"]`).fill('1');
    await act('a-cnt-x');
    await rowHas(page, 'Cola', /12 St/);
  });
  await S('Regal: Zählen – Differenz wird als Abgang gebucht', async () => {
    await hideToast(page);
    await act('a-cnt');
    eq(await page.locator(`[aria-label="Gezählt Cola"]`).inputValue(), '12', 'Vorbelegung Cola');
    await page.locator(`[aria-label="Gezählt Cola"]`).fill('10');
    await act('a-cnt-ok');
    await toast(page, /Zählung gespeichert\./);
    await rowHas(page, 'Cola', /10 St/);
    const cola = await product('Cola');
    const c = await db('counts', 'expected,counted', 'product_id', cola.id);
    eq(JSON.stringify(c), JSON.stringify([{ expected: 12, counted: 10 }]), 'Zählprotokoll Cola');
    const s = (await db('sales', 'qty,cents,kind', 'product_id', cola.id)).filter(x => x.kind === 'zaehlung');
    eq(JSON.stringify(s), JSON.stringify([{ qty: 2, cents: 320, kind: 'zaehlung' }]), 'Abgang laut Zählung');
  });
  await S('Regal: Ampel-Schwellen – Gelb muss größer als Rot sein', async () => {
    await hideToast(page);
    await act('a-amp');
    await fillModal(page, 'Ampel-Schwellen', { r: '3', g: '2' });
    await toast(page, /Gelb muss größer als Rot sein\./);
  });
  await S('Regal: Ampel-Schwellen ändern', async () => {
    await act('a-amp');
    await fillModal(page, 'Ampel-Schwellen', { r: '1,5', g: '3' });
    await lnIs(page, 'Rot unter', '1,5 Wochen');
    await lnIs(page, 'Gelb unter', '3 Wochen');
  });

  /* ---------- Regalfoto ---------- */
  const png = await page.screenshot();
  const upload = async files => {
    await hideToast(page);
    await page.locator('#foto').setInputFiles(files.map((n, i) => ({ name: n, mimeType: 'image/png', buffer: png })));
  };
  const stored = () => page.evaluate(async () => (await SB.storage.from('fotos').list('regal')).data.map(f => f.name).filter(n => n.endsWith('.jpg')));
  await S('Regalfoto: Speicher ist zu Beginn leer (Reste früherer Läufe werden entfernt)', async () => {
    const old = await stored();
    if (old.length) await page.evaluate(async names => { await SB.storage.from('fotos').remove(names.map(n => 'regal/' + n)); }, old);
    eq((await stored()).length, 0, 'Fotos im Speicher');
  });
  await S('Regalfoto: Knopf öffnet die Dateiauswahl', async () => {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), act('a-foto')]);
    expect(chooser.isMultiple(), 'Dateiauswahl erlaubt nur ein Foto');
    await chooser.setFiles([]);
  });
  await S('Regalfoto: Hochladen legt einen Auftrag an', async () => {
    await upload(['regal1.png', 'regal2.png']);
    await toast(page, /2 Fotos gespeichert\. Der Vorschlag erscheint hier nach der Auswertung\./, 45000);
    await rowHas(page, 'Foto vom ' + dshort(isoDay()), /wartet auf Auswertung/);
    const j = await db('photo_jobs', 'paths,status');
    eq(j.length, 1, 'Anzahl Foto-Aufträge'); eq(j[0].status, 'neu', 'Status'); eq(j[0].paths.length, 2, 'Anzahl Fotos');
    const files = await stored();
    expect(files.length === 2 && j[0].paths.every(p => files.includes(p.replace('regal/', ''))), 'Fotos liegen nicht im Speicher: ' + files.join(','));
  });
  await S('Regalfoto: Vorschlag prüfen füllt die Zählung vor und schließt den Auftrag ab', async () => {
    // Die Auswertung macht sonst Claude. Hier wird ihr Ergebnis nachgestellt: Wasser 18 Stück.
    await page.evaluate(async () => {
      const w = (await SB.from('products').select('id').eq('name', 'Wasser')).data[0];
      const { error } = await SB.from('photo_jobs').update({ status: 'vorschlag', result: [{ id: w.id, qty: 18 }], note: 'Testvorschlag' }).eq('status', 'neu');
      if (error) throw new Error(error.message);
    });
    await page.reload();
    await page.locator('#nav:not([hidden])').waitFor();
    await tab('regal');
    await rowHas(page, 'Foto vom', /Vorschlag liegt vor/);
    await hideToast(page);
    await act('a-job');
    await see(page, 'Testvorschlag');
    await rowHas(page, 'Wasser', /soll 19 · Foto 18/);
    eq(await page.locator(`[aria-label="Gezählt Wasser"]`).inputValue(), '18', 'Vorbelegung aus dem Foto');
    await act('a-cnt-ok');
    await toast(page, /Zählung gespeichert\./);
    await rowHas(page, 'Wasser', /18 St/);
    expect(await page.locator('#app .it', { hasText: 'Foto vom' }).count() === 0, 'Erledigter Foto-Auftrag steht noch in der Liste');
    const j = await db('photo_jobs', 'paths,status');
    eq(j[0].status, 'fertig', 'Status des Auftrags'); eq(j[0].paths.length, 0, 'Fotos nach Abschluss');
    eq((await stored()).length, 0, 'Fotos im Speicher nach Abschluss');
  });
  await S('Regalfoto: wartenden Auftrag löschen', async () => {
    await upload(['regal3.png']);
    await toast(page, /1 Foto gespeichert\./, 45000);
    await rowHas(page, 'Foto vom', /wartet auf Auswertung/);
    await row(page, 'Foto vom').locator('[data-a="a-jobdel"]').click();
    await page.waitForFunction(() => !document.querySelector('#app').textContent.includes('Foto vom'));
    eq((await db('photo_jobs', 'id', 'status', 'neu')).length, 0, 'offene Foto-Aufträge');
    eq((await stored()).length, 0, 'Fotos im Speicher nach dem Löschen');
  });

  /* ---------- Einkauf ---------- */
  const cartRow = n => page.locator('#cart .cart').nth(n);
  const fillCart = async (n, name, qty, price, mhd) => {
    const r = cartRow(n);
    if (name) await r.locator('select').selectOption({ label: name });
    await r.locator('input[type="number"]').fill(qty);
    await r.locator('input[inputmode="decimal"]').fill(price);
    await r.locator('input[type="date"]').fill(mhd || '');
  };
  await S('Einkauf: Formular mit heutigem Datum und zwei Zeilen, „Zeile dazu“', async () => {
    await tab('einkauf');
    eq(await page.inputValue('#eday'), isoDay(), 'Datum');
    eq(await page.locator('#cart .cart').count(), 2, 'Zeilen');
    await act('a-cart');
    eq(await page.locator('#cart .cart').count(), 3, 'Zeilen nach „Zeile dazu“');
    await see(page, 'Keine offenen Haltbarkeitsdaten.');
  });
  await S('Einkauf: ohne Produkt und ohne Preis wird nicht gespeichert', async () => {
    await hideToast(page);
    await act('a-buy');
    await toast(page, /Mindestens ein Produkt auswählen\./);
    await hideToast(page);
    await fillCart(0, 'Schokoriegel', '10', '', '');
    await act('a-buy');
    await toast(page, /Bitte Stückzahl und Gesamtpreis für jede Zeile eintragen\./);
    eq((await db('purchases', 'id')).length, 0, 'gespeicherte Einkäufe');
  });
  await S('Einkauf mit Haltbarkeitsdatum speichern', async () => {
    await hideToast(page);
    await page.fill('#estore', 'Testmarkt');
    await fillCart(0, 'Schokoriegel', '10', '7,90', isoDay(5));
    await fillCart(1, 'Wasser', '6', '2,94', isoDay(60));
    await fillCart(2, 'Testkeks', '4', '2', '');
    await act('a-buy');
    await toast(page, /Einkauf gespeichert\./);
    await rowHas(page, 'Schokoriegel · 10 St', new RegExp(dshort(isoDay(5)).replace(/\./g, '\\.') + ' \\((4|5) T\\)'));
    await rowHas(page, 'Wasser · 6 St', new RegExp(dshort(isoDay(60)).replace(/\./g, '\\.') + ' \\((59|60) T\\)'));
    expect(await page.locator('#app .it', { hasText: 'Testkeks ·' }).count() === 0, 'Zeile ohne Haltbarkeitsdatum steht in der Haltbarkeitsliste');
    const sch = await product('Schokoriegel'), wa = await product('Wasser'), tk = await product('Testkeks');
    eq(sch.stock, 18, 'Bestand Schokoriegel'); eq(sch.cost_cents, 79, 'Einkaufspreis Schokoriegel');
    eq(wa.stock, 24, 'Bestand Wasser'); eq(wa.cost_cents, 49, 'Einkaufspreis Wasser');
    eq(tk.stock, 4, 'Bestand Testkeks'); eq(tk.cost_cents, 50, 'Einkaufspreis Testkeks');
    const pu = await db('purchases', 'day,store');
    eq(JSON.stringify(pu), JSON.stringify([{ day: isoDay(), store: 'Testmarkt' }]), 'Einkauf');
    const j = await db('journal', 'day,out_cents', 'text', 'Einkauf Testmarkt');
    eq(JSON.stringify(j), JSON.stringify([{ day: isoDay(), out_cents: 1284 }]), 'Kassenbuch-Eintrag zum Einkauf');
  });
  await S('Einkauf: Formular ist nach dem Speichern wieder leer', async () => {
    eq(await page.locator('#cart .cart').count(), 2, 'Zeilen');
    eq(await page.inputValue('#estore'), '', 'Laden');
  });
  await S('Bon: bald ablaufende Ware steht unter „Läuft ab“', async () => {
    await tab('bon');
    await see(page, 'Läuft ab (1)');
    await rowHas(page, 'Schokoriegel', new RegExp('10 St.*' + dshort(isoDay(5)).replace(/\./g, '\\.')));
    await lnIs(page, 'KASSENSTAND', '20,66');   // 33,50 − 12,84
    await tab('regal');
    await page.locator('#app button.it', { hasText: 'Schokoriegel' }).click();
    await see(page, 'Letzter Einkaufspreis: 0,79 € je Stück', '#modal');
    await page.locator('#modal [data-a="m-x"]').click();
  });

  /* ---------- Haltbarkeits-Aktionen ---------- */
  const mhd = async (name, values) => {
    await idle(page); await hideToast(page);
    await row(page, name + ' ·').locator('[data-a="a-mhd"]').click();
    await fillModal(page, name, values);
  };
  await S('Haltbarkeit: „Reduziert anbieten“ ohne Preis wird abgelehnt', async () => {
    await tab('einkauf');
    await mhd('Schokoriegel', { a: 'sale', x: '' });
    await toast(page, /Bitte einen Abverkaufspreis eintragen\./);
  });
  await S('Haltbarkeit: „Reduziert anbieten“ setzt den Abverkaufspreis', async () => {
    await mhd('Schokoriegel', { a: 'sale', x: '0,50' });
    await page.waitForFunction(() => document.querySelector('#modal').hidden);
    await idle(page);
    eq((await product('Schokoriegel')).sale_cents, 50, 'Abverkaufspreis Schokoriegel');
    await rowHas(page, 'Schokoriegel · 10 St', /T\)/);   // Hinweis bleibt offen
    await tab('regal');
    await rowHas(page, 'Schokoriegel', /%/);
  });
  await S('Haltbarkeit: Kollegen sehen den Abverkaufspreis', async () => {
    const api = await anonApi();
    const names = await (await api.post('/rest/v1/rpc/k_names', { data: { p_code: CFG.code } })).json();
    const l = await (await api.post('/rest/v1/rpc/k_login', { data: { p_code: CFG.code, p_person: names.find(n => n.vorname === 'Anna').id, p_pin: '1111' } })).json();
    expect(l.ok, 'Anmeldung Anna: ' + JSON.stringify(l));
    const st = await (await api.post('/rest/v1/rpc/k_state', { data: { p_token: l.token } })).json();
    const p = st.products.find(x => x.name === 'Schokoriegel');
    eq(JSON.stringify({ cents: p.cents, normal: p.normal, sale: p.sale }), JSON.stringify({ cents: 50, normal: 100, sale: true }), 'Schokoriegel für Kollegen');
    await api.post('/rest/v1/rpc/k_logout', { data: { p_token: l.token } });
    await api.dispose();
  });
  await S('Haltbarkeit: „Entsorgt“ bucht den Verlust und erledigt den Hinweis', async () => {
    await tab('einkauf');
    await mhd('Schokoriegel', { a: 'waste', x: '3' });
    await page.waitForFunction(() => !document.querySelector('#app').textContent.includes('Schokoriegel ·'));
    const sch = await product('Schokoriegel');
    eq(sch.stock, 15, 'Bestand Schokoriegel nach Entsorgen'); eq(sch.sale_cents, null, 'Abverkaufspreis nach Entsorgen');
    const s = (await db('sales', 'qty,cents,kind', 'product_id', sch.id)).filter(x => x.kind === 'verlust');
    eq(JSON.stringify(s), JSON.stringify([{ qty: 3, cents: 237, kind: 'verlust' }]), 'Verlustbuchung');
  });
  await S('Haltbarkeit: „Verkauft, Hinweis erledigt“ entfernt den Hinweis ohne Bestandsänderung', async () => {
    await mhd('Wasser', { a: 'done', x: '' });
    await see(page, 'Keine offenen Haltbarkeitsdaten.');
    eq((await product('Wasser')).stock, 24, 'Bestand Wasser');
    await tab('bon');
    expect(!(await page.locator('#app').innerText()).includes('Läuft ab'), '„Läuft ab“ steht noch auf dem Bon');
  });

  /* ---------- Kasse ---------- */
  const firstCol = () => page.locator('#app table').first().locator('tr td:first-child').allInnerTexts();
  const year = Number(isoDay().slice(0, 4));
  await S('Kasse: Grafik Monat ist voreingestellt', async () => {
    await tab('kasse');
    await page.locator('.seg [data-s="month"].on').waitFor();
    await page.locator('svg.chart').waitFor();
    const labels = await firstCol();
    expect(labels.length === 3 && labels.every(l => /^(Jan|Feb|Mär|Apr|Mai|Jun|Jul|Aug|Sep|Okt|Nov|Dez) \d\d$/.test(l)), 'Monatszeilen: ' + labels.join(' | '));
    eq(await page.locator('svg.chart rect.in').count(), 3, 'Balken Einnahmen'); eq(await page.locator('svg.chart rect.out').count(), 3, 'Balken Ausgaben');
  });
  await S('Kasse: Grafik Woche', async () => {
    await page.locator('.seg [data-s="week"]').click();
    await page.locator('.seg [data-s="week"].on').waitFor();
    const labels = await firstCol();
    expect(labels.length === 3 && labels.every(l => /^KW\d{1,2} \d\d$/.test(l)), 'Wochenzeilen: ' + labels.join(' | '));
    const top = (await page.locator('#app table').first().locator('tr').nth(1).locator('td').allInnerTexts()).join(' ');
    expect(/50,00 12,84 37,16/.test(top), 'Aktuelle Woche: erwartet Ein 50,00 Aus 12,84 Saldo 37,16, tatsächlich ' + top);
  });
  await S('Kasse: Grafik Jahr', async () => {
    await page.locator('.seg [data-s="year"]').click();
    await page.locator('.seg [data-s="year"].on').waitFor();
    const labels = await firstCol();
    const y400 = isoDay(-400).slice(0, 4), y40 = isoDay(-40).slice(0, 4);
    const want = [...new Set([String(year), y40, y400])].sort().reverse();
    eq(labels.join(','), want.join(','), 'Jahreszeilen');
    const svg = await page.locator('svg.chart').innerHTML();
    expect(svg.includes('max ') && !/NaN|Infinity/.test(svg), 'Grafik enthält ungültige Werte');
    const heights = await page.locator('svg.chart rect').evaluateAll(rs => rs.map(r => Number(r.getAttribute('height'))));
    expect(Math.max(...heights) > 80 && heights.every(h => h >= 0 && h <= 84), 'Balkenhöhen unplausibel: ' + heights.join(','));
  });
  await S('Kasse: Verkauf der letzten 4 Wochen', async () => {
    await lnIs(page, 'Cola', '2 St');
    await lnIs(page, 'Wasser', '2 St');     // 1 × per Handy, 1 × laut Zählung
    expect(await page.locator('#app .ln', { hasText: 'Schokoriegel' }).count() === 0, 'Entsorgte Ware zählt als Verkauf');
  });
  await S('Kasse: Kassensturz bucht die Barverkäufe', async () => {
    await hideToast(page);
    await act('a-cash');
    await fillModal(page, 'Kassensturz', { c: '3,00' });
    await toast(page, /Kassensturz gebucht\./);
    await rowHas(page, 'Barverkäufe', /3,00/);
    eq(JSON.stringify(await db('cash_counts', 'day,cents')), JSON.stringify([{ day: isoDay(), cents: 300 }]), 'Kassensturz in der Datenbank');
  });
  await S('Kasse: Kassensturz – Abbrechen und leere Eingabe buchen nichts', async () => {
    await act('a-cash');
    await page.locator('#modal [data-a="m-x"]').click();
    await act('a-cash');
    await fillModal(page, 'Kassensturz', { c: '' });
    await idle(page);
    eq((await db('cash_counts', 'id')).length, 1, 'Anzahl Kassenstürze');
  });
  await S('Bon: Fehlbetrag vergleicht Zählung und Kassensturz', async () => {
    await tab('bon');
    await lnIs(page, 'Fehlbetrag letzte Zählung', '1,00');   // 2 Cola à 1,60 + 1 Wasser à 0,80 fehlen, 3,00 in der Kasse
    await lnIs(page, 'KASSENSTAND', '23,66');
  });
  await S('Kasse: Buchung von Hand (Einnahme)', async () => {
    await tab('kasse');
    await act('a-jour');
    eq(await page.locator('#modal #f_d').inputValue(), isoDay(), 'Datum im Dialog');
    await fillModal(page, 'Buchung von Hand', { t: 'Testspende', i: '12,34' });
    await rowHas(page, 'Testspende', /12,34/);
  });
  await S('Kasse: Buchung von Hand (Ausgabe mit Tausenderpunkt, anderes Datum)', async () => {
    await act('a-jour');
    await fillModal(page, 'Buchung von Hand', { d: isoDay(-1), t: 'Testregal', o: '1.234,56' });
    await rowHas(page, 'Testregal', /−1\.234,56/);
    const j = await db('journal', 'day,in_cents,out_cents,source', 'text', 'Testregal');
    eq(JSON.stringify(j), JSON.stringify([{ day: isoDay(-1), in_cents: 0, out_cents: 123456, source: 'hand' }]), 'Buchung in der Datenbank');
  });
  await S('Kasse: Buchung von Hand ohne Text wird nicht gespeichert', async () => {
    await act('a-jour');
    await fillModal(page, 'Buchung von Hand', { t: '', i: '5' });
    await idle(page);
    eq((await db('journal', 'id', 'source', 'hand')).length, 4, 'Anzahl Hand-Buchungen');   // 2 aus den Testdaten + 2 neue
  });
  await S('Kasse: Kassenstand folgt den Buchungen, negativ wird rot', async () => {
    await tab('bon');
    await lnIs(page, 'KASSENSTAND', '-1.198,56');   // 23,66 + 12,34 − 1.234,56
    expect(await page.locator('#app .ln.neg', { hasText: 'KASSENSTAND' }).count() === 1, 'Negativer Kassenstand ist nicht rot markiert');
  });

  /* ---------- Leute ---------- */
  const person = async n => (await db('persons', 'id,vorname,locked_until,consent_at', 'vorname', n))[0];
  const saldo = async n => { const p = await person(n); return (await db('ledger', 'amount_cents', 'person_id', p.id)).reduce((a, l) => a + l.amount_cents, 0); };
  await S('Leute: Schuldscheine nach Höhe sortiert, Sperre rot markiert', async () => {
    await tab('leute');
    const names = await page.locator('#app .paper').first().locator('.it span:nth-child(2)').allInnerTexts();
    eq(names.join(','), 'Emil,Gerd,Anna,Ben,Clara', 'Reihenfolge');
    await rowHas(page, 'Emil', /4,50/); await rowHas(page, 'Ben', /0,80/);
    expect(await prow(page, 'Clara').locator('i.lamp.r').count() === 1, 'Gesperrte Clara ist nicht rot markiert');
    expect(await prow(page, 'Anna').locator('i.lamp.g').count() === 1, 'Anna (zugestimmt) ist nicht grün markiert');
  });
  await S('Leute: Person eintragen – PIN braucht 4 Ziffern', async () => {
    await hideToast(page);
    await act('a-person');
    await fillModal(page, 'Person eintragen', { n: 'Dora', p: '12' });
    await toast(page, /Die PIN braucht genau 4 Ziffern\./);
    expect(!(await person('Dora')), 'Dora wurde trotz falscher PIN angelegt');
  });
  await S('Leute: Person eintragen (nur der Vorname wird übernommen)', async () => {
    await act('a-person');
    await fillModal(page, 'Person eintragen', { n: 'Dora Mustermann', p: '5656' });
    await rowHas(page, 'Dora', /0,00/);
    expect(!(await page.locator('#app').innerText()).includes('Mustermann'), 'Nachname wurde gespeichert');
    expect(await prow(page, 'Dora').locator('i.lamp.o').count() === 1, 'Neue Person ist nicht als „noch nicht angemeldet“ markiert');
  });
  await S('Leute: neue Person kann sich mit der Start-PIN anmelden', async () => {
    const api = await anonApi();
    const d = await person('Dora');
    const l = await (await api.post('/rest/v1/rpc/k_login', { data: { p_code: CFG.code, p_person: d.id, p_pin: '5656' } })).json();
    expect(l.ok === true, 'Anmeldung Dora: ' + JSON.stringify(l));
    await api.post('/rest/v1/rpc/k_logout', { data: { p_token: l.token } });
    await api.dispose();
  });
  await S('Leute: doppelter Vorname meldet einen Fehler', async () => {
    await hideToast(page);
    await act('a-person');
    await fillModal(page, 'Person eintragen', { n: 'Dora', p: '1234' });
    await toast(page, /Das hat nicht geklappt/);
  });
  let pins = {};
  await S('Leute: mehrere als Liste – Start-PINs werden einmal angezeigt', async () => {
    await page.locator('#app [data-a="a-persons"]').click();
    await fillModal(page, 'Mehrere Personen eintragen', { t: 'fritz, Hanna und Ida\nJonas; Anna' });
    const m = page.locator('#modal:not([hidden])');
    await m.locator('h2', { hasText: '4 angelegt' }).waitFor();
    const lines = await m.locator('.ln').evaluateAll(ls => ls.map(l => [l.children[0].textContent, l.children[1].textContent]));
    eq(lines.map(l => l[0]).join(','), 'Fritz,Hanna,Ida,Jonas', 'angelegte Namen');
    expect(lines.every(l => /^\d{4}$/.test(l[1])), 'Start-PINs sind nicht 4-stellig: ' + JSON.stringify(lines));
    pins = Object.fromEntries(lines);
    await m.locator('[data-a="m-close"]').click();
    for (const n of ['Fritz', 'Hanna', 'Ida', 'Jonas']) await rowHas(page, n, /0,00/);
  });
  await S('Leute: mehrere als Liste – angezeigte Start-PIN funktioniert', async () => {
    expect(pins.Fritz, 'keine PIN aus dem vorigen Schritt');
    const api = await anonApi();
    const f = await person('Fritz');
    const l = await (await api.post('/rest/v1/rpc/k_login', { data: { p_code: CFG.code, p_person: f.id, p_pin: pins.Fritz } })).json();
    expect(l.ok === true, 'Anmeldung Fritz mit Start-PIN: ' + JSON.stringify(l));
    await api.post('/rest/v1/rpc/k_logout', { data: { p_token: l.token } });
    await api.dispose();
  });
  await S('Leute: mehrere als Liste – vorhandene Namen werden übersprungen', async () => {
    await hideToast(page);
    await page.locator('#app [data-a="a-persons"]').click();
    await fillModal(page, 'Mehrere Personen eintragen', { t: 'Fritz und anna' });
    await toast(page, /Niemand angelegt: Alle Namen gibt es schon\./);
  });
  await S('Leute: Zahlung buchen gleicht den Schuldschein aus und landet in der Kasse', async () => {
    await hideToast(page);
    await prow(page, 'Emil').locator('[data-a="a-pay"]').click();
    await fillModal(page, 'Zahlung von Emil', { c: '4,50' });
    await toast(page, /Zahlung gebucht\./);
    await rowHas(page, 'Emil', /0,00/);
    eq(await saldo('Emil'), 0, 'Schuldschein Emil');
    const j = await db('journal', 'day,in_cents', 'text', 'Zahlung Schuldschein');
    eq(JSON.stringify(j), JSON.stringify([{ day: isoDay(), in_cents: 450 }]), 'Kassenbuch-Eintrag zur Zahlung');
  });
  await S('Leute: Zahlung ohne Betrag bucht nichts', async () => {
    await prow(page, 'Gerd').locator('[data-a="a-pay"]').click();
    await fillModal(page, 'Zahlung von Gerd', { c: '' });
    await idle(page);
    eq(await saldo('Gerd'), 300, 'Schuldschein Gerd');
  });
  await S('Leute: Teilzahlung lässt einen Rest stehen', async () => {
    await prow(page, 'Gerd').locator('[data-a="a-pay"]').click();
    await fillModal(page, 'Zahlung von Gerd', { c: '1' });
    await rowHas(page, 'Gerd', /2,00/);
  });
  const more = async (name, a, x) => {
    await idle(page); await hideToast(page);
    await prow(page, name).locator('[data-a="a-more"]').click();
    await fillModal(page, name, { a, x });
  };
  await S('Leute: neue PIN – braucht 4 Ziffern', async () => {
    await more('Clara', 'pin', '99');
    await toast(page, /Die PIN braucht genau 4 Ziffern\./);
  });
  await S('Leute: neue PIN setzen hebt die Sperre auf', async () => {
    await more('Clara', 'pin', '9090');
    await toast(page, /Neue PIN gesetzt\./);
    await page.waitForFunction(() => { const r = [...document.querySelectorAll('#app .it')].find(e => e.textContent.includes('Clara')); return r && !r.querySelector('i.lamp.r'); });
    eq((await person('Clara')).locked_until, null, 'Sperre von Clara');
    const api = await anonApi();
    const c = await person('Clara');
    const old = await (await api.post('/rest/v1/rpc/k_login', { data: { p_code: CFG.code, p_person: c.id, p_pin: '3333' } })).json();
    expect(old.ok === false && old.err === 'pin', 'Alte PIN nach Neuvergabe: ' + JSON.stringify(old));
    const neu = await (await api.post('/rest/v1/rpc/k_login', { data: { p_code: CFG.code, p_person: c.id, p_pin: '9090' } })).json();
    expect(neu.ok === true, 'Neue PIN: ' + JSON.stringify(neu));
    await api.post('/rest/v1/rpc/k_logout', { data: { p_token: neu.token } });
    await api.dispose();
  });
  await S('Leute: Schuldschein korrigieren', async () => {
    await more('Anna', 'fix', '-0,50');
    await rowHas(page, 'Anna', /1,50/);
    eq(await saldo('Anna'), 150, 'Schuldschein Anna');
  });
  await S('Leute: Korrektur ohne Betrag wird abgelehnt', async () => {
    await more('Anna', 'fix', '');
    await toast(page, /Bitte einen Betrag eintragen/);
  });
  await S('Leute: Löschen mit offenem Betrag wird verweigert', async () => {
    await more('Gerd', 'del', '');
    await toast(page, /Nicht gelöscht: Der Schuldschein ist nicht ausgeglichen\./);
    expect(await person('Gerd'), 'Gerd wurde trotz offenem Betrag gelöscht');
  });
  await S('Leute: Löschen bei 0,00 € entfernt die Person', async () => {
    await more('Dora', 'del', '');
    await toast(page, /Person gelöscht\./);
    await page.waitForFunction(() => ![...document.querySelectorAll('#app .it')].some(e => e.textContent.includes('Dora')));
    expect(!(await person('Dora')), 'Dora steht noch in der Datenbank');
  });
  await S('Leute: Rangliste nach Umsatz der letzten 30 Tage', async () => {
    const rows = await page.locator('#app .paper').nth(1).locator('tr').evaluateAll(trs => trs.slice(1).map(tr => [...tr.children].map(td => td.textContent).join('|')));
    eq(rows.slice(0, 4).join(' ; '), 'Emil|4,50|4,50 ; Anna|2,00|2,00 ; Ben|0,80|0,80 ; Gerd|0,00|3,00', 'Rangliste');
  });
  await S('Leute: QR-Code zeigt auf den Kiosk-Link', async () => {
    const want = CFG.url + '?k=' + CFG.code;
    eq((await page.locator('#app .poster p.brk').innerText()).trim(), want, 'angezeigter Link');
    const img = page.locator('#app .qr img');
    expect((await img.getAttribute('src')).startsWith('data:image/gif;base64,'), 'QR-Bild fehlt');
    const size = await img.evaluate(i => new Promise(r => { const f = () => r([i.naturalWidth, i.naturalHeight]); i.complete ? f() : (i.onload = f); }));
    expect(size[0] > 200 && size[0] === size[1], 'QR-Bild hat keine brauchbare Größe: ' + size.join('×'));
  });
  await S('Leute: QR-Code enthält genau diesen Link (im Browser nachgerechnet)', async () => {
    const same = await page.evaluate(url => {
      const q = qrcode(0, 'M'); q.addData(url); q.make();
      return document.querySelector('#app .qr img').getAttribute('src') === q.createDataURL(12, 4);
    }, CFG.url + '?k=' + CFG.code);
    expect(same, 'QR-Bild passt nicht zum angezeigten Link');
  });
  await S('Leute: Link kopieren', async () => {
    await hideToast(page);
    await act('a-copy');
    await toast(page, /Link kopiert\./);
    eq(await page.evaluate(() => navigator.clipboard.readText()), CFG.url + '?k=' + CFG.code, 'Zwischenablage');
  });
  await S('Leute: Aushang drucken öffnet den Druckdialog', async () => {
    await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
    await act('a-print');
    await page.waitForFunction(() => window.__printed === 1);
    await page.emulateMedia({ media: 'print' });
    expect(await page.locator('#app .poster .printonly').first().isVisible(), 'Aushang-Text ist im Druck nicht sichtbar');
    expect(await page.locator('#app .qr img').isVisible(), 'QR-Code ist im Druck nicht sichtbar');
    expect(!(await page.locator('#app [data-a="a-print"]').isVisible()), 'Knöpfe sind im Druck sichtbar');
    expect(!(await page.locator('#app .paper').first().isVisible()), 'Schuldscheine (Namen und Beträge) sind im Druck sichtbar');
    await page.emulateMedia({ media: 'screen' });
  });
  await S('Leute: Verwalter sieht keine PIN-Prüfwerte', async () => {
    const r = await page.evaluate(async () => { const { data, error } = await SB.from('persons').select('pin_hash').limit(1); return { data, error: error && error.message }; });
    expect(r.error && !r.data, 'PIN-Prüfwert lesbar: ' + JSON.stringify(r));
  });
  await S('Keine Fehler in der Browser-Konsole (Verwalter)', async () => {
    // Erwartet sind nur die bewusst ausgelösten Fehler (falsches Passwort, doppelte Namen, gesperrte Spalte).
    const real = page.problems.filter(p => !/favicon|status of 4\d\d|duplicate key|23505|permission denied/i.test(p));
    expect(real.length === 0, real.join(' · '));
  });
  await S('Abmelden führt zurück zur Anmeldung', async () => {
    await tab('leute');
    await act('a-out');
    await page.locator('#alog').waitFor();
    expect(await page.locator('#nav').isHidden(), 'Leiste nach dem Abmelden sichtbar');
    await page.reload();
    await page.locator('#alog').waitFor();
  });

  /* ---------- Gegenprobe: angemeldet, aber kein Verwalter ---------- */
  await S('Konto ohne Verwalter-Rechte: landet bei „Verwaltung einrichten“', async () => {
    await page.fill('#em', CFG.gast);
    await page.fill('#pw', CFG.pw);
    await page.locator('#alog button.pri').click();
    await see(page, 'noch nicht als Verwalter eingetragen');
    expect(await page.locator('#nav').isHidden(), 'Leiste für Nicht-Verwalter sichtbar');
  });
  await S('Konto ohne Verwalter-Rechte: Einrichtungscode wird abgelehnt', async () => {
    await hideToast(page);
    await page.fill('#sc', CFG.code);
    await page.locator('#claim button.pri').click();
    await toast(page, /Code falsch oder Verwaltung bereits vergeben\./);
  });
  await S('Konto ohne Verwalter-Rechte: sieht keine Daten und darf nichts ändern', async () => {
    const r = await page.evaluate(async () => {
      const out = { read: {}, write: {}, fn: {} };
      for (const t of ['settings', 'products', 'sales', 'ledger', 'journal', 'purchases', 'purchase_items', 'counts', 'cash_counts', 'alerts', 'requests', 'photo_jobs', 'admins', 'sessions']) {
        const { data, error } = await SB.from(t).select('*').limit(3); out.read[t] = error ? 'gesperrt' : data.length;
      }
      { const { data, error } = await SB.from('persons').select('id,vorname').limit(3); out.read.persons = error ? 'gesperrt' : data.length; }
      for (const [t, row] of [['products', { name: 'Eindringling', price_cents: 1 }], ['settings', { key: 'eindringling', value: '1' }], ['journal', { day: '2020-01-01', text: 'Eindringling', in_cents: 1 }], ['requests', { text: 'Eindringling' }], ['admins', { uid: '00000000-0000-0000-0000-000000000000' }]]) {
        const { error } = await SB.from(t).insert(row); out.write[t] = error ? 'gesperrt' : 'ERLAUBT';
      }
      { const { data, error } = await SB.from('products').update({ price_cents: 1 }).eq('name', 'Cola').select(); out.write['products ändern'] = error || !data.length ? 'gesperrt' : 'ERLAUBT'; }
      const nil = '00000000-0000-0000-0000-000000000000';
      const fns = { a_person: { p_vorname: 'Eindringling', p_pin: '0000' }, a_persons: { p_names: ['Eindringling'] }, a_pin: { p_person: nil, p_pin: '0000' }, a_person_delete: { p_person: nil },
        a_pay: { p_person: nil, p_cents: 1 }, a_fix: { p_person: nil, p_cents: 1 }, a_cash: { p_cents: 1 }, a_count: { p_items: [] }, a_purchase: { p_day: '2020-01-01', p_store: 'x', p_items: [] }, a_waste: { p_product: nil, p_qty: 1 } };
      for (const [f, a] of Object.entries(fns)) { const { error } = await SB.rpc(f, a); out.fn[f] = error ? error.message : 'ERLAUBT'; }
      { const { data } = await SB.storage.from('fotos').list('regal'); out.read.fotos = data ? data.length : 'gesperrt'; }
      { const { error } = await SB.storage.from('fotos').upload('regal/eindringling.jpg', new Blob(['x'], { type: 'image/jpeg' })); out.write.fotos = error ? 'gesperrt' : 'ERLAUBT'; }
      return out;
    });
    const leaks = Object.entries(r.read).filter(([, v]) => v !== 'gesperrt' && v !== 0).map(([k, v]) => `${k}: ${v} Zeilen lesbar`);
    const writes = Object.entries(r.write).filter(([, v]) => v !== 'gesperrt').map(([k]) => `${k}: Schreiben erlaubt`);
    const fns = Object.entries(r.fn).filter(([, v]) => !/nicht erlaubt|permission denied/.test(v)).map(([k, v]) => `${k}: ${v}`);
    expect(!leaks.length && !writes.length && !fns.length, [...leaks, ...writes, ...fns].join(' · '));
  });
  await S('Konto ohne Verwalter-Rechte: Abmelden', async () => {
    await page.locator('[data-a="a-out"]').click();
    await page.locator('#alog').waitFor();
  });
  await page.context().close();
};
