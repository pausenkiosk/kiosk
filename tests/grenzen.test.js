'use strict';
/* Viele Buchungen: Stimmen Kassenstand und Schuldscheine auch noch bei mehr als 1000 Einträgen?
   (Die Datenbank-Schnittstelle liefert pro Abfrage standardmäßig höchstens 1000 Zeilen.)
   Läuft als letzter Teil, weil er viele Testbuchungen anlegt. */
const { CFG, step, setGroup, expect, eq, newPage, lnValue, see, listSaldo, prow } = require('./lib');

const toCents = s => (/Guthaben/.test(s) ? -1 : 1) * Math.round(Number(s.replace('Guthaben', '').trim().replace(/\./g, '').replace(',', '.').replace('−', '-')) * 100);
/* Offene Schuldscheine minus Guthaben der Kollegen (die Guthaben-Zeile fehlt, wenn niemand Guthaben hat). */
const netto = async page => {
  const offen = toCents(await lnValue(page, 'Offene Schuldscheine'));
  const g = page.locator('#app .ln', { hasText: 'Guthaben der Kollegen' });
  return offen - (await g.count() ? toCents((await g.first().locator('span').nth(1).innerText()).trim()) : 0);
};

module.exports = async function grenzen(browser) {
  setGroup('Viele Buchungen');
  const page = await newPage(browser, { acceptDownloads: true });
  const S = (n, f) => step(n, f, page);
  const N = 1200;
  let before = null;

  await S('Vorbereitung: anmelden und 1200 kleine Buchungen je Kassenbuch und Schuldschein anlegen', async () => {
    await page.goto(CFG.url + '#verwaltung');
    await page.locator('#alog').waitFor();
    await page.fill('#em', CFG.email); await page.fill('#pw', CFG.pw);
    await page.locator('#alog button.pri').click();
    await see(page, 'KASSENSTAND');
    before = { stand: toCents(await lnValue(page, 'KASSENSTAND')), offen: await netto(page) };
    const r = await page.evaluate(async n => {
      const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
      const gerd = (await SB.from('persons').select('id').eq('vorname', 'Gerd')).data[0].id;
      const before = (await SB.from('ledger').select('amount_cents').eq('person_id', gerd)).data.reduce((a, l) => a + l.amount_cents, 0);
      for (let i = 0; i < n; i += 400) {
        const k = Math.min(400, n - i);
        let e = (await SB.from('journal').insert(Array.from({ length: k }, () => ({ day, text: 'Massentest', in_cents: 1, source: 'hand' })))).error;
        if (e) throw new Error(e.message);
        e = (await SB.from('ledger').insert(Array.from({ length: k }, () => ({ person_id: gerd, day, amount_cents: 1, kind: 'kauf' })))).error;
        if (e) throw new Error(e.message);
      }
      return before;
    }, N);
    before.gerd = r;
    await page.reload();
    await see(page, 'KASSENSTAND');
  });
  await S('Kassenstand zählt alle Buchungen mit (auch über 1000)', async () => {
    expect(before, 'Vorbereitung fehlgeschlagen');
    eq(toCents(await lnValue(page, 'KASSENSTAND')), before.stand + N, 'Kassenstand in Cent nach 1200 Buchungen zu je 0,01 €');
  });
  await S('Offene Schuldscheine und Guthaben zählen alle Buchungen mit (auch über 1000)', async () => {
    expect(before, 'Vorbereitung fehlgeschlagen');
    eq(await netto(page), before.offen + N, 'Offene Schuldscheine minus Guthaben in Cent nach 1200 Buchungen zu je 0,01 €');
  });
  await S('Schuldschein einer Person stimmt bei über 1000 Buchungen', async () => {
    expect(before, 'Vorbereitung fehlgeschlagen');
    await page.locator('#nav [data-t="leute"]').click();
    eq(await listSaldo(page, 'Gerd'), before.gerd + N, 'Schuldschein Gerd in Cent');
  });
  await S('Sicherung enthält alle Buchungen (auch über 1000), keine doppelt', async () => {
    await page.locator('#nav [data-t="bon"]').click();
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.locator('#app [data-a="a-backup"]').click()]);
    const data = JSON.parse(require('fs').readFileSync(await dl.path(), 'utf8'));
    for (const t of ['journal', 'ledger']) {
      const n = await page.evaluate(async t => (await SB.from(t).select('id', { count: 'exact', head: true })).count, t);
      eq(data[t].length, n, 'Zeilen in der Sicherung: ' + t);
      eq(new Set(data[t].map(r => r.id)).size, n, 'verschiedene Zeilen in der Sicherung: ' + t);
    }
  });
  await page.context().close();
};
