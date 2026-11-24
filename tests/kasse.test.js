'use strict';
/* Kassensturz nach Kasseninhalt und Storno (Ausbaustufe 3).
   Der Teil räumt zuerst Kassenstürze, Zahlungs- und Barverkaufs-Buchungen sowie Zähl-Abgänge ab und rechnet dann alles neu durch.
   Bedienung über die Oberfläche, Ergebnis jeweils in der Datenbank nachgelesen. */
const { CFG, step, setGroup, expect, eq, newPage, toast, hideToast, idle, fillModal, see, row, prow, lnIs, lnValue, sql, isoDay } = require('./lib');

const toCents = s => Math.round(Number(s.replace(/\./g, '').replace(',', '.').replace('−', '-')) * 100);
const eur = c => (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NIL = '00000000-0000-0000-0000-000000000000';

module.exports = async function kasse(browser) {
  setGroup('Kassensturz und Storno');
  const page = await newPage(browser);
  const S = (n, f) => step(n, f, page);
  const tab = async t => { await idle(page); await page.locator(`#nav [data-t="${t}"]`).click(); await page.locator(`#nav [data-t="${t}"].on`).waitFor(); };
  const db = (table, select, filterCol, filterVal) => page.evaluate(async ([t, s, c, v]) => {
    let q = SB.from(t).select(s); if (c) q = q.eq(c, v);
    const { data, error } = await q; if (error) throw new Error(error.message); return data;
  }, [table, select, filterCol, filterVal]);
  const rpc = (fn, args) => page.evaluate(async ([f, a]) => { const { data, error } = await SB.rpc(f, a); return error ? { error: error.message } : { data }; }, [fn, args]);
  const product = async name => (await db('products', '*', 'name', name))[0];
  const counts = async () => (await db('cash_counts', 'id,day,cents,bar_cents,at')).sort((a, b) => a.at < b.at ? -1 : 1);
  const last = async () => { const c = await counts(); return c[c.length - 1]; };
  const barRow = async cid => (await db('journal', 'id,day,text,in_cents,out_cents,kind,ref', 'ref', cid))[0];
  /* Zahlung über die Oberfläche */
  const pay = async (name, amount) => {
    await tab('leute'); await hideToast(page);
    await prow(page, name).locator('[data-a="a-pay"]').click();
    await fillModal(page, 'Einzahlung von ' + name, { c: amount });
    await toast(page, /^Gebucht\. /);
    await idle(page);
  };
  /* Kassensturz über die Oberfläche; liefert den angezeigten Hinweis */
  const sturz = async amount => {
    await tab('kasse'); await hideToast(page);
    await page.locator('#app [data-a="a-cash"]').click();
    await fillModal(page, 'Kassensturz', { c: amount });
    // Normalfall: kurzer Hinweis. Fehlt Geld: Dialog „Achtung: Es fehlt Geld“, der mit „Verstanden“ bestätigt wird.
    await page.waitForFunction(() => { const t = document.querySelector('#toast'), m = document.querySelector('#modal h2');
      return (!t.hidden && /Gebucht/.test(t.textContent)) || (m && /Achtung/.test(m.textContent)); });
    let txt;
    if (await page.locator('#modal h2', { hasText: 'Achtung' }).count()) {
      txt = (await page.locator('#modal').innerText()).replace(/\s+/g, ' ').trim();
      await page.locator('#modal button.pri', { hasText: 'Verstanden' }).click();
    } else txt = await page.locator('#toast').innerText();
    await idle(page);
    return txt;
  };
  const storno = async (journalId, confirm = true) => {
    await tab('kasse'); await hideToast(page);
    await page.locator(`#app [data-a="a-storno"][data-id="${journalId}"]`).click();
    await page.locator('#modal h2', { hasText: 'Buchung stornieren?' }).waitFor();
    const text = (await page.locator('#modal').innerText()).replace(/\s+/g, ' ');
    if (!confirm) { await page.locator('#modal [data-a="m-x"]').click(); await idle(page); return text; }
    await page.locator('#modal button.pri').click();
    await page.waitForFunction(() => { const t = document.querySelector('#toast'); return !t.hidden && /storn/i.test(t.textContent); });
    const t = await page.locator('#toast').innerText();
    await idle(page);
    return t;
  };
  /* Im Hintergrund (hinter dem Warndialog) steht die neueste Barverkaufs-Zeile schon im Kassenbuch. */
  const rowHasBar = async cents => { const c = await last(); eq((await barRow(c.id)).in_cents, cents, 'Kassenbuch Barverkäufe zum letzten Kassensturz'); };
  let stand0 = 0, plus = 0, ware = 0;
  const standIs = async () => { await tab('bon'); await lnIs(page, 'KASSENSTAND', eur(stand0 + plus)); };

  await S('Vorbereitung: anmelden, Kassenstürze/Zahlungen/Zähl-Abgänge abräumen, Regal zählen (2 Cola fehlen)', async () => {
    await page.goto(CFG.url + '#verwaltung');
    await page.locator('#alog').waitFor();
    await page.fill('#em', CFG.email); await page.fill('#pw', CFG.pw);
    await page.locator('#alog button.pri').click();
    await see(page, 'KASSENSTAND');
    await page.evaluate(async nil => {
      for (const q of [SB.from('cash_counts').delete().neq('id', nil), SB.from('journal').delete().in('kind', ['bar', 'zahlung']), SB.from('sales').delete().eq('kind', 'zaehlung')]) {
        const { error } = await q; if (error) throw new Error(error.message);
      }
    }, NIL);
    const cola = await product('Cola');
    const r = await rpc('a_count', { p_items: [{ id: cola.id, qty: cola.stock - 2 }] });
    expect(!r.error, 'Zählung: ' + r.error);
    ware = 2 * cola.price_cents;
    await page.reload();
    await see(page, 'KASSENSTAND');
    stand0 = toCents(await lnValue(page, 'KASSENSTAND'));
    await lnIs(page, 'Fehlbetrag letzte Zählung', '–');
  });

  /* ---------- Kassensturz ---------- */
  await S('Kassensturz ohne Zahlungen: gesamter Inhalt zählt als Barverkauf', async () => {
    eq(await sturz('5,00'), 'Gebucht: 5,00 € Barverkäufe.', 'Hinweis');
    const c = await last();
    eq(`${c.day}/${c.cents}/${c.bar_cents}`, `${isoDay()}/500/500`, 'Kassensturz (Tag/Inhalt/bar)');
    const j = await barRow(c.id);
    eq(`${j.text}/${j.in_cents}/${j.kind}`, 'Barverkäufe/500/bar', 'Kassenbuch-Zeile');
    plus += 500; await standIs();
    await lnIs(page, 'Fehlbetrag letzte Zählung', eur(ware - 500));
  });
  await S('Zahlung, dann Kassensturz am selben Tag: Zahlung wird abgezogen', async () => {
    await pay('Gerd', '1,00'); plus += 100;
    eq(await sturz('4,00'), 'Gebucht: 3,00 € Barverkäufe, 1,00 € stammen aus Einzahlungen.', 'Hinweis');
    const c = await last();
    eq(`${c.cents}/${c.bar_cents}`, '400/300', 'Kassensturz (Inhalt/bar)');
    eq((await barRow(c.id)).in_cents, 300, 'Kassenbuch Barverkäufe');
    plus += 300; await standIs();
  });
  await S('Zahlung vor dem früheren Kassensturz zählt nicht noch einmal, Zahlung danach schon', async () => {
    await pay('Gerd', '2,00'); plus += 200;
    eq(await sturz('10,00'), 'Gebucht: 8,00 € Barverkäufe, 2,00 € stammen aus Einzahlungen.', 'Hinweis');
    const c = await last();
    eq(`${c.cents}/${c.bar_cents}`, '1000/800', 'Kassensturz (Inhalt/bar)');
    plus += 800; await standIs();
  });
  await S('Zwei Kassenstürze direkt nacheinander: beim zweiten wird nichts abgezogen', async () => {
    eq(await sturz('0,50'), 'Gebucht: 0,50 € Barverkäufe.', 'Hinweis');
    const c = await last();
    eq(`${c.cents}/${c.bar_cents}`, '50/50', 'Kassensturz (Inhalt/bar)');
    eq((await counts()).length, 4, 'Anzahl Kassenstürze');
    plus += 50; await standIs();
  });
  await S('Kasse kleiner als gebuchte Zahlungen: Warnhinweis, bar negativ, Kassenbuch-Zeile mit 0', async () => {
    await pay('Gerd', '5,00'); plus += 500;
    const dlg = await sturz('3,00');
    expect(/^ACHTUNG: ES FEHLT GELD |^Achtung: Es fehlt Geld /.test(dlg), 'Kein Warndialog, sondern: ' + dlg);
    for (const t of ['In der Kasse waren 3,00 €.', 'sind aber 5,00 € aus Einzahlungen (abzüglich Auszahlungen) in die Kasse gekommen', 'Es fehlen 2,00 €.', 'Als Barverkauf wurden 0,00 € gebucht.']) expect(dlg.includes(t), `Im Warndialog fehlt „${t}“: ${dlg}`);
    const c = await last();
    eq(`${c.cents}/${c.bar_cents}`, '300/-200', 'Kassensturz (Inhalt/bar)');
    const j = await barRow(c.id);
    eq(`${j.text}/${j.in_cents}/${j.out_cents}`, 'Barverkäufe/0/0', 'Kassenbuch-Zeile');
    await standIs();
  });
  await S('Bon: Fehlbetrag rechnet mit dem Barverkauf (hier: 2,00 € fehlen in der Kasse)', async () => {
    await tab('bon');
    await lnIs(page, 'Fehlbetrag letzte Zählung', '2,00');
  });
  await S('Kasse: Storno-Knopf nur bei Handbuchung, Kassensturz und Einkauf mit Verweis', async () => {
    await tab('kasse');
    const rows = await page.locator('#app .paper').last().locator('.it').evaluateAll(rs => rs.map(r => [r.children[1].textContent.replace(/^\d\d\.\d\d\. /, ''), !!r.querySelector('[data-a="a-storno"]')]));
    const has = t => rows.filter(r => r[0] === t).map(r => r[1]);
    expect(has('Barverkäufe').length === 5 && has('Barverkäufe').every(Boolean), 'Barverkäufe ohne Storno-Knopf: ' + JSON.stringify(has('Barverkäufe')));
    expect(has('Zahlung Schuldschein').length === 3 && !has('Zahlung Schuldschein').some(Boolean), 'Zahlung mit Storno-Knopf: ' + JSON.stringify(has('Zahlung Schuldschein')));
    eq(JSON.stringify(has('Startgeld')), '[true]', 'Handbuchung „Startgeld“');
    eq(JSON.stringify(has('Einkauf Rewe')), '[false]', 'alter Einkauf ohne Verweis');
    eq(JSON.stringify(has('Altbestand')), '[false]', 'Excel-Zeile');
  });
  await S('Über mehrere Tage: Zahlungen von gestern (nach dem letzten Kassensturz) und von heute werden abgezogen', async () => {
    await pay('Gerd', '0,70'); plus += 70;
    // Alles Bisherige um einen Tag zurückdatieren (geht nur direkt in der Datenbank).
    await sql(`update cash_counts set at = at - interval '1 day', day = day - 1;
               update journal set at = at - interval '1 day', day = day - 1 where kind in ('bar', 'zahlung');
               update sales set at = at - interval '1 day' where kind = 'zaehlung';`);
    await page.reload(); await see(page, 'KASSENSTAND');
    const wasser = await product('Wasser');
    const r = await rpc('a_count', { p_items: [{ id: wasser.id, qty: wasser.stock - 1 }] });
    expect(!r.error, 'Zählung: ' + r.error);
    await pay('Gerd', '1,50'); plus += 150;
    eq(await sturz('6,00'), 'Gebucht: 3,80 € Barverkäufe, 2,20 € stammen aus Einzahlungen.', 'Hinweis');
    const c = await last();
    eq(`${c.day}/${c.cents}/${c.bar_cents}`, `${isoDay()}/600/380`, 'Kassensturz (Tag/Inhalt/bar)');
    plus += 380; await standIs();
    await lnIs(page, 'Fehlbetrag letzte Zählung', eur(wasser.price_cents - 380));
  });
  await S('Kassensturz: negativer Betrag wird abgelehnt (direkter Aufruf)', async () => {
    const r = await rpc('a_cash_box', { p_cents: -1 });
    expect(r.error && /nicht erlaubt/.test(r.error), 'a_cash_box(-1): ' + JSON.stringify(r));
    eq((await counts()).length, 6, 'Anzahl Kassenstürze');
  });

  /* ---------- Storno ---------- */
  await S('Storno Handbuchung: Abbrechen behält sie, Bestätigen entfernt sie', async () => {
    await tab('kasse');
    await page.locator('#app [data-a="a-jour"]').click();
    await fillModal(page, 'Buchung von Hand', { t: 'Stornotest', i: '1,00' });
    await page.locator('#app .it', { hasText: 'Stornotest' }).waitFor();
    await idle(page);
    const id = (await db('journal', 'id', 'text', 'Stornotest'))[0].id;
    const dlg = await storno(id, false);
    expect(dlg.includes('Stornotest: 1,00 €') && dlg.includes('Die Buchung wird entfernt.'), 'Dialogtext: ' + dlg);
    eq((await db('journal', 'id', 'text', 'Stornotest')).length, 1, 'Buchung nach Abbrechen');
    eq(await storno(id), 'Storniert.', 'Hinweis');
    eq((await db('journal', 'id', 'text', 'Stornotest')).length, 0, 'Buchung nach Storno');
    expect(await page.locator('#app .it', { hasText: 'Stornotest' }).count() === 0, 'Stornierte Buchung steht noch in der Liste');
    await standIs();
  });
  await S('Storno Kassensturz: ein älterer lässt sich nicht stornieren', async () => {
    const c = await counts();
    const old = await barRow(c[0].id);
    eq(await storno(old.id), 'Nur der letzte Kassensturz lässt sich stornieren.', 'Hinweis');
    eq((await counts()).length, 6, 'Anzahl Kassenstürze');
    expect(await barRow(c[0].id), 'Kassenbuch-Zeile des älteren Kassensturzes ist weg');
    await standIs();
  });
  await S('Storno letzter Kassensturz: Kassensturz und Barverkauf verschwinden', async () => {
    const c = await last();
    const j = await barRow(c.id);
    const dlg = await storno(j.id, false);
    expect(dlg.includes('Der Kassensturz wird entfernt. Danach kannst du ihn neu buchen.'), 'Dialogtext: ' + dlg);
    eq(await storno(j.id), 'Storniert.', 'Hinweis');
    eq((await counts()).length, 5, 'Anzahl Kassenstürze');
    expect(!(await barRow(c.id)), 'Kassenbuch-Zeile steht noch da');
    plus -= 380; await standIs();
    eq((await db('journal', 'id', 'kind', 'zahlung')).length, 5, 'Zahlungen bleiben erhalten');
  });
  await S('Nach dem Storno zählen die Zahlungen wieder für den nächsten Kassensturz', async () => {
    eq(await sturz('6,00'), 'Gebucht: 3,80 € Barverkäufe, 2,20 € stammen aus Einzahlungen.', 'Hinweis');
    plus += 380; await standIs();
  });
  await S('Storno Kassensturz mit negativem Barverkauf (Zeile mit 0,00) geht ebenfalls', async () => {
    await pay('Gerd', '1,00'); plus += 100;
    await sturz('0,40');
    const c = await last();
    eq(c.bar_cents, -60, 'bar');
    eq(await storno((await barRow(c.id)).id), 'Storniert.', 'Hinweis');
    eq((await counts()).length, 6, 'Anzahl Kassenstürze');
    await standIs();
  });
  let before = null;
  await S('Storno Einkauf – Vorbereitung: Einkauf mit Haltbarkeitsdatum buchen, danach wird ein Teil verkauft', async () => {
    before = { cola: (await product('Cola')).stock, gummi: (await product('Gummibärchen')).stock };
    await tab('einkauf'); await hideToast(page);
    await page.fill('#estore', 'Stornomarkt');
    const fill = async (n, name, qty, price, mhd) => {
      const r = page.locator('#cart .cart').nth(n);
      await r.locator('select').selectOption({ label: name });
      await r.locator('input[type="number"]').fill(qty); await r.locator('input[inputmode="decimal"]').fill(price); await r.locator('input[type="date"]').fill(mhd);
    };
    await fill(0, 'Cola', '5', '4,00', isoDay(10));
    await fill(1, 'Gummibärchen', '3', '3,00', '');
    await page.locator('#app [data-a="a-buy"]').click();
    await toast(page, /Einkauf gespeichert\./);
    await idle(page);
    eq((await product('Cola')).stock, before.cola + 5, 'Bestand Cola nach Einkauf');
    await page.locator('#app .it', { hasText: 'Cola · 5 St' }).waitFor();
    // 2 der 3 Gummibärchen sind inzwischen weg: Bestand von Hand auf 1 (unter der Einkaufsmenge).
    await page.evaluate(async n => { const { error } = await SB.from('products').update({ stock: n }).eq('name', 'Gummibärchen'); if (error) throw new Error(error.message); }, before.gummi + 1);
    plus -= 700; await standIs();
  });
  await S('Storno Einkauf: Einkauf weg, Bestand zurück (nicht unter 0), Haltbarkeitsdaten weg', async () => {
    expect(before, 'Vorbereitung fehlgeschlagen');
    const j = (await db('journal', 'id,kind,ref', 'text', 'Einkauf Stornomarkt'))[0];
    expect(j && j.kind === 'einkauf' && j.ref, 'Kassenbuch-Zeile zum Einkauf ohne Verweis: ' + JSON.stringify(j));
    const dlg = await storno(j.id, false);
    expect(dlg.includes('Einkauf Stornomarkt: −7,00 €') && dlg.includes('Der Einkauf wird entfernt und der Bestand um die gekauften Stücke verringert.'), 'Dialogtext: ' + dlg);
    eq(await storno(j.id), 'Storniert.', 'Hinweis');
    eq((await product('Cola')).stock, before.cola, 'Bestand Cola nach Storno');
    eq((await product('Gummibärchen')).stock, Math.max(before.gummi + 1 - 3, 0), 'Bestand Gummibärchen nach Storno (nicht unter 0)');
    eq((await db('purchases', 'id', 'store', 'Stornomarkt')).length, 0, 'Einkauf in der Datenbank');
    eq((await db('purchase_items', 'id', 'purchase_id', j.ref)).length, 0, 'Positionen des Einkaufs');
    eq((await db('journal', 'id', 'text', 'Einkauf Stornomarkt')).length, 0, 'Kassenbuch-Zeile');
    plus += 700; await standIs();
    await tab('einkauf');
    expect(await page.locator('#app .it', { hasText: 'Cola · 5 St' }).count() === 0, 'Haltbarkeitsdatum des stornierten Einkaufs steht noch da');
  });
  await S('Storno direkt aufgerufen: Zahlung, Excel-Zeile und unbekannte Buchung werden abgelehnt', async () => {
    const z = (await db('journal', 'id', 'kind', 'zahlung'))[0], x = (await db('journal', 'id', 'kind', 'excel'))[0];
    const n = (await db('journal', 'id')).length;
    eq(JSON.stringify(await rpc('a_storno', { p_journal: z.id })), '{"data":"nicht_moeglich"}', 'Storno einer Zahlung');
    eq(JSON.stringify(await rpc('a_storno', { p_journal: x.id })), '{"data":"nicht_moeglich"}', 'Storno einer Excel-Zeile');
    eq(JSON.stringify(await rpc('a_storno', { p_journal: NIL })), '{"data":"fehlt"}', 'Storno einer unbekannten Buchung');
    eq((await db('journal', 'id')).length, n, 'Anzahl Kassenbuch-Zeilen');
  });
  await S('Warnung bei zu wenig Geld bleibt stehen, bis „Verstanden“ getippt wird', async () => {
    await pay('Gerd', '9,00'); plus += 900;
    await tab('kasse'); await hideToast(page);
    await page.locator('#app [data-a="a-cash"]').click();
    await fillModal(page, 'Kassensturz', { c: '1,00' });
    await page.locator('#modal h2', { hasText: 'Achtung: Es fehlt Geld' }).waitFor();
    await page.waitForTimeout(5000);
    expect(await page.locator('#modal h2', { hasText: 'Achtung: Es fehlt Geld' }).isVisible(), 'Warnung ist nach 5 Sekunden von selbst verschwunden');
    await see(page, 'Es fehlen 9,00 €.', '#modal');   // 9,00 + 1,00 (Zahlung vor dem stornierten Kassensturz) gegen 1,00 in der Kasse
    await rowHasBar(0);
    await page.locator('#modal button.pri', { hasText: 'Verstanden' }).click();
    await page.waitForFunction(() => document.querySelector('#modal').hidden);
    await standIs();
  });
  await S('Mischfall: Kassensturz mit der alten Funktion, danach Zahlung, danach Kassensturz nach Kasseninhalt', async () => {
    const n = (await counts()).length;
    const r = await rpc('a_cash', { p_cents: 300 });
    expect(!r.error, 'a_cash(300): ' + r.error);
    const c = await last();
    eq(`${c.cents}/${c.bar_cents}`, '300/300', 'alter Kassensturz (Inhalt/bar)');
    const j = await barRow(c.id);
    eq(`${j.text}/${j.in_cents}/${j.kind}`, 'Barverkäufe/300/bar', 'Kassenbuch-Zeile des alten Kassensturzes');
    plus += 300;
    await page.reload(); await see(page, 'KASSENSTAND');
    await pay('Gerd', '2,00'); plus += 200;
    eq(await sturz('10,00'), 'Gebucht: 8,00 € Barverkäufe, 2,00 € stammen aus Einzahlungen.', 'Hinweis');
    eq((await counts()).length, n + 2, 'Anzahl Kassenstürze');
    plus += 800; await standIs();
  });
  await S('Zählung zwischen zwei Kassenstürzen am selben Tag zählt für den zweiten (Fehlbetrag 0,00)', async () => {
    const cola = await product('Cola');
    const r = await rpc('a_count', { p_items: [{ id: cola.id, qty: cola.stock - 1 }] });
    expect(!r.error, 'Zählung: ' + r.error);
    await page.reload(); await see(page, 'KASSENSTAND');
    eq(await sturz(eur(cola.price_cents)), `Gebucht: ${eur(cola.price_cents)} € Barverkäufe.`, 'Hinweis');
    plus += cola.price_cents;
    await tab('bon');
    await lnIs(page, 'Fehlbetrag letzte Zählung', '0,00');   // 1 Cola fehlt laut Zählung, genau ihr Preis lag in der Kasse
  });
  await S('Keine Fehler in der Browser-Konsole (Kassensturz und Storno)', async () => {
    const real = page.problems.filter(p => !/favicon|nicht erlaubt|status of 400/i.test(p));
    expect(real.length === 0, real.join(' · '));
  });
  await page.context().close();
};
