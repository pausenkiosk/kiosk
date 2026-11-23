'use strict';
/* Übergang: BISHERIGE App-Fassung gegen die NEUE Datenbank (schema.sql wird vor der neuen App eingespielt).
   Start: KIOSK_APP_REF=origin/main tests/run.sh uebergang
   Geprüft wird, was der Verwalter in der Zwischenzeit mit der alten App tut: Zahlung, Kassensturz, Buchung von Hand, Einkauf. */
const { CFG, step, setGroup, expect, eq, newPage, toast, hideToast, idle, fillModal, see, prow, lnIs, isoDay } = require('./lib');
const NIL = '00000000-0000-0000-0000-000000000000';

module.exports = async function uebergang(browser) {
  setGroup('Übergang alte App, neue Datenbank');
  const page = await newPage(browser);
  const S = (n, f) => step(n, f, page);
  const tab = async t => { await idle(page); await page.locator(`#nav [data-t="${t}"]`).click(); await page.locator(`#nav [data-t="${t}"].on`).waitFor(); };
  const db = (table, select, filterCol, filterVal) => page.evaluate(async ([t, s, c, v]) => {
    let q = SB.from(t).select(s); if (c) q = q.eq(c, v);
    const { data, error } = await q; if (error) throw new Error(error.message); return data;
  }, [table, select, filterCol, filterVal]);

  await S('Anmelden; es läuft die bisherige App-Fassung (alter Kassensturz-Dialog)', async () => {
    await page.goto(CFG.url + '#verwaltung');
    await page.locator('#alog').waitFor();
    await page.fill('#em', CFG.email); await page.fill('#pw', CFG.pw);
    await page.locator('#alog button.pri').click();
    await see(page, 'KASSENSTAND');
    await page.evaluate(async nil => {
      for (const q of [SB.from('cash_counts').delete().neq('id', nil), SB.from('journal').delete().in('kind', ['bar', 'zahlung'])]) { const { error } = await q; if (error) throw new Error(error.message); }
    }, NIL);
    await page.reload(); await see(page, 'KASSENSTAND');
    await tab('kasse');
    await page.locator('#app [data-a="a-cash"]').click();
    await see(page, 'Bargeld, das seit der letzten Zählung in die Kasse kam', '#modal');
    await page.locator('#modal [data-a="m-x"]').click();
  });
  await S('Buchung von Hand: wird gespeichert und angezeigt', async () => {
    await page.locator('#app [data-a="a-jour"]').click();
    await fillModal(page, 'Buchung von Hand', { t: 'Übergangstest', i: '2,00' });
    await page.locator('#app .it', { hasText: 'Übergangstest' }).waitFor();
    eq((await db('journal', 'in_cents,source', 'text', 'Übergangstest'))[0].in_cents, 200, 'Betrag');
  });
  await S('Einkauf: wird gespeichert, Bestand und Kassenbuch stimmen, Verweis für späteres Storno ist gesetzt', async () => {
    const cola = (await db('products', 'stock', 'name', 'Cola'))[0].stock;
    await tab('einkauf'); await hideToast(page);
    await page.fill('#estore', 'Übergangsmarkt');
    const r = page.locator('#cart .cart').nth(0);
    await r.locator('select').selectOption({ label: 'Cola' });
    await r.locator('input[type="number"]').fill('6'); await r.locator('input[inputmode="decimal"]').fill('4,20'); await r.locator('input[type="date"]').fill(isoDay(50));
    await page.locator('#app [data-a="a-buy"]').click();
    await toast(page, /Einkauf gespeichert\./);
    await idle(page);
    eq((await db('products', 'stock', 'name', 'Cola'))[0].stock, cola + 6, 'Bestand Cola');
    const j = (await db('journal', 'out_cents,kind,ref', 'text', 'Einkauf Übergangsmarkt'))[0];
    expect(j && j.out_cents === 420 && j.kind === 'einkauf' && j.ref, 'Kassenbuch-Zeile: ' + JSON.stringify(j));
  });
  await S('Zahlung: wird gebucht und gleicht den Schuldschein aus', async () => {
    await tab('leute'); await hideToast(page);
    await prow(page, 'Emil').locator('[data-a="a-pay"]').click();
    await fillModal(page, 'Zahlung von Emil', { c: '4,50' });
    await toast(page, /Zahlung gebucht\./);
    await idle(page);
    const j = await db('journal', 'in_cents,kind', 'text', 'Zahlung Schuldschein');
    eq(JSON.stringify(j), JSON.stringify([{ in_cents: 450, kind: 'zahlung' }]), 'Kassenbuch-Zeile zur Zahlung');
  });
  await S('Kassensturz in der alten App NACH einer Zahlung: eingegebenes Bargeld wird als Barverkauf gebucht', async () => {
    // Alte App fragt nach dem Bargeld aus Barverkäufen („seit der letzten Zählung in die Kasse kam“), nicht nach dem gesamten Kasseninhalt.
    await tab('kasse'); await hideToast(page);
    await page.locator('#app [data-a="a-cash"]').click();
    await fillModal(page, 'Kassensturz', { c: '3,00' });
    await toast(page, /Kassensturz gebucht\./);
    await idle(page);
    const j = await db('journal', 'in_cents', 'text', 'Barverkäufe');
    eq(JSON.stringify(j), JSON.stringify([{ in_cents: 300 }]), 'Kassenbuch „Barverkäufe“ nach Eingabe von 3,00 €');
  });
  await S('Kassensturz in der alten App OHNE vorherige Zahlung: Betrag wird unverändert gebucht', async () => {
    await page.locator('#app [data-a="a-cash"]').click();
    await fillModal(page, 'Kassensturz', { c: '2,50' });
    await toast(page, /Kassensturz gebucht\./);
    await idle(page);
    const j = (await db('journal', 'in_cents', 'text', 'Barverkäufe')).map(x => x.in_cents);
    expect(j.includes(250), 'Kassenbuch „Barverkäufe“: ' + JSON.stringify(j));
  });
  await S('Bon der alten App lädt weiter (Kassenstand, Fehlbetrag)', async () => {
    await tab('bon');
    await see(page, 'KASSENSTAND');
    await see(page, 'Fehlbetrag letzte Zählung');
    const real = page.problems.filter(p => !/favicon/.test(p));
    expect(real.length === 0, real.join(' · '));
  });
  await page.context().close();
};
