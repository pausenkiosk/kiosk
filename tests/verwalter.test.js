'use strict';
/* Verwalter-Bereich komplett: Anmeldung, Bon, Regal (inkl. Löschen), Fotos, Einkauf (von Hand, Ansage, Bon-Foto),
   Haltbarkeit, Kasse, Leute, Sicherung, Nachricht an Claude.
   Läuft nach dem Kollegen-Teil: Ben hat 1 Wasser angeschrieben (0,80 €), Clara ist gesperrt. */
const { CFG, step, setGroup, expect, eq, newPage, toast, hideToast, idle, fillModal, abgleich, anzahl, loggedOut, pickName, see, row, prow, rowHas, lnIs, anonApi, sql, isoDay } = require('./lib');

const dshort = iso => { const [, m, d] = iso.split('-'); return `${d}.${m}.`; };

module.exports = async function verwalter(browser) {
  setGroup('Verwalter');
  const page = await newPage(browser, { permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
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
    await abgleich(page, null);
    await see(page, 'Du hast noch keine Sicherung heruntergeladen. Bitte jetzt sichern.');
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
    await see(page, 'Einkauf von Hand');
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
    await toast(page, /^Diesen Namen gibt es schon\.$/);
  });
  await S('Regal: neues Produkt bietet kein „Endgültig löschen“ an', async () => {
    await page.locator('#app [data-a="a-prod"][data-id=""]').click();
    eq((await page.locator('#modal #f_active option').allInnerTexts()).join('|'), 'Ja|Nein', 'Auswahl „Im Kiosk sichtbar“');
    await fillModal(page, 'Neues Produkt', { name: 'Wegdamit', cat: 'Test', price: '1' });
    await rowHas(page, 'Wegdamit', /1,00/);
  });
  await S('Regal: Produkt löschen – Sicherheitsabfrage, Abbrechen behält das Produkt', async () => {
    await page.locator('#app button.it', { hasText: 'Wegdamit' }).click();
    eq((await page.locator('#modal #f_active option').allInnerTexts()).join('|'), 'Ja|Nein|Endgültig löschen …', 'Auswahl „Im Kiosk sichtbar“');
    await fillModal(page, 'Produkt bearbeiten', { active: 'del' });
    await page.locator('#modal h2', { hasText: 'Wegdamit endgültig löschen?' }).waitFor();
    await see(page, 'Das lässt sich nicht rückgängig machen', '#modal');
    await page.locator('#modal [data-a="m-x"]').click();
    await idle(page);
    expect(await product('Wegdamit'), 'Produkt wurde trotz Abbrechen gelöscht');
  });
  await S('Regal: Produkt endgültig löschen', async () => {
    await hideToast(page);
    await page.locator('#app button.it', { hasText: 'Wegdamit' }).click();
    await fillModal(page, 'Produkt bearbeiten', { active: 'del' });
    await fillModal(page, 'Wegdamit endgültig löschen?', {});
    await toast(page, /^Wegdamit gelöscht\.$/);
    await page.waitForFunction(() => ![...document.querySelectorAll('#app .it')].some(e => e.textContent.includes('Wegdamit')));
    expect(!(await product('Wegdamit')), 'Produkt steht noch in der Datenbank');
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
  const stored = () => page.evaluate(async () => {
    const out = [];
    for (const dir of ['foto', 'einkauf', 'regal']) for (const f of (await SB.storage.from('fotos').list(dir, { limit: 1000 })).data) if (f.name.endsWith('.jpg')) out.push(dir + '/' + f.name);
    return out;
  });
  await S('Fotos: Speicher ist zu Beginn leer (Reste früherer Läufe werden entfernt)', async () => {
    const old = await stored();
    if (old.length) await page.evaluate(async names => { await SB.storage.from('fotos').remove(names); }, old);
    eq((await stored()).length, 0, 'Fotos im Speicher');
  });
  await S('Fotos: Knopf öffnet die Dateiauswahl', async () => {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), act('a-foto')]);
    expect(chooser.isMultiple(), 'Dateiauswahl erlaubt nur ein Foto');
    await chooser.setFiles([]);
  });
  await S('Fotos: Hochladen legt einen Auftrag an', async () => {
    await upload(['regal1.png', 'regal2.png']);
    await toast(page, /2 Fotos gespeichert\. Der Vorschlag erscheint hier nach der Auswertung\./, 45000);
    await rowHas(page, 'Foto vom ' + dshort(isoDay()), /wartet auf Auswertung/);
    const j = await db('photo_jobs', 'paths,status');
    eq(j.length, 1, 'Anzahl Foto-Aufträge'); eq(j[0].status, 'neu', 'Status'); eq(j[0].paths.length, 2, 'Anzahl Fotos');
    const files = await stored();
    expect(files.length === 2 && j[0].paths.every(p => files.includes(p) && p.startsWith('foto/')), 'Fotos liegen nicht im Speicher: ' + files.join(','));
    eq((await db('photo_jobs', 'kind'))[0].kind, 'foto', 'Art des Auftrags');
  });
  await S('Fotos: Vorschlag prüfen füllt die Zählung vor und schließt den Auftrag ab', async () => {
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
  await S('Fotos: wartenden Auftrag löschen', async () => {
    await upload(['regal3.png']);
    await toast(page, /1 Foto gespeichert\./, 45000);
    await rowHas(page, 'Foto vom', /wartet auf Auswertung/);
    await row(page, 'Foto vom').locator('[data-a="a-jobdel"]').click();
    await page.waitForFunction(() => !document.querySelector('#app').textContent.includes('Foto vom'));
    eq((await db('photo_jobs', 'id', 'status', 'neu')).length, 0, 'offene Foto-Aufträge');
    eq((await stored()).length, 0, 'Fotos im Speicher nach dem Löschen');
  });

  await S('Fotos: mehr als 60 auf einmal – nur die ersten 60 werden hochgeladen', async () => {
    const tiny = await page.screenshot({ clip: { x: 0, y: 0, width: 40, height: 40 } });
    await hideToast(page);
    await page.evaluate(() => {
      window.__seen = [];
      const t = document.querySelector('#toast');
      const tick = () => { if (!t.hidden && window.__seen[window.__seen.length - 1] !== t.textContent) window.__seen.push(t.textContent); window.__raf = requestAnimationFrame(tick); };
      tick();
    });
    await page.locator('#foto').setInputFiles(Array.from({ length: 61 }, (_, i) => ({ name: `f${i}.png`, mimeType: 'image/png', buffer: tiny })));
    await toast(page, /^60 von 61 Fotos gespeichert, mehr als 60 auf einmal gehen nicht\. Den Rest bitte danach hochladen\.$/, 180000);
    await rowHas(page, 'Foto vom', /wartet auf Auswertung/);
    const j = await db('photo_jobs', 'paths', 'status', 'neu');
    eq(j.length, 1, 'offene Foto-Aufträge'); eq(j[0].paths.length, 60, 'Fotos im Auftrag');
    eq((await stored()).length, 60, 'Fotos im Speicher');
  });
  await S('Fotos: beim Hochladen ist der Fortschritt zu sehen', async () => {
    const seen = await page.evaluate(() => { cancelAnimationFrame(window.__raf); return window.__seen; });
    expect(seen.some(t => /^Foto \d+ von 60 wird hochgeladen …$/.test(t)), 'Kein Fortschritt gesehen: ' + seen.slice(0, 5).join(' | '));
  });
  await S('Fotos: Auftrag mit 60 Fotos löschen räumt den Speicher', async () => {
    await row(page, 'Foto vom').locator('[data-a="a-jobdel"]').click();
    await page.waitForFunction(() => !document.querySelector('#app').textContent.includes('Foto vom'), null, { timeout: 60000 });
    eq((await stored()).length, 0, 'Fotos im Speicher nach dem Löschen');
  });

  await S('Fotos: verwaiste alte Dateien werden beim Laden entfernt, frische und solche in Aufträgen bleiben', async () => {
    await upload(['bleibt.png']);
    await toast(page, /1 Foto gespeichert\./, 45000);
    await rowHas(page, 'Foto vom', /wartet auf Auswertung/);
    const inJob = (await db('photo_jobs', 'paths', 'status', 'neu'))[0].paths[0];
    await page.evaluate(async () => {
      for (const n of ['foto/waise-alt.jpg', 'einkauf/waise-alt.jpg', 'foto/waise-frisch.jpg']) {
        const { error } = await SB.storage.from('fotos').upload(n, new Blob(['x'], { type: 'image/jpeg' }), { contentType: 'image/jpeg' });
        if (error) throw new Error(error.message);
      }
    });
    // Alter lässt sich nur direkt in der Datenbank nachstellen: zwei Waisen und das Foto im Auftrag sind „2 Stunden alt“.
    await sql(`update storage.objects set created_at = now() - interval '2 hours' where bucket_id = 'fotos' and name in ('foto/waise-alt.jpg', 'einkauf/waise-alt.jpg', '${inJob}')`);
    eq((await stored()).length, 4, 'Dateien vor dem Aufräumen');
    await page.reload();
    await page.locator('#nav:not([hidden])').waitFor();
    let now = [];
    for (let i = 0; i < 40; i++) { now = await stored(); if (!now.some(n => n.includes('waise-alt'))) break; await page.waitForTimeout(500); }
    eq(now.slice().sort().join(','), [inJob, 'foto/waise-frisch.jpg'].sort().join(','), 'Dateien nach dem Aufräumen');
    await tab('regal');
    await row(page, 'Foto vom').locator('[data-a="a-jobdel"]').click();
    await page.waitForFunction(() => !document.querySelector('#app').textContent.includes('Foto vom'));
    await page.evaluate(async () => { await SB.storage.from('fotos').remove(['foto/waise-frisch.jpg']); });
    eq((await stored()).length, 0, 'Fotos im Speicher am Ende');
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
    await see(page, 'Einkauf per Foto oder Ansage');
    await see(page, 'Einkauf von Hand');
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
    await hideToast(page);
    await fillCart(0, 'Schokoriegel', '10', '7,90', '');
    await fillCart(1, null, '3', '', '');
    await act('a-buy');
    await toast(page, /In einer Zeile mit Stückzahl oder Preis fehlt das Produkt\. Bitte auswählen oder die Zeile leeren\./);
    await hideToast(page);
    await fillCart(1, null, '', '2,00', '');
    await act('a-buy');
    await toast(page, /In einer Zeile mit Stückzahl oder Preis fehlt das Produkt/);
    await fillCart(1, null, '', '', '');
    eq((await db('purchases', 'id')).length, 0, 'gespeicherte Einkäufe');
  });
  await S('Einkauf mit Haltbarkeitsdatum speichern', async () => {
    await hideToast(page);
    await page.fill('#estore', 'Testmarkt');
    await fillCart(0, 'Schokoriegel', '10', '7,90', isoDay(5));
    await fillCart(1, 'Wasser', '6', '2,94', isoDay(60));
    await fillCart(2, 'Testkeks', '4', '2', isoDay(20));
    await act('a-buy');
    await toast(page, /Einkauf gespeichert\./);
    await rowHas(page, 'Schokoriegel · 10 St', new RegExp(dshort(isoDay(5)).replace(/\./g, '\\.') + ' \\((4|5) T\\)'));
    await rowHas(page, 'Wasser · 6 St', new RegExp(dshort(isoDay(60)).replace(/\./g, '\\.') + ' \\((59|60) T\\)'));
    await rowHas(page, 'Testkeks · 4 St', /\((19|20) T\)/);
    expect(await row(page, 'Schokoriegel · 10 St').locator('i.lamp.r').count() === 1, 'Unter 14 Tagen ist die Ampel nicht rot');
    expect(await row(page, 'Testkeks · 4 St').locator('i.lamp.y').count() === 1, '14 bis 30 Tage: Ampel ist nicht gelb');
    expect(await row(page, 'Wasser · 6 St').locator('i.lamp.g').count() === 1, 'Über 30 Tage: Ampel ist nicht grün');
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
  await S('Bon: Haltbarkeitswarnung in zwei Stufen (unter 14 Tagen rot, 14 bis 30 Tage gelb)', async () => {
    await tab('bon');
    await see(page, 'Läuft in 14 Tagen ab (1)');
    await rowHas(page, 'Schokoriegel', new RegExp('10 St.*' + dshort(isoDay(5)).replace(/\./g, '\\.') + ' · (4|5) T'));
    await see(page, 'Läuft in 30 Tagen ab (1)');
    await rowHas(page, 'Testkeks', new RegExp('4 St.*' + dshort(isoDay(20)).replace(/\./g, '\\.') + ' · (19|20) T'));
    expect(await row(page, dshort(isoDay(5)) + ' ·').locator('i.lamp.r').count() === 1, 'Stufe unter 14 Tagen ist nicht rot');
    expect(await row(page, dshort(isoDay(20)) + ' ·').locator('i.lamp.y').count() === 1, 'Stufe 14 bis 30 Tage ist nicht gelb');
    expect(!(await page.locator('#app').innerText()).includes(dshort(isoDay(60)) + ' ·'), 'Ware mit 60 Tagen Rest steht auf dem Bon');
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
  await S('Preisliste: am Bildschirm unsichtbar, Knopf öffnet den Druckdialog', async () => {
    const sheet = page.locator('#app .paper.sheet.printonly');
    eq(await sheet.count(), 1, 'Preislisten im Regal');
    expect(!(await sheet.isVisible()), 'Preisliste ist am Bildschirm sichtbar');
    await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
    await page.locator('#app button', { hasText: 'Preisliste drucken' }).click();
    await page.waitForFunction(() => window.__printed === 1);
  });
  await S('Preisliste im Druck: nur aktive Produkte nach Gruppen, Abverkauf mit durchgestrichenem Normalpreis, sonst nichts', async () => {
    await page.emulateMedia({ media: 'print' });
    try {
      const sheet = page.locator('#app .paper.sheet.printonly');
      expect(await sheet.isVisible(), 'Preisliste ist im Druck nicht sichtbar');
      const visible = await page.locator('#app .paper').evaluateAll(ps => ps.filter(p => getComputedStyle(p).display !== 'none').length);
      eq(visible, 1, 'sichtbare Abschnitte im Druck');
      expect(!(await page.locator('#nav').isVisible()), 'Leiste ist im Druck sichtbar');
      expect(!(await page.locator('#app [data-a="a-cnt"]').isVisible()), 'Knöpfe sind im Druck sichtbar');
      await see(page, 'Preisliste · Stand', '#app .sheet');
      eq((await sheet.locator('h2').allTextContents()).join('|'), 'Getränke|Kaltgetränke|Süßes', 'Gruppen');
      const lines = await sheet.locator('.ln').evaluateAll(ls => ls.map(l => l.children[0].textContent + ': ' + l.children[1].innerHTML));
      eq(lines.join(' ; '), 'Wasser: 0,80 € ; Cola: 1,60 € ; Gummibärchen: 1,20 € ; Schokoriegel: <s>1,00</s> 0,50 € ; Testkeks: 0,90 €', 'Zeilen der Preisliste');
      const txt = await sheet.innerText();
      expect(!txt.includes('Kaffee'), 'Nicht sichtbares Produkt steht auf der Preisliste');
      expect(!/Anna|Ben|Clara|Emil|Gerd/.test(txt), 'Personennamen auf der Preisliste');
      const all = await page.evaluate(() => document.body.innerText);
      expect(!/St · |Rot unter|Antippen zum Bearbeiten/.test(all), 'Im Druck steht mehr als die Preisliste: ' + all.slice(0, 200));
    } finally { await page.emulateMedia({ media: 'screen' }); }
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
  await S('Regal: Produkt mit Einkauf und Haltbarkeitsdatum löschen nimmt dessen Daten mit, Kasse bleibt', async () => {
    const tk = await product('Testkeks');
    await tab('regal');
    await hideToast(page);
    await page.locator('#app button.it', { hasText: 'Testkeks' }).click();
    await fillModal(page, 'Produkt bearbeiten', { active: 'del' });
    await fillModal(page, 'Testkeks endgültig löschen?', {});
    await toast(page, /^Testkeks gelöscht\.$/);
    await idle(page);
    eq((await db('purchase_items', 'id', 'product_id', tk.id)).length, 0, 'Haltbarkeitsdaten des gelöschten Produkts');
    await tab('einkauf');
    expect(await page.locator('#app .it', { hasText: 'Testkeks' }).count() === 0, 'Gelöschtes Produkt steht noch in der Haltbarkeitsliste');
    await tab('bon');
    await lnIs(page, 'KASSENSTAND', '20,66');
    expect(!(await page.locator('#app').innerText()).includes('Läuft in 30 Tagen ab'), 'Warnung zum gelöschten Produkt steht noch auf dem Bon');
    await tab('einkauf');
  });
  await S('Haltbarkeit: „Verkauft, Hinweis erledigt“ entfernt den Hinweis ohne Bestandsänderung', async () => {
    await mhd('Wasser', { a: 'done', x: '' });
    await see(page, 'Keine offenen Haltbarkeitsdaten.');
    eq((await product('Wasser')).stock, 24, 'Bestand Wasser');
    await tab('bon');
    expect(!(await page.locator('#app').innerText()).includes('Läuft in'), 'Haltbarkeitswarnung steht noch auf dem Bon');
  });
  await S('Haltbarkeit ohne Einkauf: Datum ohne Stückzahl wird gewarnt und lässt sich erledigen', async () => {
    // Solche Einträge legt sonst Claude aus Produktfotos an (kein Einkauf, Stückzahl 0).
    await page.evaluate(async day => {
      const g = (await SB.from('products').select('id').eq('name', 'Gummibärchen')).data[0];
      const { error } = await SB.from('purchase_items').insert({ purchase_id: null, product_id: g.id, qty: 0, cents: 0, mhd: day });
      if (error) throw new Error(error.message);
    }, isoDay(10));
    await page.reload();
    await page.locator('#nav:not([hidden])').waitFor();
    await see(page, 'Läuft in 14 Tagen ab (1)');
    const d10 = dshort(isoDay(10));
    const txt = (await row(page, d10 + ' ·').innerText()).replace(/\s+/g, ' ').trim();
    expect(new RegExp('^Gummibärchen ' + d10.replace(/\./g, '\\.') + ' · (9|10) T$').test(txt), 'Bon-Zeile ohne Stückzahl erwartet, tatsächlich: ' + txt);
    await tab('einkauf');
    const t2 = (await row(page, d10).innerText()).replace(/\s+/g, ' ').trim();
    expect(/^Gummibärchen \d\d\.\d\d\. \((9|10) T\)/.test(t2), 'Haltbarkeitszeile ohne „0 St“ erwartet, tatsächlich: ' + t2);
    await idle(page); await hideToast(page);
    await row(page, d10).locator('[data-a="a-mhd"]').click();
    await fillModal(page, 'Gummibärchen', { a: 'waste', x: '' });
    await toast(page, /Bitte die entsorgte Stückzahl eintragen\./);
    await idle(page);
    eq((await db('sales', 'id', 'kind', 'verlust')).length, 1, 'Verlustbuchungen (nur die vom Schokoriegel)');
    await hideToast(page);
    await row(page, d10).locator('[data-a="a-mhd"]').click();
    await fillModal(page, 'Gummibärchen', { a: 'done', x: '' });
    await see(page, 'Keine offenen Haltbarkeitsdaten.');
    eq((await product('Gummibärchen')).stock, 0, 'Bestand Gummibärchen');
  });

  /* ---------- Einkauf per Bon/Screenshot oder Ansage ---------- */
  await S('Einkauf ansagen: leere Ansage wird nicht gespeichert', async () => {
    await tab('einkauf');
    await act('a-say');
    await fillModal(page, 'Einkauf ansagen', { t: '  ' });
    await idle(page);
    eq((await db('photo_jobs', 'id', 'kind', 'einkauf')).length, 0, 'Einkaufs-Aufträge');
  });
  await S('Einkauf ansagen: Ansage wird gespeichert und wartet auf Auswertung', async () => {
    await hideToast(page);
    await act('a-say');
    await fillModal(page, 'Einkauf ansagen', { t: 'Heute im Testbon-Markt 12 Cola für 9,48 und 6 Wasser für 3 Euro, Cola haltbar 40 Tage.' });
    await toast(page, /Gespeichert\. Der Vorschlag erscheint hier nach der Auswertung\./);
    await rowHas(page, 'Ansage', new RegExp(dshort(isoDay()).replace(/\./g, '\\.') + ' Ansage: wartet auf Auswertung'));
    const j = await db('photo_jobs', 'kind,status,text,paths', 'kind', 'einkauf');
    eq(j.length, 1, 'Einkaufs-Aufträge'); eq(j[0].status, 'neu', 'Status'); eq(j[0].paths.length, 0, 'Fotos'); expect(j[0].text.startsWith('Heute im Testbon-Markt'), 'Text der Ansage: ' + j[0].text);
    await tab('regal');
    expect(await page.locator('#app .it', { hasText: 'Foto vom' }).count() === 0, 'Einkaufs-Auftrag steht auch unter Regal');
    await tab('einkauf');
  });
  await S('Einkauf per Vorschlag: „Prüfen“ füllt das Formular (Laden, Datum, Zeilen, Haltbarkeit)', async () => {
    // Die Auswertung macht sonst Claude. Hier wird ihr Ergebnis nachgestellt.
    await page.evaluate(async ([day, mhd]) => {
      const id = async n => (await SB.from('products').select('id').eq('name', n)).data[0].id;
      const result = { store: 'Testbon-Markt', day, items: [{ id: await id('Cola'), qty: 12, cents: 948, mhd }, { id: await id('Wasser'), qty: 6, cents: 300 }, { id: '00000000-0000-0000-0000-000000000000', qty: 2, cents: 100 }] };
      const { error } = await SB.from('photo_jobs').update({ status: 'vorschlag', result, note: 'Preis Wasser geschätzt' }).eq('kind', 'einkauf');
      if (error) throw new Error(error.message);
    }, [isoDay(), isoDay(40)]);
    await page.reload();
    await page.locator('#nav:not([hidden])').waitFor();
    await tab('einkauf');
    await rowHas(page, 'Ansage', /Vorschlag liegt vor/);
    await act('a-draft');
    await see(page, 'Vorschlag prüfen');
    await see(page, 'Hinweis von Claude: Preis Wasser geschätzt');
    eq(await page.inputValue('#estore'), 'Testbon-Markt', 'Laden');
    eq(await page.inputValue('#eday'), isoDay(), 'Datum');
    eq(await page.locator('#cart .cart').count(), 3, 'Zeilen');
    const vals = await page.locator('#cart .cart').evaluateAll(rs => rs.map(r => [r.querySelector('select').selectedOptions[0].textContent, ...[...r.querySelectorAll('input')].map(i => i.value)].join('|')));
    eq(vals.join(' ; '), `Cola|12|9,48|${isoDay(40)} ; Wasser|6|3,00| ; Produkt …|2|1,00|`, 'vorbelegte Zeilen');
  });
  await S('Einkauf per Vorschlag: Zeile mit unbekanntem Produkt verhindert das Speichern', async () => {
    await hideToast(page);
    await act('a-buy');
    await toast(page, /In einer Zeile mit Stückzahl oder Preis fehlt das Produkt/);
    eq((await db('journal', 'id', 'text', 'Einkauf Testbon-Markt')).length, 0, 'gebuchte Einkäufe');
    await see(page, 'Vorschlag prüfen');
    await fillCart(2, null, '', '', '');
  });
  await S('Einkauf per Vorschlag: Speichern bucht den Einkauf und schließt den Auftrag ab', async () => {
    await hideToast(page);
    await act('a-buy');
    await toast(page, /Einkauf gespeichert\./);
    await see(page, 'Einkauf von Hand');
    expect(await page.locator('#app .it', { hasText: 'Ansage' }).count() === 0, 'Erledigter Vorschlag steht noch in der Liste');
    eq((await product('Cola')).stock, 22, 'Bestand Cola'); eq((await product('Wasser')).stock, 30, 'Bestand Wasser');
    eq(JSON.stringify(await db('journal', 'day,out_cents', 'text', 'Einkauf Testbon-Markt')), JSON.stringify([{ day: isoDay(), out_cents: 1248 }]), 'Kassenbuch-Eintrag');
    eq((await db('photo_jobs', 'status', 'kind', 'einkauf'))[0].status, 'fertig', 'Status des Auftrags');
    await rowHas(page, 'Cola · 12 St', /\((39|40) T\)/);
    eq(await page.inputValue('#estore'), '', 'Laden nach dem Speichern');
  });
  await S('Einkauf per Bon-Foto: Hochladen legt einen Einkaufs-Auftrag an, Löschen räumt auf', async () => {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), act('a-bon')]);
    expect(chooser.isMultiple(), 'Dateiauswahl erlaubt nur ein Foto');
    await chooser.setFiles([]);
    await hideToast(page);
    await page.locator('#bonfoto').setInputFiles([{ name: 'bon.png', mimeType: 'image/png', buffer: png }]);
    await toast(page, /1 Foto gespeichert\./, 45000);
    await rowHas(page, '1 Foto', /1 Foto: wartet auf Auswertung/);
    const j = await db('photo_jobs', 'kind,paths', 'status', 'neu');
    eq(j.length, 1, 'offene Aufträge'); eq(j[0].kind, 'einkauf', 'Art'); expect(j[0].paths[0].startsWith('einkauf/'), 'Ablageort: ' + j[0].paths[0]);
    eq((await stored()).join(','), j[0].paths[0], 'Fotos im Speicher');
    await row(page, '1 Foto').locator('[data-a="a-draftdel"]').click();
    await page.waitForFunction(() => !document.querySelector('#app').textContent.includes('wartet auf Auswertung'));
    eq((await stored()).length, 0, 'Fotos im Speicher nach dem Löschen');
    eq((await db('photo_jobs', 'id', 'status', 'neu')).length, 0, 'offene Aufträge nach dem Löschen');
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
    expect(/50,00 25,32 24,68/.test(top), 'Aktuelle Woche: erwartet Ein 50,00 Aus 25,32 Saldo 24,68, tatsächlich ' + top);
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
    await see(page, 'Wie viel Geld war in der Kasse?', '#modal');
    await fillModal(page, 'Kassensturz', { c: '3,00' });
    await toast(page, /^Gebucht: 3,00 € Barverkäufe\.$/);
    await rowHas(page, 'Barverkäufe', /3,00/);
    eq(JSON.stringify(await db('cash_counts', 'day,cents,bar_cents')), JSON.stringify([{ day: isoDay(), cents: 300, bar_cents: 300 }]), 'Kassensturz in der Datenbank');
  });
  await S('Kasse: Kassensturz – Abbrechen und leere Eingabe buchen nichts', async () => {
    await act('a-cash');
    await page.locator('#modal [data-a="m-x"]').click();
    await act('a-cash');
    await fillModal(page, 'Kassensturz', { c: '' });
    await idle(page);
    eq((await db('cash_counts', 'id')).length, 1, 'Anzahl Kassenstürze');
  });
  await S('Bon: Abgleich Ware/Kasse nach dem ersten Kassensturz', async () => {
    await tab('bon');
    await abgleich(page, 100, null);   // alt: 2 Cola à 1,60 + 1 Wasser à 0,80 fehlen, 3,00 in der Kasse; neu: erst ab dem zweiten Kassensturz
    await lnIs(page, 'KASSENSTAND', '11,18');
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
    const j = await db('journal', 'day,in_cents,out_cents,source,kind', 'text', 'Testregal');
    eq(JSON.stringify(j), JSON.stringify([{ day: isoDay(-1), in_cents: 0, out_cents: 123456, source: 'hand', kind: 'hand' }]), 'Buchung in der Datenbank');
  });
  await S('Kasse: Buchung von Hand ohne Text wird nicht gespeichert', async () => {
    await act('a-jour');
    await fillModal(page, 'Buchung von Hand', { t: '', i: '5' });
    await idle(page);
    eq((await db('journal', 'id', 'source', 'hand')).length, 3, 'Anzahl Hand-Buchungen');   // 1 aus den Testdaten + 2 neue
  });
  await S('Bereichswechsel geht auch, während noch gespeichert wird; andere Knöpfe melden „Einen Moment“', async () => {
    await act('a-jour');
    await fillModal(page, 'Buchung von Hand', { t: 'Testwechsel', i: '0,01' }, false);
    const r = await page.evaluate(async () => {
      document.querySelector('#modal button.pri').click();
      await new Promise(f => setTimeout(f, 0));
      const wasBusy = busy;
      document.querySelector('#app [data-a="a-cash"]').click();
      const t = document.querySelector('#toast'), hint = t.hidden ? '' : t.textContent, modalOpen = !document.querySelector('#modal').hidden;
      document.querySelector('#nav [data-t="leute"]').click();
      return { wasBusy, hint, modalOpen, tab: document.querySelector('#nav .on').dataset.t, text: document.querySelector('#app h2').textContent.replace(/\s*i$/, '').trim() };
    });
    expect(r.wasBusy, 'Speichern war schon fertig, Prüfung nicht aussagekräftig');
    eq(r.hint, 'Einen Moment, die letzte Eingabe wird noch gespeichert …', 'Hinweis beim Tippen während des Speicherns');
    expect(!r.modalOpen, 'Zweiter Dialog ging während des Speicherns auf');
    eq(r.tab + '/' + r.text, 'leute/Schuldscheine', 'Bereich direkt nach dem Wechsel');
    await idle(page);
    eq(await page.locator('#nav .on').getAttribute('data-t'), 'leute', 'Bereich nach Ende des Speicherns');
    eq((await db('journal', 'in_cents', 'text', 'Testwechsel')).length, 1, 'Buchung trotz Wechsel gespeichert');
    await page.evaluate(async () => { await SB.from('journal').delete().eq('text', 'Testwechsel'); });
    await page.reload();
    await page.locator('#nav:not([hidden])').waitFor();
  });
  await S('Kasse: Kassenstand folgt den Buchungen, negativ wird rot', async () => {
    await tab('bon');
    await lnIs(page, 'KASSENSTAND', '-1.211,04');   // 11,18 + 12,34 − 1.234,56
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
    await toast(page, /^Diesen Namen gibt es schon\.$/);
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
    await see(page, 'Offen: 4,50 €. Alles darüber wird Guthaben.', '#modal');
    await fillModal(page, 'Einzahlung von Emil', { c: '4,50' });
    await toast(page, /^Gebucht\. Schuldschein ist ausgeglichen\.$/);
    await rowHas(page, 'Emil', /0,00/);
    eq(await saldo('Emil'), 0, 'Schuldschein Emil');
    const j = await db('journal', 'day,in_cents', 'text', 'Zahlung Schuldschein');
    eq(JSON.stringify(j), JSON.stringify([{ day: isoDay(), in_cents: 450 }]), 'Kassenbuch-Eintrag zur Zahlung');
  });
  await S('Leute: Zahlung ohne Betrag bucht nichts', async () => {
    await prow(page, 'Gerd').locator('[data-a="a-pay"]').click();
    await fillModal(page, 'Einzahlung von Gerd', { c: '' });
    await idle(page);
    eq(await saldo('Gerd'), 300, 'Schuldschein Gerd');
  });
  await S('Leute: Teilzahlung lässt einen Rest stehen', async () => {
    await prow(page, 'Gerd').locator('[data-a="a-pay"]').click();
    await hideToast(page);
    await fillModal(page, 'Einzahlung von Gerd', { c: '1' });
    await toast(page, /^Gebucht\. Noch offen: 2,00 €\.$/);
    await rowHas(page, 'Gerd', /2,00/);
  });
  const more = async (name, a, x) => {
    await idle(page); await hideToast(page);
    await prow(page, name).locator('[data-a="a-more"]').click();
    await page.locator('#modal:not([hidden]) #f_a').waitFor();
    // ab v21 gibt es statt „korrigieren (+ / −)“ die Auswahl Schulden/Guthaben übertragen (Betrag ohne Vorzeichen)
    if (a === 'fix' && !(await page.locator('#modal #f_a option[value="fix"]').count())) { a = /^[-−]/.test(x) ? 'guthaben' : 'schuld'; x = x.replace(/^[-−]/, ''); }
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
  await S('Leute: Korrektur versteht das typografische Minus aus dem Hinweistext (−)', async () => {
    await more('Anna', 'fix', '−0,50');
    await rowHas(page, 'Anna', /1,00/);
    eq(await saldo('Anna'), 100, 'Schuldschein Anna');
    await more('Anna', 'fix', '0,50');
    await rowHas(page, 'Anna', /1,50/);
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
    const rows = await page.locator('#app .paper', { hasText: 'Rangliste Umsatz' }).locator('tr').evaluateAll(trs => trs.slice(1).map(tr => [...tr.children].map(td => td.textContent).join('|')));
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
  /* ---------- QR-Code erneuern ---------- */
  const setting = async k => ((await db('settings', 'value', 'key', k))[0] || {}).value;
  const setCodeAge = async days => {
    await page.evaluate(async day => { const { error } = await SB.from('settings').upsert({ key: 'kiosk_code_at', value: day }); if (error) throw new Error(error.message); }, isoDay(-days));
    await page.reload();
    await page.locator('#nav:not([hidden])').waitFor();
  };
  await S('QR-Code: unter 30 Tagen kein Hinweis auf dem Bon', async () => {
    await setCodeAge(29);
    await see(page, 'KASSENSTAND');
    expect(!(await page.locator('#app').innerText()).toLowerCase().includes('qr-code erneuern'), 'Hinweis erscheint schon nach 29 Tagen');
  });
  await S('QR-Code: ab 30 Tagen Hinweis „QR-Code erneuern“ auf dem Bon, Knopf führt zu Leute', async () => {
    await setCodeAge(30);
    await see(page, 'QR-Code erneuern');
    await see(page, 'Der QR-Code am Kiosk ist 30 Tage alt.');
    await page.locator('#app button', { hasText: 'Zu Leute' }).click();
    await page.locator('#nav [data-t="leute"].on').waitFor();
    await see(page, 'Schuldscheine');
  });
  const kpage = await newPage(browser);
  await S('QR-Code: Vorbereitung – Kollegin Anna meldet sich mit dem alten Code an', async () => {
    await kpage.goto(`${CFG.url}?k=${CFG.code}`);
    await pickName(kpage, 'Anna');
    await kpage.fill('#pin', '1111');
    await kpage.locator('#kpin button.pri').click();
    await see(kpage, 'Schuldschein von Anna');
  });
  await S('QR-Code erneuern: Sicherheitsabfrage, Abbrechen lässt den Code unverändert', async () => {
    await act('a-newcode');
    await page.locator('#modal h2', { hasText: 'Neuen QR-Code erzeugen?' }).waitFor();
    await see(page, 'werden sofort ungültig', '#modal');
    await page.locator('#modal [data-a="m-x"]').click();
    await idle(page);
    eq(await setting('kiosk_code'), CFG.code, 'Kiosk-Code nach Abbrechen');
  });
  let newCode = null;
  await S('QR-Code erneuern: neuer Code, neuer Link, neues QR-Bild, Datum von heute', async () => {
    const oldSrc = await page.locator('#app .qr img').getAttribute('src');
    await hideToast(page);
    await act('a-newcode');
    await fillModal(page, 'Neuen QR-Code erzeugen?', {});
    await toast(page, /^Neuer QR-Code erzeugt\. Bitte den Aushang neu drucken\.$/);
    await idle(page);
    const code = await setting('kiosk_code');
    expect(/^[0-9a-f]{16}$/.test(code) && code !== CFG.code, 'Neuer Code unerwartet: Länge ' + String(code).length);
    newCode = code;
    eq(await setting('kiosk_code_at'), isoDay(), 'Datum des Codes');
    eq((await page.locator('#app .poster p.brk').innerText()).trim(), CFG.url + '?k=' + code, 'angezeigter Link');
    expect(await page.locator('#app .qr img').getAttribute('src') !== oldSrc, 'QR-Bild hat sich nicht geändert');
    await tab('bon');
    expect(!(await page.locator('#app').innerText()).toLowerCase().includes('qr-code erneuern'), 'Hinweis steht nach dem Erneuern noch auf dem Bon');
    await tab('leute');
  });
  await S('QR-Code erneuern: alter Code ist sofort ungültig, neuer gilt', async () => {
    expect(newCode, 'kein neuer Code aus dem vorigen Schritt');
    const api = await anonApi();
    const old = await (await api.post('/rest/v1/rpc/k_names', { data: { p_code: CFG.code } })).json();
    eq(old, null, 'Namensliste mit altem Code');
    const anna = await person('Anna');
    const l1 = await (await api.post('/rest/v1/rpc/k_login', { data: { p_code: CFG.code, p_person: anna.id, p_pin: '1111' } })).json();
    expect(l1.ok === false && l1.err === 'code', 'Anmeldung mit altem Code: ' + JSON.stringify(l1));
    const names = await (await api.post('/rest/v1/rpc/k_names', { data: { p_code: newCode } })).json();
    expect(Array.isArray(names) && names.some(n => n.vorname === 'Anna'), 'Namensliste mit neuem Code: ' + JSON.stringify(names).slice(0, 100));
    const l2 = await (await api.post('/rest/v1/rpc/k_login', { data: { p_code: newCode, p_person: anna.id, p_pin: '1111' } })).json();
    expect(l2.ok === true, 'Anmeldung mit neuem Code: ' + JSON.stringify(l2));
    await api.post('/rest/v1/rpc/k_logout', { data: { p_token: l2.token } });
    await api.dispose();
  });
  await S('QR-Code erneuern: angemeldete Kollegin bleibt angemeldet und kann weiter anschreiben', async () => {
    const before = await saldo('Anna');
    await kpage.reload();
    await see(kpage, 'Schuldschein von Anna');
    await kpage.locator('button.it', { hasText: 'Wasser' }).click();
    await anzahl(kpage, 'Wasser', 1);
    await toast(kpage, /Wasser angeschrieben/);
    eq(await saldo('Anna'), before + 80, 'Schuldschein Anna nach dem Anschreiben');
  });
  await S('QR-Code erneuern: nach dem Abmelden geht es mit dem alten Link nicht mehr, mit dem neuen schon', async () => {
    await idle(kpage);
    await kpage.locator('[data-a="k-logout"]').click();
    await see(kpage, 'Dieser QR-Code ist nicht mehr gültig');
    await kpage.goto(`${CFG.url}?k=${CFG.code}`);
    await see(kpage, 'Dieser QR-Code ist nicht mehr gültig');
    expect(newCode, 'kein neuer Code');
    await kpage.goto(`${CFG.url}?k=${newCode}`);
    await pickName(kpage, 'Anna');
    await see(kpage, 'Hallo Anna');
  });
  await kpage.context().close();
  await S('QR-Code: Aushang druckt weiterhin nur den Aushang (mit neuem Code)', async () => {
    await tab('leute');
    await page.emulateMedia({ media: 'print' });
    try {
      const visible = await page.locator('#app .paper').evaluateAll(ps => ps.filter(p => getComputedStyle(p).display !== 'none').map(p => p.className));
      eq(visible.join('|'), 'paper poster sheet', 'sichtbare Abschnitte im Druck');
      const all = await page.evaluate(() => document.body.innerText);
      expect(!/Preisliste|Rangliste|Schuldscheine|Emil|Gerd/.test(all), 'Im Druck steht mehr als der Aushang: ' + all.slice(0, 200));
      expect(await page.locator('#app .qr img').isVisible(), 'QR-Code im Druck nicht sichtbar');
    } finally { await page.emulateMedia({ media: 'screen' }); }
  });
  await S('Leute: Verwalter sieht keine PIN-Prüfwerte', async () => {
    const r = await page.evaluate(async () => { const { data, error } = await SB.from('persons').select('pin_hash').limit(1); return { data, error: error && error.message }; });
    expect(r.error && !r.data, 'PIN-Prüfwert lesbar: ' + JSON.stringify(r));
  });
  /* ---------- Sicherung ---------- */
  await S('Sicherung herunterladen: Datei enthält die Daten, aber keine PINs und keinen Kiosk-Code', async () => {
    await tab('bon');
    await hideToast(page);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), act('a-backup')]);
    eq(dl.suggestedFilename(), `kiosk-sicherung-${isoDay()}.json`, 'Dateiname');
    await toast(page, /Sicherung erstellt\./);
    const txt = require('fs').readFileSync(await dl.path(), 'utf8');
    const data = JSON.parse(txt);
    const want = ['products', 'sales', 'ledger', 'journal', 'purchases', 'purchase_items', 'counts', 'cash_counts', 'alerts', 'requests', 'persons', 'settings', 'erstellt'];
    expect(want.every(k => k in data), 'In der Sicherung fehlt: ' + want.filter(k => !(k in data)).join(', '));
    for (const t of ['products', 'ledger', 'journal', 'purchases', 'purchase_items', 'counts', 'cash_counts', 'requests', 'persons']) {
      eq(data[t].length, (await db(t, 'id')).length, 'Zeilen in der Sicherung: ' + t);
    }
    expect(data.persons.every(p => !('pin_hash' in p) && p.vorname), 'Personen enthalten PIN-Prüfwerte oder keinen Vornamen');
    const codeNow = await setting('kiosk_code');
    expect(!/pin_hash|setup_code/.test(txt) && !data.settings.some(x => x.key === 'kiosk_code') && !txt.includes(CFG.code) && !txt.includes(codeNow), 'Sicherung enthält PIN-Prüfwert oder Kiosk-Code');
    expect(!/token_hash|encrypted_password/.test(txt), 'Sicherung enthält Sitzungs- oder Anmeldedaten');
  });
  await S('Sicherung: Bon zeigt das Datum der letzten Sicherung', async () => {
    await see(page, `Letzte heruntergeladene Sicherung: ${dshort(isoDay())} (heute).`);
    expect(!(await page.locator('#app').innerText()).includes('Bitte jetzt sichern'), 'Mahnung trotz frischer Sicherung');
  });
  await S('Sicherung: „gestern“ statt „vor 1 Tagen“', async () => {
    await page.evaluate(async day => { await SB.from('settings').upsert({ key: 'backup_at', value: day }); }, isoDay(-1));
    await page.reload();
    await page.locator('#nav:not([hidden])').waitFor();
    await see(page, `Letzte heruntergeladene Sicherung: ${dshort(isoDay(-1))} (gestern).`);
  });
  await S('Sicherung: älter als 14 Tage wird angemahnt', async () => {
    await page.evaluate(async day => { await SB.from('settings').upsert({ key: 'backup_at', value: day }); }, isoDay(-20));
    await page.reload();
    await page.locator('#nav:not([hidden])').waitFor();
    await see(page, `Letzte heruntergeladene Sicherung: ${dshort(isoDay(-20))} (vor 20 Tagen). Bitte jetzt sichern.`);
    expect(await page.locator('#app p.neg', { hasText: 'Bitte jetzt sichern' }).count() === 1, 'Mahnung ist nicht rot hervorgehoben');
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
        a_pay: { p_person: nil, p_cents: 1 }, a_fix: { p_person: nil, p_cents: 1 }, a_cash: { p_cents: 1 }, a_cash_box: { p_cents: 1 }, a_count: { p_items: [] }, a_purchase: { p_day: '2020-01-01', p_store: 'x', p_items: [] }, a_waste: { p_product: nil, p_qty: 1 }, a_storno: { p_journal: nil }, a_payout: { p_person: nil, p_cents: 1 } };
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
