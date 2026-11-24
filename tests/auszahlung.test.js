'use strict';
/* Guthaben auszahlen und Kassensturz mit Auszahlungen (Ausbaustufe 5). Eigene Personen, damit der Teil für sich allein rechnet. */
const { CFG, step, setGroup, expect, eq, newPage, toast, hideToast, idle, fillModal, listSaldo, pickName, see, prow, row, rowHas, lnIs, anonApi } = require('./lib');

const eur = c => (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NIL = '00000000-0000-0000-0000-000000000000';

module.exports = async function auszahlung(browser) {
  setGroup('Auszahlung');
  const page = await newPage(browser);     // Verwalter
  const kp = await newPage(browser);       // Kollege Paul
  const S = (n, f) => step(n, f, page), K = (n, f) => step(n, f, kp);
  const tab = async t => { await idle(page); await page.locator(`#nav [data-t="${t}"]`).click(); await page.locator(`#nav [data-t="${t}"].on`).waitFor(); };
  const db = (table, select, filterCol, filterVal) => page.evaluate(async ([t, s, c, v]) => {
    let q = SB.from(t).select(s); if (c) q = q.eq(c, v);
    const { data, error } = await q; if (error) throw new Error(error.message); return data;
  }, [table, select, filterCol, filterVal]);
  const rpc = (fn, args) => page.evaluate(async ([f, a]) => { const { data, error } = await SB.rpc(f, a); return error ? { error: error.message } : { data }; }, [fn, args]);
  const must = async (fn, args) => { const r = await rpc(fn, args); expect(!r.error, `${fn}: ${r.error}`); return r.data; };
  const adminReload = async () => { await page.reload(); await page.locator('#nav:not([hidden])').waitFor(); };
  const ids = {};
  const saldo = async n => (await db('ledger', 'amount_cents', 'person_id', ids[n])).reduce((a, l) => a + l.amount_cents, 0);
  const stand = async () => (await db('journal', 'in_cents,out_cents')).reduce((a, x) => a + x.in_cents - x.out_cents, 0);
  const anzeige = n => listSaldo(page, n);   // Cent, negativ = Guthaben
  const hatKnopf = async n => (await prow(page, n).locator('[data-a="a-payout"]').count()) === 1;
  /* Auszahlungs-Dialog öffnen; liefert [Text im Dialog, vorgeschlagener Betrag] */
  const dialog = async name => {
    await idle(page); await hideToast(page);
    await prow(page, name).locator('[data-a="a-payout"]').click();
    const m = page.locator('#modal:not([hidden])');
    await m.locator('h2', { hasText: 'Auszahlung an ' + name }).waitFor();
    return [(await m.locator('p.small').first().innerText()).trim(), await m.locator('#f_c').inputValue()];
  };
  const buchen = async amount => {
    if (amount !== null) await page.locator('#modal #f_c').fill(amount);
    await page.locator('#modal button.pri').click();
    await page.waitForFunction(() => { const t = document.querySelector('#toast'); return !t.hidden && /Ausgezahlt|Nicht gebucht/.test(t.textContent); });
    const t = await page.locator('#toast').innerText();
    await idle(page);
    return t;
  };
  const sturz = async amount => {
    await adminReload(); await tab('kasse'); await hideToast(page);
    await page.locator('#app [data-a="a-cash"]').click();
    await fillModal(page, 'Kassensturz', { c: amount });
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
  const letzter = async () => (await db('cash_counts', 'cents,bar_cents,at')).sort((a, b) => a.at < b.at ? 1 : -1)[0];
  let code = null;

  await S('Vorbereitung: anmelden, Personen anlegen (Paul 20,00 Guthaben, Rita 0,00, Sven 1,00 offen, Toni 2,00 und Uwe 7,30 Guthaben)', async () => {
    await page.goto(CFG.url + '#verwaltung');
    await page.locator('#alog').waitFor();
    await page.fill('#em', CFG.email); await page.fill('#pw', CFG.pw);
    await page.locator('#alog button.pri').click();
    await see(page, 'KASSENSTAND');
    code = (await db('settings', 'value', 'key', 'kiosk_code'))[0].value;
    for (const [n, p] of [['Paul', '8181'], ['Rita', '8282'], ['Sven', '8383'], ['Toni', '8484'], ['Uwe', '8585']]) ids[n] = await must('a_person', { p_vorname: n, p_pin: p });
    await must('a_pay', { p_person: ids.Paul, p_cents: 2000 });
    await must('a_fix', { p_person: ids.Sven, p_cents: 100 });
    await must('a_pay', { p_person: ids.Toni, p_cents: 200 });
    await must('a_pay', { p_person: ids.Uwe, p_cents: 730 });
    await adminReload(); await tab('leute');
  });
  await S('Knopf „Auszahlung“ nur bei Personen mit Guthaben', async () => {
    eq(`${await hatKnopf('Paul')}/${await hatKnopf('Rita')}/${await hatKnopf('Sven')}`, 'true/false/false', 'Knopf bei Paul (Guthaben) / Rita (0,00) / Sven (offen)');
  });
  await S('Direkter Aufruf: bei Saldo 0, bei offenem Betrag und für unbekannte Person „zu_viel“; 0 und negativ abgelehnt', async () => {
    const before = await stand();
    eq(JSON.stringify(await rpc('a_payout', { p_person: ids.Rita, p_cents: 1 })), '{"data":"zu_viel"}', 'Auszahlung bei Saldo 0');
    eq(JSON.stringify(await rpc('a_payout', { p_person: ids.Sven, p_cents: 50 })), '{"data":"zu_viel"}', 'Auszahlung bei offenem Betrag');
    eq(JSON.stringify(await rpc('a_payout', { p_person: NIL, p_cents: 50 })), '{"data":"zu_viel"}', 'Auszahlung an unbekannte Person');
    for (const c of [0, -500]) { const r = await rpc('a_payout', { p_person: ids.Paul, p_cents: c }); expect(r.error && /nicht erlaubt/.test(r.error), `a_payout(${c}): ${JSON.stringify(r)}`); }
    eq(await stand(), before, 'Kassenstand nach den abgelehnten Versuchen');
    eq(`${await saldo('Rita')}/${await saldo('Sven')}/${await saldo('Paul')}`, '0/100/-2000', 'Salden Rita/Sven/Paul');
  });
  await S('Dialog nennt das Guthaben und schlägt es als Betrag vor; Abbrechen bucht nichts', async () => {
    const [intro, vorschlag] = await dialog('Paul');
    eq(intro, 'Guthaben: 20,00 €. Mehr lässt sich nicht auszahlen. Das Geld kommt aus der Kioskkasse.', 'Text im Dialog');
    eq(vorschlag, '20,00', 'vorgeschlagener Betrag');
    await page.locator('#modal [data-a="m-x"]').click(); await idle(page);
    eq(await saldo('Paul'), -2000, 'Saldo Paul');
  });
  await S('Teilauszahlung 5,00: Guthaben sinkt, Kassenbuch bekommt eine Ausgabe, Kassenstand sinkt', async () => {
    const before = await stand(), n = (await db('journal', 'id')).length;
    await dialog('Paul');
    eq(await buchen('5,00'), 'Ausgezahlt: 5,00 €.', 'Hinweis');
    eq(await anzeige('Paul'), -1500, 'Anzeige bei Paul (Cent, negativ = Guthaben)');
    const l = (await db('ledger', 'amount_cents,kind,day', 'person_id', ids.Paul)).filter(x => x.kind === 'auszahlung');
    eq(JSON.stringify(l.map(x => x.amount_cents)), '[500]', 'Schuldschein-Buchung „auszahlung“');
    const j = await db('journal', 'text,in_cents,out_cents,kind', 'kind', 'auszahlung');
    eq(JSON.stringify(j), JSON.stringify([{ text: 'Auszahlung Guthaben', in_cents: 0, out_cents: 500, kind: 'auszahlung' }]), 'Kassenbuch-Zeile');
    eq((await db('journal', 'id')).length, n + 1, 'Anzahl Kassenbuch-Zeilen');
    eq(await stand(), before - 500, 'Kassenstand in Cent');
    await tab('bon'); await lnIs(page, 'KASSENSTAND', eur(before - 500)); await tab('leute');
  });
  await S('Mehr als das Guthaben wird abgelehnt', async () => {
    const before = await stand();
    await dialog('Paul');
    eq(await buchen('15,01'), 'Nicht gebucht: Der Betrag ist höher als das Guthaben.', 'Hinweis');
    eq(await saldo('Paul'), -1500, 'Saldo Paul'); eq(await stand(), before, 'Kassenstand');
  });
  await S('Dialog liest den Saldo frisch (Einzahlung seit dem Laden der Seite)', async () => {
    await must('a_pay', { p_person: ids.Paul, p_cents: 100 });   // ohne Neuladen der Verwaltung
    const [intro, vorschlag] = await dialog('Paul');
    eq(intro, 'Guthaben: 16,00 €. Mehr lässt sich nicht auszahlen. Das Geld kommt aus der Kioskkasse.', 'Text im Dialog');
    eq(vorschlag, '16,00', 'vorgeschlagener Betrag');
    await page.locator('#modal [data-a="m-x"]').click(); await idle(page);
  });
  await S('Knopf bei inzwischen aufgebrauchtem Guthaben: Hinweis statt Dialog, Knopf verschwindet', async () => {
    eq(JSON.stringify(await rpc('a_payout', { p_person: ids.Toni, p_cents: 200 })), '{"data":"ok"}', 'Vollauszahlung an Toni im Hintergrund');
    await idle(page); await hideToast(page);
    await prow(page, 'Toni').locator('[data-a="a-payout"]').click();
    await toast(page, /^Toni hat kein Guthaben\.$/);
    await idle(page);
    expect(!(await page.locator('#modal:not([hidden])').count()), 'Dialog ging trotzdem auf');
    eq(await hatKnopf('Toni'), false, 'Knopf bei Toni nach dem Neuladen');
  });
  await S('Vollauszahlung mit dem vorgeschlagenen Betrag: 0,00, kein Knopf mehr', async () => {
    const [, vorschlag] = await dialog('Uwe');
    eq(vorschlag, '7,30', 'vorgeschlagener Betrag');
    eq(await buchen(null), 'Ausgezahlt: 7,30 €.', 'Hinweis');
    eq(await anzeige('Uwe'), 0, 'Anzeige bei Uwe'); eq(await hatKnopf('Uwe'), false, 'Knopf bei Uwe'); eq(await saldo('Uwe'), 0, 'Saldo Uwe');
  });
  await K('Kollege sieht „Auszahlung 5,00“ in seinen Buchungen (ohne Rückgängig) und sein restliches Guthaben', async () => {
    await kp.goto(`${CFG.url}?k=${code}`);
    await pickName(kp, 'Paul');
    await kp.fill('#pin', '8181');
    await kp.locator('#kpin button.pri').click();
    await kp.locator('[data-a="k-consent"]').click();
    await see(kp, 'Schuldschein von Paul');
    await lnIs(kp, 'DEIN GUTHABEN', '16,00 €');
    const r = kp.locator('#app .it', { hasText: 'Auszahlung' });
    eq(await r.count(), 1, 'Zeilen „Auszahlung“');
    const txt = (await r.innerText()).replace(/\s+/g, ' ').trim();
    expect(/^\d\d\.\d\d\. Auszahlung 5,00$/.test(txt), 'Zeile: ' + txt);
    eq(await r.locator('[data-a="k-undo"]').count(), 0, 'Rückgängig-Knopf an der Auszahlung');
  });
  await S('Kasse: „Auszahlung Guthaben“ steht als Ausgabe in den letzten Buchungen, ohne Storno', async () => {
    await adminReload(); await tab('kasse');
    const r = row(page, 'Auszahlung Guthaben').first();
    await r.waitFor();
    eq(await page.locator('#app .it', { hasText: 'Auszahlung Guthaben' }).locator('[data-a="a-storno"]').count(), 0, 'Storno-Knöpfe an Auszahlungen');
    await rowHas(page, 'Auszahlung Guthaben', /−\d,\d\d/);
    const j = (await db('journal', 'id', 'kind', 'auszahlung'))[0];
    eq(JSON.stringify(await rpc('a_storno', { p_journal: j.id })), '{"data":"nicht_moeglich"}', 'Storno einer Auszahlung (direkt)');
  });
  await S('Drei gleichzeitige Vollauszahlungen: genau eine wird gebucht', async () => {
    const before = await stand(), n = (await db('journal', 'id', 'kind', 'auszahlung')).length;
    const rs = await page.evaluate(async id => (await Promise.all([1, 2, 3].map(() => SB.rpc('a_payout', { p_person: id, p_cents: 1600 })))).map(r => r.error ? 'Fehler: ' + r.error.message : r.data), ids.Paul);
    eq(rs.slice().sort().join(','), 'ok,zu_viel,zu_viel', 'Antworten');
    eq(await saldo('Paul'), 0, 'Saldo Paul'); eq(await stand(), before - 1600, 'Kassenstand');
    eq((await db('journal', 'id', 'kind', 'auszahlung')).length, n + 1, 'Auszahlungs-Zeilen im Kassenbuch');
  });
  await S('Person ist nach der Vollauszahlung löschbar', async () => {
    await adminReload(); await tab('leute'); await hideToast(page);
    await prow(page, 'Paul').locator('[data-a="a-more"]').click();
    await fillModal(page, 'Paul', { a: 'del', x: '' });
    await toast(page, /Person gelöscht\./);
    await idle(page);
    eq((await db('persons', 'id', 'vorname', 'Paul')).length, 0, 'Paul in der Datenbank');
  });

  /* ---------- Kassensturz rechnet Einzahlungen minus Auszahlungen heraus ---------- */
  await S('Kassensturz, nur Auszahlung: Kasse 10,00, Auszahlung 5,00 → Barverkauf 15,00', async () => {
    await must('a_pay', { p_person: ids.Rita, p_cents: 3000 });
    await must('a_cash_box', { p_cents: 0 });                     // Ausgangspunkt: ab hier zählt nur, was folgt
    eq(await must('a_payout', { p_person: ids.Rita, p_cents: 500 }), 'ok', 'Auszahlung');
    eq(await sturz('10,00'), 'Gebucht: 15,00 € Barverkäufe, 5,00 € Auszahlungen sind eingerechnet.', 'Hinweis');
    const c = await letzter(); eq(`${c.cents}/${c.bar_cents}`, '1000/1500', 'Kassensturz (Inhalt/bar)');
  });
  await S('Kassensturz gemischt: Einzahlung 20,00, Auszahlung 5,00, Kasse 30,00 → Barverkauf 15,00', async () => {
    await must('a_pay', { p_person: ids.Rita, p_cents: 2000 });
    eq(await must('a_payout', { p_person: ids.Rita, p_cents: 500 }), 'ok', 'Auszahlung');
    eq(await sturz('30,00'), 'Gebucht: 15,00 € Barverkäufe, 15,00 € stammen aus Einzahlungen.', 'Hinweis');
    const c = await letzter(); eq(`${c.cents}/${c.bar_cents}`, '3000/1500', 'Kassensturz (Inhalt/bar)');
  });
  await S('Kassensturz, Einzahlung und Auszahlung gleich hoch: nichts wird herausgerechnet', async () => {
    await must('a_pay', { p_person: ids.Rita, p_cents: 500 });
    eq(await must('a_payout', { p_person: ids.Rita, p_cents: 500 }), 'ok', 'Auszahlung');
    eq(await sturz('3,00'), 'Gebucht: 3,00 € Barverkäufe.', 'Hinweis');
  });
  await S('Kassensturz mit zu wenig Geld (Einzahlung 20,00, Auszahlung 5,00, Kasse 5,00): Warn-Dialog „Es fehlen 10,00 €“', async () => {
    await must('a_pay', { p_person: ids.Rita, p_cents: 2000 });
    eq(await must('a_payout', { p_person: ids.Rita, p_cents: 500 }), 'ok', 'Auszahlung');
    const dlg = await sturz('5,00');
    expect(/Achtung: Es fehlt Geld/i.test(dlg) && dlg.includes('Es fehlen 10,00 €.') && dlg.includes('In der Kasse waren 5,00 €.') && dlg.includes('15,00 € aus Einzahlungen (abzüglich Auszahlungen)'), 'Warn-Dialog: ' + dlg);
    const c = await letzter(); eq(`${c.cents}/${c.bar_cents}`, '500/-1000', 'Kassensturz (Inhalt/bar)');
  });
  await S('Bon: Kassenstand und „Guthaben der Kollegen“ stimmen mit der Datenbank überein', async () => {
    await adminReload();
    await lnIs(page, 'KASSENSTAND', eur(await stand()));
    const saldi = {}; (await db('ledger', 'person_id,amount_cents')).forEach(l => { saldi[l.person_id] = (saldi[l.person_id] || 0) + l.amount_cents; });
    await lnIs(page, 'Guthaben der Kollegen', eur(-Object.values(saldi).filter(v => v < 0).reduce((a, v) => a + v, 0)));
    eq(await saldo('Rita'), -(3000 + 2000 + 500 + 2000 - 4 * 500), 'Saldo Rita');
  });
  await S('Ohne Anmeldung ist die Auszahlung gesperrt; keine Fehler in der Browser-Konsole', async () => {
    const api = await anonApi();
    const r = await api.post('/rest/v1/rpc/a_payout', { data: { p_person: ids.Rita, p_cents: 100 } });
    expect(r.status() >= 400, 'a_payout ohne Anmeldung: Status ' + r.status());
    await api.dispose();
    const real = [...page.problems, ...kp.problems].filter(p => !/favicon|nicht erlaubt|status of 400/i.test(p));
    expect(real.length === 0, real.join(' · '));
  });
  await kp.context().close();
  await page.context().close();
};
