'use strict';
/* Info-Knöpfe („i“) an den Überschriften: vorhanden, antippbar, Text passt zum Verhalten der App, nicht im Druck. */
const { CFG, step, setGroup, expect, eq, newPage, toast, hideToast, idle, fillModal, see, row, sql, isoDay } = require('./lib');

module.exports = async function info(browser) {
  setGroup('Info-Knöpfe');
  const page = await newPage(browser, { acceptDownloads: true });   // Verwalter
  const kp = await newPage(browser, { hasTouch: true });            // Kollegin Vera
  const S = (n, f) => step(n, f, page), K = (n, f) => step(n, f, kp);
  const tab = async t => { await idle(page); await page.locator(`#nav [data-t="${t}"]`).click(); await page.locator(`#nav [data-t="${t}"].on`).waitFor(); };
  const db = (table, select, filterCol, filterVal) => page.evaluate(async ([t, s, c, v]) => {
    let q = SB.from(t).select(s); if (c) q = q.eq(c, v);
    const { data, error } = await q; if (error) throw new Error(error.message); return data;
  }, [table, select, filterCol, filterVal]);
  const rpc = (fn, args) => page.evaluate(async ([f, a]) => { const { data, error } = await SB.rpc(f, a); return error ? { error: error.message } : { data }; }, [fn, args]);
  const seen = new Set();
  let vera = null, code = null;

  /* Prüft alle Info-Knöpfe der gerade sichtbaren Ansicht. Liefert die Schlüssel in Reihenfolge. */
  async function check(p, expected) {
    await idle(p);
    const keys = await p.locator('#app .ii').evaluateAll(bs => bs.filter(b => b.offsetParent !== null).map(b => b.dataset.k));
    eq(keys.join(','), expected.join(','), 'Info-Knöpfe dieser Ansicht');
    const n = keys.length, bad = [];
    const expect = (c, m) => { if (!c) bad.push(m); };   // erst alle Knöpfe prüfen, dann gesammelt melden
    for (let i = 0; i < n; i++) {
      const b = p.locator('#app .ii').nth(i);
      await b.scrollIntoViewIfNeeded();
      const m = await b.evaluate(el => {
        const r = el.getBoundingClientRect(), a = getComputedStyle(el, '::after');
        const pad = k => Math.max(0, -parseFloat(a[k]) || 0);
        const hit = { l: r.left - pad('left'), r: r.right + pad('right'), t: r.top - pad('top'), b: r.bottom + pad('bottom') };
        const others = [...document.querySelectorAll('#app button, #app input, #app select, #app a, #nav button')].filter(o => o !== el && o.offsetParent !== null && !o.contains(el))
          .filter(o => { const q = o.getBoundingClientRect(); return q.left < hit.r && q.right > hit.l && q.top < hit.b && q.bottom > hit.t; })
          .map(o => (o.textContent || o.getAttribute('aria-label') || o.tagName).trim().slice(0, 25));
        const top = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
        return { k: el.dataset.k, w: hit.r - hit.l, h: hit.b - hit.t, others, onTop: top === el, label: el.getAttribute('aria-label'), text: el.textContent, type: el.type, want: INFO[el.dataset.k] || '' };
      });
      expect(m.want.length > 20, `Info „${m.k}“: kein Text hinterlegt`);
      expect(m.w >= 44 && m.h >= 44, `Info „${m.k}“: Tippfläche nur ${Math.round(m.w)} × ${Math.round(m.h)} px`);
      expect(m.onTop, `Info „${m.k}“ ist verdeckt`);
      expect(m.others.length === 0, `Info „${m.k}“: Tippfläche überlappt mit ${m.others.join(', ')}`);
      eq(`${m.text}/${m.label}/${m.type}`, 'i/Erklärung/button', `Info „${m.k}“ Beschriftung`);
      if (p === kp) await b.tap(); else await b.click();
      const modal = p.locator('#modal:not([hidden])');
      await modal.waitFor();
      eq((await modal.locator('p').innerText()).trim(), m.want, `Info „${m.k}“ angezeigter Text`);
      await modal.locator('button', { hasText: 'OK' }).click();
      await p.waitForFunction(() => document.querySelector('#modal').hidden);
      seen.add(m.k);
    }
    if (bad.length) throw new Error(bad.join(' · '));
    return keys;
  }

  await S('Vorbereitung: Verwalter anmelden, Kollegin Vera anlegen, je ein Haltbarkeitsdatum in 5 und in 20 Tagen', async () => {
    await page.goto(CFG.url + '#verwaltung');
    await page.locator('#alog').waitFor();
    await page.fill('#em', CFG.email); await page.fill('#pw', CFG.pw);
    await page.locator('#alog button.pri').click();
    await see(page, 'KASSENSTAND');
    code = (await db('settings', 'value', 'key', 'kiosk_code'))[0].value;
    const r = await rpc('a_person', { p_vorname: 'Vera', p_pin: '9191' }); expect(!r.error, 'a_person: ' + r.error); vera = r.data;
    await page.evaluate(async days => {
      const p = (await SB.from('products').select('id').eq('active', true).order('name').limit(1)).data[0];
      const { error } = await SB.from('purchase_items').insert(days.map(d => ({ purchase_id: null, product_id: p.id, qty: 0, cents: 0, mhd: d })));
      if (error) throw new Error(error.message);
    }, [isoDay(5), isoDay(20)]);
    await page.reload(); await page.locator('#nav:not([hidden])').waitFor();
  });
  await K('Kollegen-Ansicht: vier Info-Knöpfe, per Fingertipp bedienbar, Fenster mit Text und OK', async () => {
    await kp.goto(`${CFG.url}?k=${code}`);
    await kp.locator('.namegrid button', { hasText: /^Vera$/ }).click();
    await kp.fill('#pin', '9191');
    await kp.locator('#kpin button.pri').click();
    await kp.locator('[data-a="k-consent"]').click();
    await see(kp, 'Schuldschein von Vera');
    await check(kp, ['k_saldo', 'k_buy', 'k_entries', 'k_wish']);
  });
  await K('Kollegen-Ansicht: vor der Anmeldung und in der Einwilligung gibt es keine Info-Knöpfe, die Beträge bleiben lesbar', async () => {
    eq((await kp.locator('#app .ln.big span').nth(1).innerText()).trim(), '0,00 €', 'Betrag neben dem Info-Knopf');
    eq((await kp.locator('#app .ln.big span').first().innerText()).replace(/\s+/g, ' ').trim(), 'OFFEN i', 'Beschriftung');
  });
  await S('Bon: Info-Knöpfe an Kassenstand, Fehlbetrag, Nachbestellen, Haltbarkeit (2×), An Claude, Sicherung', async () => {
    await check(page, ['kasse', 'fehl', 'ampel', 'mhd', 'mhd', 'claude', 'backup']);
  });
  await S('Regal: Info-Knöpfe an Regal, Wünsche, Ampel; beim Zählen ein eigener', async () => {
    await tab('regal');
    await check(page, ['fotos', 'wuensche', 'ampel']);
    await page.locator('#app [data-a="a-cnt"]').click();
    await see(page, 'Bestand zählen');
    await check(page, ['zaehlen']);
    await page.locator('#app [data-a="a-cnt-x"]').click();
  });
  await S('Einkauf: Info-Knöpfe an Einkauf und Haltbarkeit', async () => { await tab('einkauf'); await check(page, ['einkauf', 'mhd']); });
  await S('Kasse: Info-Knöpfe an Einnahmen/Ausgaben (Kassensturz) und Letzte Buchungen (Storno)', async () => { await tab('kasse'); await check(page, ['kassensturz', 'storno']); });
  await S('Leute: Info-Knöpfe an Schuldscheine, Rangliste, QR-Code', async () => { await tab('leute'); await check(page, ['schuldscheine', 'rangliste', 'qr']); });
  await S('Jeder hinterlegte Info-Text wird irgendwo angeboten', async () => {
    const all = await page.evaluate(() => Object.keys(INFO));
    const missing = all.filter(k => !seen.has(k));
    expect(missing.length === 0, 'Ohne Knopf: ' + missing.join(', '));
    eq(all.length, 19, 'Anzahl Info-Texte');
  });
  await S('Info-Knöpfe erscheinen nicht im Druck (Aushang und Preisliste)', async () => {
    await tab('leute');
    await page.emulateMedia({ media: 'print' });
    try {
      let vis = await page.locator('.ii').evaluateAll(bs => bs.filter(b => getComputedStyle(b).display !== 'none' && b.offsetParent !== null).length);
      eq(vis, 0, 'sichtbare Info-Knöpfe im Aushang');
      expect(!/(^|\n)\s*i\s*(\n|$)/.test(await page.locator('#app .poster').innerText()), 'einzelnes „i“ im Aushang');
      await page.emulateMedia({ media: 'screen' }); await tab('regal'); await page.emulateMedia({ media: 'print' });
      vis = await page.locator('.ii').evaluateAll(bs => bs.filter(b => getComputedStyle(b).display !== 'none' && b.offsetParent !== null).length);
      eq(vis, 0, 'sichtbare Info-Knöpfe in der Preisliste');
      eq(await page.locator('#app .sheet.printonly .ii').count(), 0, 'Info-Knöpfe innerhalb der Preisliste');
    } finally { await page.emulateMedia({ media: 'screen' }); }
  });
  await S('Info-Fenster stört keinen laufenden Dialog: Dialog öffnen, schließen, Info geht weiter', async () => {
    await tab('kasse');
    await page.locator('#app [data-a="a-jour"]').click();
    await page.locator('#modal [data-a="m-x"]').click();
    await idle(page);
    await page.locator('#app .ii[data-k="storno"]').click();
    await see(page, 'Storno nimmt eine eigene Eingabe zurück', '#modal');
    await page.locator('#modal button', { hasText: 'OK' }).click();
    await page.locator('#app [data-a="a-jour"]').click();
    await fillModal(page, 'Buchung von Hand', { t: 'Infotest', i: '0,01' });
    await page.locator('#app .it', { hasText: 'Infotest' }).waitFor();
    await idle(page);
    await page.evaluate(async () => { await SB.from('journal').delete().eq('text', 'Infotest'); });
  });

  /* ---------- Stimmen die Texte mit dem Verhalten überein? (nur was sich nachprüfen lässt) ---------- */
  await S('Text Haltbarkeit „Rot ab 14 Tagen“: Ware mit genau 14 Tagen Rest ist rot', async () => {
    await page.evaluate(async day => {
      const p = (await SB.from('products').select('id').eq('active', true).order('name').limit(1)).data[0];
      const { error } = await SB.from('purchase_items').insert({ purchase_id: null, product_id: p.id, qty: 0, cents: 0, mhd: day });
      if (error) throw new Error(error.message);
    }, isoDay(14));
    await page.reload(); await page.locator('#nav:not([hidden])').waitFor(); await tab('einkauf');
    const d = isoDay(14).split('-'); const r = row(page, `${d[2]}.${d[1]}.`);
    await r.first().waitFor();
    const lamp = await r.first().locator('i.lamp').getAttribute('class');
    eq(lamp, 'lamp r', `Ampel bei genau 14 Tagen Rest (Text: „${(await page.evaluate(() => INFO.mhd)).slice(60)}“)`);
  });
  await S('Text Sicherung „Lädt alle Kiosk-Daten“: die Datei enthält auch Wünsche und Foto-/Einkaufs-Aufträge', async () => {
    await tab('bon'); await hideToast(page);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.locator('#app [data-a="a-backup"]').click()]);
    const data = JSON.parse(require('fs').readFileSync(await dl.path(), 'utf8'));
    await idle(page);
    const fehlt = ['wishes', 'wish_votes', 'photo_jobs'].filter(k => !(k in data));
    expect(fehlt.length === 0, 'In der Sicherung fehlen die Tabellen: ' + fehlt.join(', '));
  });
  await K('Text Buchungen „Hier steht jede Buchung“: auch die 31. Buchung ist zu sehen', async () => {
    await page.evaluate(async ([pid, day]) => {
      const rows = Array.from({ length: 31 }, (_, i) => ({ person_id: pid, day, amount_cents: i % 2 ? 1 : -1, kind: 'korrektur' }));
      const { error } = await SB.from('ledger').insert(rows); if (error) throw new Error(error.message);
    }, [vera, isoDay()]);
    await kp.reload(); await see(kp, 'Schuldschein von Vera');
    eq(await kp.locator('#app .it', { hasText: 'Korrektur' }).count(), 31, 'angezeigte Buchungen bei 31 vorhandenen');
  });
  await K('Text Rangliste „Welche Produkte jemand kauft, wird nicht gespeichert“: 5 Minuten nach dem Kauf ist die Verbindung Kauf–Produkt weg, auch wenn niemand die App öffnet', async () => {
    await idle(kp); await hideToast(kp);
    await kp.locator('button.it').first().click();
    await kp.locator('#modal button.pri').click();
    await toast(kp, /angeschrieben/);
    await idle(kp);
    // 10 Minuten „vergehen lassen“ (nur in der Datenbank möglich); seitdem öffnet niemand die Kollegen-Ansicht.
    await sql(`update ledger set ts = ts - interval '10 minutes' where person_id = '${vera}' and ts is not null`);
    const l = (await db('ledger', 'sale_id,ts,kind', 'person_id', vera)).filter(x => x.kind === 'kauf');
    eq(l.length, 1, 'Käufe von Vera');
    const sale = l[0].sale_id ? (await db('sales', 'product_id', 'id', l[0].sale_id))[0] : null;
    const name = sale ? (await db('products', 'name', 'id', sale.product_id))[0].name : null;
    expect(l[0].sale_id === null, `Der Kauf ist 10 Minuten später noch mit dem Produkt verknüpft (für den Verwalter lesbar: Vera → ${name})`);
  });
  await K('Die Verknüpfung verschwindet, sobald irgendein Kollege die App öffnet', async () => {
    await kp.reload(); await see(kp, 'Schuldschein von Vera');
    const l = (await db('ledger', 'sale_id,kind', 'person_id', vera)).filter(x => x.kind === 'kauf');
    eq(l[0].sale_id, null, 'Verknüpfung nach dem Öffnen der App');
  });
  await S('Aufräumen; keine Fehler in der Browser-Konsole', async () => {
    await page.evaluate(async () => { await SB.from('purchase_items').delete().is('purchase_id', null); });
    const real = [...page.problems, ...kp.problems].filter(p => !/favicon/i.test(p));
    expect(real.length === 0, real.join(' · '));
  });
  await kp.context().close();
  await page.context().close();
};
