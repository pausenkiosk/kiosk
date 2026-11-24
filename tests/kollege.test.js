'use strict';
/* Kollegen-Ansicht: QR-Link, Anmeldung mit PIN, Sperre, Einwilligung, Anschreiben, Rückgängig, PIN ändern. */
const { CFG, step, setGroup, expect, eq, newPage, toast, hideToast, fillModal, anzahl, zusammen, loggedOut, pickName, see, rowHas, rowText, lnIs } = require('./lib');

const KURL = () => `${CFG.url}?k=${encodeURIComponent(CFG.code)}`;

async function pick(page, name) {
  await pickName(page, name);
  await see(page, 'Hallo ' + name);
}
async function pin(page, value) {
  await hideToast(page);
  await page.fill('#pin', value);
  await page.locator('#kpin button.pri').click();
}

module.exports = async function kollege(browser) {
  let page = null;
  /* „PIN ändern“ ausfüllen; ab v25 muss die neue PIN wiederholt werden */
  const pinDialog = async (o, n) => {
    await page.locator('#modal:not([hidden]) h2', { hasText: 'PIN ändern' }).waitFor();
    const w = (await page.locator('#modal #f_w').count()) ? { w: n } : {};
    await fillModal(page, 'PIN ändern', { o, n, ...w });
  };
  setGroup('Kollege');
  page = await newPage(browser);
  const S = step;
  const step_ = (n, f) => S(n, f, page);

  await step_('Ohne QR-Code: Startseite bittet ums Scannen', async () => {
    await page.goto(CFG.url);
    await see(page, 'Bitte den QR-Code am Kiosk scannen');
    expect(await page.locator('#nav').isHidden(), 'Verwalter-Leiste ist ohne Anmeldung sichtbar');
  });
  await step_('Falscher QR-Code wird abgelehnt', async () => {
    await page.goto(`${CFG.url}?k=gibtesnicht`);
    await see(page, 'Dieser QR-Code ist nicht mehr gültig');
    expect(await page.locator('.namegrid').count() === 0, 'Namensliste trotz falschem Code sichtbar');
  });
  await step_('Richtiger QR-Code zeigt die Namensliste', async () => {
    await page.goto(KURL());
    await see(page, 'Wer bist du?');
    const names = await page.locator('.namegrid button').allInnerTexts();
    eq(names.join(','), 'Anna,Ben,Clara,Emil,Gerd', 'Namensliste');
  });
  await step_('Anmeldung: falsche PIN zeigt Restversuche, „Zurück“ führt zur Liste', async () => {
    await pick(page, 'Ben');
    await pin(page, '0000');
    await toast(page, /Falsche PIN\. Noch 2 Versuche\./);
    eq(await page.inputValue('#pin'), '', 'PIN-Feld nach Fehlversuch');
    await page.locator('[data-a="k-back"]').click();
    await see(page, 'Wer bist du?');
  });
  await step_('Anmeldung mit richtiger PIN führt zur Einwilligung', async () => {
    await pick(page, 'Ben');
    await pin(page, '2222');
    await see(page, 'Kurz vorab, Ben');
    await see(page, 'Mitmachen ist freiwillig');
    await page.locator('summary', { hasText: 'Genau nachlesen' }).click();
    await see(page, 'Was nicht gespeichert wird');
  });
  await step_('Ohne Einwilligung ist Anschreiben nicht möglich (direkter Aufruf)', async () => {
    const r = await page.evaluate(async () => {
      const cola = (await SB.rpc('k_state', { p_token: K.token })).data.products.find(p => p.name === 'Cola');
      return (await SB.rpc('k_buy', { p_token: K.token, p_product: cola.id, p_qty: 1 })).data;
    });
    expect(r && r.ok === false && r.err === 'einwilligung', 'k_buy ohne Einwilligung: ' + JSON.stringify(r));
  });
  await step_('Einwilligung „Lieber nicht“ meldet ab', async () => {
    await page.locator('[data-a="k-logout"]').click();
    await loggedOut(page);
    expect(await page.evaluate(() => localStorage.getItem('ktoken')) === null, 'Sitzung nach „Lieber nicht“ noch gespeichert');
  });
  await step_('Einwilligung „Einverstanden“ öffnet den Schuldschein', async () => {
    await pick(page, 'Ben');
    await pin(page, '2222');
    await see(page, 'Kurz vorab, Ben');
    await page.locator('[data-a="k-consent"]').click();
    await see(page, 'Schuldschein von Ben');
    await lnIs(page, 'OFFEN', '0,00 €');
    await see(page, 'Noch nichts gebucht.');
  });
  await step_('Bestand: Gruppen, Preise, Stückzahlen; ausgeblendetes Produkt fehlt', async () => {
    const heads = await page.locator('#app .paper h2').allTextContents();
    expect(['Getränke', 'Süßes'].every(h => heads.includes(h)), 'Gruppen fehlen: ' + heads.join(', '));
    await rowHas(page, 'Cola', /12 St.*1,50 €/);
    await rowHas(page, 'Wasser', /20 St.*0,80 €/);
    // bis v24 stand ein leeres Produkt als „aus“ in der Liste, ab v25 wird es den Kollegen nicht mehr gezeigt
    if (await page.locator('#app .it', { hasText: 'Gummibärchen' }).count()) await rowHas(page, 'Gummibärchen', /aus.*1,20 €/);
    expect(await page.locator('#app .it', { hasText: 'Kaffee' }).count() === 0, 'Nicht sichtbares Produkt „Kaffee“ wird Kollegen angezeigt');
  });
  await step_('Anschreiben: Abbrechen bucht nichts', async () => {
    await page.locator('button.it', { hasText: 'Cola' }).click();
    await anzahl(page, 'Cola', 1, false);
    await lnIs(page, 'OFFEN', '0,00 €');
  });
  await step_('Anschreiben: 2 × Cola erhöht den offenen Betrag und senkt den Bestand', async () => {
    await page.locator('button.it', { hasText: 'Cola' }).click();
    if (await page.locator('#modal #f_qty').count()) eq((await page.locator('#modal #f_qty option').allInnerTexts())[1], '2 × = 3,00 €', 'Auswahltext für 2 Stück');
    else {   // ab v29: fünf Knöpfe, 1 vorgewählt, „Zusammen“ rechnet mit
      const m = page.locator('#modal:not([hidden])');
      eq((await m.locator('[data-q]').evaluateAll(bs => bs.map(b => b.dataset.q))).join(','), '1,2,3,4,5,x,ok', 'Knöpfe im Dialog');
      eq(await m.locator('[data-q="1"]').getAttribute('aria-pressed'), 'true', '1 vorgewählt');
      await see(page, 'Wie viele? Je 1,50 €', '#modal');
      await zusammen(page, '1,50 €');
      await m.locator('[data-q="2"]').click();
      await zusammen(page, '3,00 €');
      eq(`${await m.locator('[data-q="2"]').getAttribute('aria-pressed')}/${await m.locator('[data-q="1"]').getAttribute('aria-pressed')}`, 'true/false', 'Markierung nach Wahl von 2');
    }
    await anzahl(page, 'Cola', 2);
    await toast(page, /Cola angeschrieben\. 5 Minuten lang rückgängig möglich\./);
    await lnIs(page, 'OFFEN', '3,00 €');
    await rowHas(page, 'Cola', /10 St/);
    await rowHas(page, 'Kauf', /Rückgängig.*3,00/);
  });
  await step_('Rückgängig nimmt die Buchung zurück und füllt den Bestand wieder auf', async () => {
    await hideToast(page);
    await page.locator('[data-a="k-undo"]').first().click();
    await toast(page, /Buchung zurückgenommen\./);
    await lnIs(page, 'OFFEN', '0,00 €');
    await rowHas(page, 'Cola', /12 St/);
    await see(page, 'Noch nichts gebucht.');
  });
  await step_('Anschreiben: 1 × Wasser bleibt stehen', async () => {
    await hideToast(page);
    await page.locator('button.it', { hasText: 'Wasser' }).click();
    await anzahl(page, 'Wasser', 1);
    await toast(page, /Wasser angeschrieben/);
    await lnIs(page, 'OFFEN', '0,80 €');
    await rowHas(page, 'Wasser', /19 St/);
  });
  await step_('Kiosk-Code bleibt in der Adresse (für das Symbol auf dem Home-Bildschirm)', async () => {
    eq(new URL(page.url()).searchParams.get('k'), CFG.code, 'Kiosk-Code in der Adresse nach Anmeldung und Buchung');
  });
  await step_('Sitzung bleibt nach neuem Laden der Seite bestehen', async () => {
    await page.reload();
    await see(page, 'Schuldschein von Ben');
    await lnIs(page, 'OFFEN', '0,80 €');
  });
  await step_('PIN ändern: falsche alte PIN wird abgelehnt', async () => {
    await hideToast(page);
    await page.locator('[data-a="k-pin"]').click();
    await pinDialog('9999', '7777');
    await toast(page, /Nicht geändert/);
  });
  await step_('PIN ändern: neue PIN muss 4 Ziffern haben', async () => {
    await hideToast(page);
    await page.locator('[data-a="k-pin"]').click();
    await pinDialog('2222', '12');
    await toast(page, /Nicht geändert/);
  });
  await step_('PIN ändern: mit richtiger alter PIN klappt es', async () => {
    await hideToast(page);
    await page.locator('[data-a="k-pin"]').click();
    await pinDialog('2222', '7777');
    await toast(page, /^PIN geändert\.$/);
  });
  await step_('Abmelden, alte PIN gilt nicht mehr, neue PIN gilt', async () => {
    await page.locator('[data-a="k-logout"]').click();
    await loggedOut(page);
    await pick(page, 'Ben');
    await pin(page, '2222');
    await toast(page, /Falsche PIN\. Noch 2 Versuche\./);
    await pin(page, '7777');
    await see(page, 'Schuldschein von Ben');
    await lnIs(page, 'OFFEN', '0,80 €');
    await page.locator('[data-a="k-logout"]').click();
    await loggedOut(page);
  });
  await step_('Sperre: nach 3 falschen PINs ist die Anmeldung gesperrt', async () => {
    await pick(page, 'Clara');
    await pin(page, '0001');
    await toast(page, /Falsche PIN\. Noch 2 Versuche\./);
    await pin(page, '0002');
    await toast(page, /Falsche PIN\. Noch 1 Versuch\./);
    await pin(page, '0003');
    await toast(page, /Gesperrt bis \d{2}:\d{2} Uhr\./);
  });
  await step_('Sperre: auch die richtige PIN hilft jetzt nicht', async () => {
    await pin(page, '3333');
    await toast(page, /Gesperrt bis \d{2}:\d{2} Uhr\./);
    expect(await page.locator('#kpin').count() === 1, 'Trotz Sperre angemeldet');
    expect(await page.evaluate(() => localStorage.getItem('ktoken')) === null, 'Trotz Sperre wurde eine Sitzung gespeichert');
  });
  await step_('Sperre gilt etwa 1 Stunde', async () => {
    const txt = await page.locator('#toast').innerText();
    const [h, m] = txt.match(/(\d{2}):(\d{2})/).slice(1).map(Number);
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
    let diff = (h * 60 + m) - (now.getHours() * 60 + now.getMinutes());
    if (diff < 0) diff += 1440;
    expect(diff >= 57 && diff <= 61, `Sperre endet in ${diff} Minuten, erwartet rund 60`);
  });
  await step_('Keine Fehler in der Browser-Konsole (Kollege)', async () => {
    const real = page.problems.filter(p => !/favicon/.test(p));
    expect(real.length === 0, real.join(' · '));
  });
  await page.context().close();
};
