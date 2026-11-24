'use strict';
/* Übertrag vom Papier-Schuldschein (ab app.js v21): „Schulden übertragen“ / „Guthaben übertragen“ unter Leute → „…“. */
const { CFG, step, setGroup, expect, eq, newPage, toast, hideToast, idle, fillModal, listSaldo, see, prow, lnIs } = require('./lib');

const eur = c => (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

module.exports = async function uebertrag(browser) {
  setGroup('Übertrag');
  const page = await newPage(browser);
  const kp = await newPage(browser);
  const S = (n, f) => step(n, f, page), K = (n, f) => step(n, f, kp);
  const tab = async t => { await idle(page); await page.locator(`#nav [data-t="${t}"]`).click(); await page.locator(`#nav [data-t="${t}"].on`).waitFor(); };
  const db = (table, select, filterCol, filterVal) => page.evaluate(async ([t, s, c, v]) => {
    let q = SB.from(t).select(s); if (c) q = q.eq(c, v);
    const { data, error } = await q; if (error) throw new Error(error.message); return data;
  }, [table, select, filterCol, filterVal]);
  const rpc = (fn, args) => page.evaluate(async ([f, a]) => { const { data, error } = await SB.rpc(f, a); return error ? { error: error.message } : { data }; }, [fn, args]);
  const ids = {}; let code = null, n0 = 0, stand0 = 0;
  const ledger = async n => (await db('ledger', 'amount_cents,kind', 'person_id', ids[n])).map(l => `${l.kind}:${l.amount_cents}`).sort().join(',');
  const saldo = async n => (await db('ledger', 'amount_cents', 'person_id', ids[n])).reduce((a, l) => a + l.amount_cents, 0);
  const stand = async () => (await db('journal', 'in_cents,out_cents')).reduce((a, x) => a + x.in_cents - x.out_cents, 0);
  const anzeige = n => listSaldo(page, n);   // Cent, negativ = Guthaben
  /* Dialog „…“ ausfüllen; liefert den Hinweis danach */
  const mehr = async (name, aktion, betrag) => {
    await idle(page); await hideToast(page);
    await prow(page, name).locator('[data-a="a-more"]').click();
    await fillModal(page, name, aktion === null ? { x: betrag } : { a: aktion, x: betrag });
    await page.waitForFunction(() => !document.querySelector('#toast').hidden);
    const t = await page.locator('#toast').innerText();
    await idle(page);
    return t;
  };

  await S('Vorbereitung: anmelden, Wanda und Willi anlegen', async () => {
    await page.goto(CFG.url + '#verwaltung');
    await page.locator('#alog').waitFor();
    await page.fill('#em', CFG.email); await page.fill('#pw', CFG.pw);
    await page.locator('#alog button.pri').click();
    await see(page, 'KASSENSTAND');
    code = (await db('settings', 'value', 'key', 'kiosk_code'))[0].value;
    for (const [n, p] of [['Wanda', '4141'], ['Willi', '4242']]) { const r = await rpc('a_person', { p_vorname: n, p_pin: p }); expect(!r.error, `a_person: ${r.error}`); ids[n] = r.data; }
    n0 = (await db('journal', 'id')).length; stand0 = await stand();
    await page.reload(); await page.locator('#nav:not([hidden])').waitFor(); await tab('leute');
  });
  await S('Dialog „…“: Auswahl Schulden/Guthaben übertragen statt „korrigieren (+ / −)“, Hinweis zur Kasse', async () => {
    await prow(page, 'Wanda').locator('[data-a="a-more"]').click();
    const m = page.locator('#modal:not([hidden])');
    eq((await m.locator('#f_a option').evaluateAll(os => os.map(o => o.value).filter(Boolean))).join(','), 'schuld,guthaben,pin,del', 'Aktionen');
    eq((await m.locator('#f_a option').allInnerTexts()).filter(t => !t.startsWith('Bitte wählen')).slice(0, 2).join(' | '), 'Schulden übertragen (z. B. vom Papier-Schuldschein) | Guthaben übertragen (schon früher bezahlt)', 'Beschriftung');
    await see(page, 'Übertragen ändert nur den Schuldschein, nicht die Kasse. Gibt dir jemand jetzt Geld, nimm stattdessen „Einzahlung“.', '#modal');
    await see(page, 'Betrag in € (ohne Vorzeichen) bzw. neue PIN', '#modal');
    await m.locator('[data-a="m-x"]').click(); await idle(page);
  });
  await S('Schulden übertragen 7,50: positiver Betrag im Schuldschein, kein Kassenbuch-Eintrag', async () => {
    eq(await mehr('Wanda', 'schuld', '7,50'), '7,50 € Schulden für Wanda eingetragen.', 'Hinweis');
    eq(await ledger('Wanda'), 'korrektur:750', 'Schuldschein Wanda');
    eq(await anzeige('Wanda'), 750, 'Anzeige bei Wanda (Cent)');
    eq((await db('journal', 'id')).length, n0, 'Anzahl Kassenbuch-Zeilen'); eq(await stand(), stand0, 'Kassenstand');
  });
  await S('Guthaben übertragen 12,00: negativer Betrag im Schuldschein, Anzeige als Guthaben, kein Kassenbuch-Eintrag', async () => {
    eq(await mehr('Willi', 'guthaben', '12'), '12,00 € Guthaben für Willi eingetragen.', 'Hinweis');
    eq(await ledger('Willi'), 'korrektur:-1200', 'Schuldschein Willi');
    eq(await anzeige('Willi'), -1200, 'Anzeige bei Willi (Cent, negativ = Guthaben)');
    eq((await db('journal', 'id')).length, n0, 'Anzahl Kassenbuch-Zeilen'); eq(await stand(), stand0, 'Kassenstand');
  });
  await S('Ein eingetipptes Minus wird ignoriert (normales und typografisches)', async () => {
    eq(await mehr('Wanda', 'schuld', '-3,00'), '3,00 € Schulden für Wanda eingetragen.', 'Hinweis bei „-3,00“');
    eq(await mehr('Wanda', 'schuld', '−3,00'), '3,00 € Schulden für Wanda eingetragen.', 'Hinweis bei „−3,00“');
    eq(await mehr('Willi', 'guthaben', '-2'), '2,00 € Guthaben für Willi eingetragen.', 'Hinweis bei „-2“');
    eq(`${await saldo('Wanda')}/${await saldo('Willi')}`, '1350/-1400', 'Salden Wanda/Willi');
  });
  await S('0, leer und Text als Betrag werden abgelehnt', async () => {
    for (const v of ['0', '0,00', '', 'abc', '   ']) for (const a of ['schuld', 'guthaben'])
      eq(await mehr('Wanda', a, v), 'Bitte einen Betrag eintragen, z. B. 7,50.', `Hinweis bei „${v}“ (${a})`);
    eq(`${await saldo('Wanda')}/${await saldo('Willi')}`, '1350/-1400', 'Salden Wanda/Willi');
  });
  await S('Bon: offene Schuldscheine und Guthaben der Kollegen stimmen, Kassenstand unverändert', async () => {
    const saldi = {}; (await db('ledger', 'person_id,amount_cents')).forEach(l => { saldi[l.person_id] = (saldi[l.person_id] || 0) + l.amount_cents; });
    await tab('bon');
    await lnIs(page, 'Offene Schuldscheine', eur(Object.values(saldi).filter(v => v > 0).reduce((a, v) => a + v, 0)));
    await lnIs(page, 'Guthaben der Kollegen', eur(-Object.values(saldi).filter(v => v < 0).reduce((a, v) => a + v, 0)));
    await lnIs(page, 'KASSENSTAND', eur(stand0));
    eq((await db('journal', 'id')).length, n0, 'Anzahl Kassenbuch-Zeilen');
  });
  await S('Rangliste zählt Überträge nicht als Umsatz', async () => {
    await tab('leute');
    const rows = await page.locator('#app .paper').nth(1).locator('tr').evaluateAll(trs => trs.slice(1).map(tr => [...tr.children].map(td => td.textContent).join('|')));
    expect(rows.includes('Wanda|0,00|0,00') && rows.includes('Willi|0,00|0,00'), 'Rangliste: ' + rows.filter(r => /^W(anda|illi)/.test(r)).join(' ; '));
  });
  const kLogin = async (name, pin) => {
    await kp.goto(`${CFG.url}?k=${code}`);
    await kp.evaluate(() => { localStorage.removeItem('ktoken'); localStorage.removeItem('kfav'); });
    await kp.goto(`${CFG.url}?k=${code}`);
    const kq = kp.locator('#kq'); await kp.locator('#app h2').first().waitFor();
    if (await kq.count()) await kq.fill(name);
    await kp.locator('#app .namegrid button', { hasText: new RegExp('^' + name + '$') }).click();
    await kp.fill('#pin', pin); await kp.locator('#kpin button.pri').click();
    await kp.waitForFunction(() => /Kurz vorab|Schuldschein von/.test(document.querySelector('#app').textContent));
    if (await kp.locator('[data-a="k-consent"]').count()) await kp.locator('[data-a="k-consent"]').click();
    await see(kp, 'Schuldschein von ' + name);
  };
  const kLogin2 = name => kLogin(name, name === 'Willi' ? '4242' : '4141');
  await K('Kollegin mit übertragenen Schulden sieht „Übertrag Schulden“ und den offenen Betrag', async () => {
    await kLogin('Wanda', '4141');
    await lnIs(kp, 'OFFEN', '13,50 €');
    const rows = (await kp.locator('#app .it', { hasText: 'Übertrag' }).allInnerTexts()).map(t => t.replace(/\s+/g, ' ').replace(/^\d\d\.\d\d\. /, '').trim()).sort();
    eq(rows.join(' | '), 'Übertrag Schulden 3,00 | Übertrag Schulden 3,00 | Übertrag Schulden 7,50', 'Buchungen');
    eq(await kp.locator('#app [data-a="k-undo"]').count(), 0, 'Rückgängig-Knöpfe an Überträgen');
  });
  await K('Kollege mit übertragenem Guthaben sieht „DEIN GUTHABEN“ und „Übertrag Guthaben“', async () => {
    await kLogin('Willi', '4242');
    await lnIs(kp, 'DEIN GUTHABEN', '14,00 €');
    eq(await kp.locator('#app .it', { hasText: 'Übertrag Guthaben' }).count(), 2, 'Zeilen „Übertrag Guthaben“');
    expect(!(await kp.locator('#app').innerText()).includes('Korrektur'), 'alte Bezeichnung „Korrektur“ sichtbar');
  });
  await K('„Übertrag Guthaben“ steht wie die Einzahlung ohne Minuszeichen da', async () => {
    const rows = (await kp.locator('#app .it', { hasText: 'Übertrag Guthaben' }).allInnerTexts()).map(t => t.replace(/\s+/g, ' ').replace(/^\d\d\.\d\d\. /, '').trim()).sort();
    eq(rows.join(' | '), 'Übertrag Guthaben 12,00 | Übertrag Guthaben 2,00', 'Buchungen');
  });
  await S('Vier Ziffern bei unveränderter Voreinstellung im Dialog „…“ (gemeint: neue PIN) buchen keine Schulden', async () => {
    await page.reload(); await page.locator('#nav:not([hidden])').waitFor(); await tab('leute');
    const before = await saldo('Wanda');
    const hint = await mehr('Wanda', null, '4711');      // nur das Feld ausgefüllt, Auswahl nicht angefasst
    const after = await saldo('Wanda');
    if (after !== before) await rpc('a_fix', { p_person: ids.Wanda, p_cents: before - after });   // Testdaten wieder geradeziehen
    eq(after, before, `Saldo Wanda in Cent (Hinweis der App: „${hint}“)`);
  });
  await S('Dialog „…“ startet ohne Vorauswahl; ohne Auswahl wird nichts ausgeführt (ab v26)', async () => {
    await idle(page); await hideToast(page);
    await prow(page, 'Wanda').locator('[data-a="a-more"]').click();
    const m = page.locator('#modal:not([hidden])');
    eq(await m.locator('#f_a').inputValue(), '', 'vorausgewählte Aktion');
    eq((await m.locator('#f_a option').first().innerText()).trim(), 'Bitte wählen …', 'erster Eintrag der Auswahl');
    await m.locator('[data-a="m-x"]').click(); await idle(page);
    const before = await saldo('Wanda');
    for (const x of ['4711', '7,50', '']) eq(await mehr('Wanda', null, x), 'Bitte zuerst eine Aktion wählen.', `Hinweis bei „${x}“ ohne Auswahl`);
    eq(await saldo('Wanda'), before, 'Saldo Wanda');
  });
  await S('Übertrag ab 100,00 € fragt nach; Abbrechen bucht nichts, Bestätigen bucht (ab v26)', async () => {
    const before = await saldo('Wanda');
    const hoch = async (aktion, betrag, bestaetigen) => {
      await idle(page); await hideToast(page);
      await prow(page, 'Wanda').locator('[data-a="a-more"]').click();
      await fillModal(page, 'Wanda', { a: aktion, x: betrag });
      const m = page.locator('#modal:not([hidden])');
      await m.locator('h2', { hasText: 'für Wanda?' }).waitFor();
      const txt = (await m.innerText()).replace(/\s+/g, ' ');
      await m.locator(bestaetigen ? 'button.pri' : '[data-a="m-x"]').click();
      await idle(page);
      return txt;
    };
    const dlg = await hoch('schuld', '100', false);
    expect(/100,00 € Schulden für Wanda\?/i.test(dlg) && dlg.includes('ungewöhnlich hoher Betrag'), 'Rückfrage: ' + dlg);
    eq(await saldo('Wanda'), before, 'Saldo nach Abbrechen');
    await hoch('guthaben', '250,00', false);
    eq(await saldo('Wanda'), before, 'Saldo nach Abbrechen (Guthaben)');
    eq(await mehr('Wanda', 'schuld', '99,99'), '99,99 € Schulden für Wanda eingetragen.', 'Hinweis knapp unter der Grenze (ohne Rückfrage)');
    await hoch('guthaben', '100', true);
    eq(await saldo('Wanda'), before + 9999 - 10000, 'Saldo nach 99,99 Schulden und bestätigten 100,00 Guthaben');
    await rpc('a_fix', { p_person: ids.Wanda, p_cents: 1 });   // wieder auf den Stand davor
  });
  await K('Deine Buchungen: Beträge ohne Vorzeichen, Gutschriften grün, Schulden-Buchungen nicht (ab v26)', async () => {
    await kLogin2('Willi');
    const rows = await kp.locator('#app .paper', { hasText: 'Deine Buchungen' }).locator('.it').evaluateAll(rs => rs.map(r => {
      const el = r.children[3]; const [R, G, B] = getComputedStyle(el).color.match(/\d+/g).map(Number);
      return { art: r.children[1].textContent.replace(/^\d\d\.\d\d\. /, '').trim(), betrag: el.textContent.trim(), gruen: G > R + 25 && G > B + 15 };
    }));
    expect(rows.length >= 2, 'Buchungen: ' + JSON.stringify(rows));
    const bad = rows.filter(r => /[−+-]/.test(r.betrag) || r.gruen !== /Guthaben|Einzahlung/.test(r.art));
    expect(bad.length === 0, 'Unpassend: ' + JSON.stringify(bad));
  });
  await S('Keine Fehler in der Browser-Konsole (Übertrag)', async () => {
    const real = [...page.problems, ...kp.problems].filter(p => !/favicon/i.test(p));
    expect(real.length === 0, real.join(' · '));
  });
  await kp.context().close();
  await page.context().close();
};
