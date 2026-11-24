'use strict';
/* Kiosk-Express (Lieferkorb) und Adventskalender (ab app.js v32, Ausbaustufe 7). */
const { CFG, step, setGroup, expect, eq, newPage, toast, hideToast, idle, fillModal, pickName, loggedOut, anzahl, see, lnIs, anonApi, sql, isoDay } = require('./lib');

/* JSON mit sortierten Schlüsseln, damit die Reihenfolge der Felder egal ist */
const J = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(n => [n, x[n]])) : x);

module.exports = async function extras(browser) {
  setGroup('Kiosk-Express und Adventskalender');
  const page = await newPage(browser);                     // Verwalter
  const kp = await newPage(browser, { hasTouch: true });    // Handy von Elias
  const S = (n, f) => step(n, f, page), K = (n, f) => step(n, f, kp);
  const db = (table, select, filterCol, filterVal) => page.evaluate(async ([t, s, c, v]) => {
    let q = SB.from(t).select(s); if (c) q = q.eq(c, v);
    const { data, error } = await q; if (error) throw new Error(error.message); return data;
  }, [table, select, filterCol, filterVal]);
  const rpc = (fn, args) => page.evaluate(async ([f, a]) => { const { data, error } = await SB.rpc(f, a); return error ? { error: error.message } : { data }; }, [fn, args]);
  const must = async (fn, args) => { const r = await rpc(fn, args); expect(!r.error, `${fn}: ${r.error}`); return r.data; };
  const reload = async () => { await page.reload(); await page.locator('#nav:not([hidden])').waitFor(); };
  const ids = {}, prod = {}, tok = {};
  let code = null, api = null;
  const saldo = async n => (await db('ledger', 'amount_cents', 'person_id', ids[n])).reduce((a, l) => a + l.amount_cents, 0);
  const stock = async n => (await db('products', 'stock', 'id', prod[n]))[0].stock;
  const call = async (fn, data) => { const r = await api.post('/rest/v1/rpc/' + fn, { data }); const t = await r.text(); try { return JSON.parse(t); } catch { return { status: r.status(), text: t.slice(0, 160) }; } };
  const setS = (k, v) => sql(`insert into settings values ('${k}', '${v}') on conflict (key) do update set value = excluded.value`);
  const kReload = async () => { await kp.reload(); await see(kp, 'Schuldschein von Elias'); await idle(kp); };
  const bar = () => kp.evaluate(() => { const b = document.querySelector('#cartbar'); return b ? { text: b.innerText.replace(/\s+/g, ' ').trim(), ok: !b.querySelector('[data-a="k-cart-ok"]').disabled } : null; });
  const inKorb = async (name, n) => { await idle(kp); await hideToast(kp); await kp.locator('button.it', { hasText: name }).first().click(); await anzahl(kp, name, n); await toast(kp, new RegExp(`${n} × ${name} im Lieferkorb`)); await idle(kp); };
  const bestellen = async office => {
    await idle(kp); await hideToast(kp);
    await kp.locator('#cartbar [data-a="k-cart-ok"]').click();
    await fillModal(kp, 'Liefern lassen', { o: office });
    await kp.waitForFunction(() => !document.querySelector('#toast').hidden);
    const t = await kp.locator('#toast').innerText(); await idle(kp); return t;
  };
  const karte = () => kp.evaluate(() => { const c = document.querySelector('.express'); return c ? { schritt: [...c.querySelectorAll('.steps .on')].map(x => x.textContent).pop(), text: c.innerText.replace(/\s+/g, ' ') } : null; });
  const lieferung = async () => (await db('deliveries', 'id,person_id,office,items,total_cents,status,rating,tip,created_at')).filter(d => d.person_id === ids.Elias).sort((a, b) => a.created_at < b.created_at ? 1 : -1)[0];
  const adminDel = async (status, confirm = true) => {
    await reload(); await hideToast(page);
    await page.locator(`#app [data-a="a-del"][data-s="${status}"]`).first().click();
    if (status === 'storniert') { await page.locator('#modal h2', { hasText: 'Lieferung stornieren?' }).waitFor(); await page.locator(confirm ? '#modal button.pri' : '#modal [data-a="m-x"]').click(); }
    await idle(page);
  };

  await S('Vorbereitung: anmelden, Testprodukte und Personen (Elias, Frieda, Gustav, Hilde, Irma) anlegen', async () => {
    await page.goto(CFG.url + '#verwaltung');
    await page.locator('#alog').waitFor();
    await page.fill('#em', CFG.email); await page.fill('#pw', CFG.pw);
    await page.locator('#alog button.pri').click();
    await see(page, 'KASSENSTAND');
    code = (await db('settings', 'value', 'key', 'kiosk_code'))[0].value;
    await sql(`delete from settings where key = 'ntfy_topic'`);
    const rows = await page.evaluate(async () => {
      const { data, error } = await SB.from('products').insert([
        { name: 'E-Riegel', category: 'Expresstest', price_cents: 100, cost_cents: 50, stock: 40 },
        { name: 'E-Limo', category: 'Expresstest', price_cents: 149, stock: 40 },
        { name: 'E-Inaktiv', category: 'Expresstest', price_cents: 900, stock: 10, active: false },
      ].map(r => ({ active: true, cost_cents: null, ...r }))).select('id,name');
      if (error) throw new Error(error.message); return data;
    });
    rows.forEach(r => { prod[r.name] = r.id; });
    for (const [n, p] of [['Elias', '1212'], ['Frieda', '2323'], ['Gustav', '3434'], ['Hilde', '4545'], ['Irma', '5656']]) ids[n] = await must('a_person', { p_vorname: n, p_pin: p });
    api = await anonApi();
    for (const [n, p] of [['Frieda', '2323'], ['Gustav', '3434'], ['Hilde', '4545'], ['Irma', '5656']]) {
      const l = await call('k_login', { p_code: code, p_person: ids[n], p_pin: p }); expect(l.ok, 'Anmeldung ' + n); tok[n] = l.token;
      await call('k_consent', { p_token: l.token });
    }
  });

  /* ---------- Kiosk-Express ---------- */
  await K('Kollege: Knopf „Liefern lassen (ab 3 € frei Haus)“; ohne ihn wird wie bisher angeschrieben', async () => {
    await kp.goto(`${CFG.url}?k=${code}`);
    await pickName(kp, 'Elias');
    await kp.fill('#pin', '1212'); await kp.locator('#kpin button.pri').click();
    await kp.locator('[data-a="k-consent"]').click();
    await see(kp, 'Schuldschein von Elias');
    eq((await kp.locator('[data-a="k-cart"]').innerText()).trim(), 'Liefern lassen (ab 3 € frei Haus)', 'Knopf');
    eq(await bar(), null, 'Lieferkorb-Balken ohne Lieferkorb');
  });
  await K('Lieferkorb: leer, Balken unten, Bestellen gesperrt; Antippen legt in den Korb statt anzuschreiben', async () => {
    await kp.locator('[data-a="k-cart"]').click();
    await see(kp, 'Lieferkorb: Produkte antippen, unten bestellen.');
    let b = await bar();
    expect(b && b.text.startsWith('Lieferkorb: 0 Artikel · 0,00 €') && b.text.includes('Produkte antippen zum Hinzufügen.') && !b.ok, 'Balken: ' + JSON.stringify(b));
    await kp.locator('button.it', { hasText: 'E-Riegel' }).first().click();
    eq((await kp.locator('#modal [data-q="ok"]').innerText()).trim(), 'In den Lieferkorb', 'Knopf im Anzahl-Dialog');
    await anzahl(kp, 'E-Riegel', 2);
    await toast(kp, /^2 × E-Riegel im Lieferkorb\.$/);
    b = await bar();
    expect(b.text.includes('Lieferkorb: 2 Artikel · 2,00 €') && b.text.includes('Für 2,00 € steht der Lieferant nicht auf. Noch 1,00 € bis frei Haus.') && !b.ok, 'Balken unter 3 €: ' + JSON.stringify(b));
    eq(await saldo('Elias'), 0, 'Saldo Elias (nichts gebucht)');
  });
  await K('Ab 3,00 € wird Bestellen freigegeben; Abbrechen leert den Korb, nichts gebucht', async () => {
    await inKorb('E-Riegel', 1);
    const b = await bar();
    expect(b.text.includes('3 Artikel · 3,00 €') && b.text.includes('Lieferung frei Haus!') && b.ok, 'Balken ab 3 €: ' + JSON.stringify(b));
    await kp.locator('#cartbar [data-a="k-cart-x"]').click(); await idle(kp);
    eq(await bar(), null, 'Balken nach Abbrechen');
    eq(await saldo('Elias'), 0, 'Saldo Elias');
  });
  await K('Balken und Hinweise verdecken bei 320 px nichts; Hinweise erscheinen oben, solange der Korb offen ist', async () => {
    await kp.setViewportSize({ width: 320, height: 568 });
    try {
      await kp.locator('[data-a="k-cart"]').click();
      await inKorb('E-Limo', 1);
      const m = await kp.evaluate(() => {
        const bar = document.querySelector('#cartbar').getBoundingClientRect(), t = document.querySelector('#toast'); window.scrollTo(0, document.body.scrollHeight);
        const last = [...document.querySelectorAll('#app button')].pop().getBoundingClientRect();
        return { barH: bar.height, top: t.classList.contains('top'), lastBottom: last.bottom, barTop: document.querySelector('#cartbar').getBoundingClientRect().top,
          btns: [...document.querySelectorAll('#cartbar button')].map(b => { const r = b.getBoundingClientRect(); return r.right <= innerWidth && r.bottom <= innerHeight && r.height >= 40; }) };
      });
      expect(m.top, 'Hinweis erscheint nicht oben');
      expect(m.lastBottom <= m.barTop + 1, `letzter Knopf der Seite liegt unter dem Balken (${Math.round(m.lastBottom)} > ${Math.round(m.barTop)})`);
      expect(m.btns.every(Boolean), 'Knöpfe im Balken nicht voll sichtbar oder zu klein');
      await kp.locator('#cartbar [data-a="k-cart-x"]').click(); await idle(kp);
    } finally { await kp.setViewportSize({ width: 390, height: 844 }); }
  });
  await K('Bestellen: Büro wird abgefragt (max. 40 Zeichen); leer bestellt nichts', async () => {
    await kp.locator('[data-a="k-cart"]').click();
    await inKorb('E-Riegel', 3);
    await kp.locator('#cartbar [data-a="k-cart-ok"]').click();
    const m = kp.locator('#modal:not([hidden])');
    await m.locator('h2', { hasText: 'Liefern lassen' }).waitFor();
    eq(await m.locator('#f_o').getAttribute('maxlength'), '40', 'Zeichenbegrenzung');
    await see(kp, '1 Posten für 3,00 € werden sofort angeschrieben.', '#modal');
    await fillModal(kp, 'Liefern lassen', { o: '   ' }); await idle(kp);
    eq(await saldo('Elias'), 0, 'Saldo Elias nach leerem Büro');
    expect(await bar(), 'Lieferkorb nach leerem Büro verschwunden');
  });
  let d1 = null;
  await K('Bestellen: sofort angeschrieben, Statuskarte „Bestellt“, Büro gemerkt, Knopf „Liefern lassen“ weg', async () => {
    eq(await bestellen('Raum 3.14'), 'Bestellt! Der Kiosk-Express ist informiert.', 'Hinweis');
    eq(await saldo('Elias'), 300, 'Saldo Elias');
    await lnIs(kp, 'OFFEN', '3,00 €');
    const k = await karte(); expect(k && k.schritt === 'Bestellt' && /Bestellung eingegangen/.test(k.text), 'Statuskarte: ' + JSON.stringify(k));
    eq(await kp.evaluate(() => localStorage.getItem('kbuero')), 'Raum 3.14', 'gemerktes Büro');
    eq(await kp.locator('[data-a="k-cart"]').count(), 0, 'Knopf „Liefern lassen“ bei offener Lieferung');
    d1 = await lieferung();
    eq(J({ o: d1.office, i: d1.items, t: d1.total_cents, s: d1.status }), J({ o: 'Raum 3.14', i: [{ name: 'E-Riegel', qty: 3 }], t: 300, s: 'neu' }), 'Lieferung in der Datenbank');
    eq(await stock('E-Riegel'), 37, 'Bestand E-Riegel');
  });
  await K('Zweite Bestellung bei offener Lieferung wird abgelehnt (auch direkt); Büro wird beim nächsten Mal vorgeschlagen', async () => {
    const t = await kp.evaluate(() => localStorage.getItem('ktoken'));
    const r = await call('k_deliver', { p_token: t, p_items: [{ id: prod['E-Riegel'], qty: 3 }], p_office: 'X' });
    eq(J(r), J({ ok: false, err: 'offen' }), 'Antwort');
    eq(await saldo('Elias'), 300, 'Saldo Elias');
  });
  await S('Verwaltung: Bon zeigt „Kiosk-Express“ mit Vorname, Büro, Artikeln, Betrag und Knöpfen', async () => {
    await reload();
    const sec = await page.evaluate(() => { const h = [...document.querySelectorAll('#app h2')].find(x => x.textContent.startsWith('Kiosk-Express')); if (!h) return null;
      const r = h.nextElementSibling; return { h: h.textContent.replace(/\s*i$/, '').trim(), text: r.innerText.replace(/\s+/g, ' '), knoepfe: [...r.querySelectorAll('button')].map(b => b.textContent).join('|') }; });
    expect(sec, 'Abschnitt fehlt');
    eq(sec.h, 'Kiosk-Express (1)', 'Überschrift');
    expect(sec.text.includes('Elias · Büro Raum 3.14') && sec.text.includes('3 × E-Riegel · 3,00 €') && sec.text.includes('neu'), 'Zeile: ' + sec.text);
    eq(sec.knoepfe, 'Unterwegs|Geliefert|Storno', 'Knöpfe');
  });
  await S('„Unterwegs“: Kollege sieht den Schritt, Verwaltung zeigt nur noch Geliefert/Storno', async () => {
    await adminDel('unterwegs');
    await kReload();
    const k = await karte(); expect(k.schritt === 'Unterwegs' && /Unterwegs!/.test(k.text), 'Statuskarte: ' + JSON.stringify(k));
    await reload();
    eq((await page.locator('#app [data-a="a-del"]').allInnerTexts()).join('|'), 'Geliefert|Storno', 'Knöpfe');
  });
  await S('„Geliefert“: Büro und Artikel gelöscht, Kollege kann bewerten, Abschnitt verschwindet', async () => {
    await adminDel('geliefert');
    const d = await lieferung();
    eq(J({ o: d.office, i: d.items, s: d.status }), J({ o: null, i: null, s: 'geliefert' }), 'Lieferung nach „geliefert“');
    expect(!(await page.locator('#app h2', { hasText: 'Kiosk-Express' }).count()), 'Abschnitt steht noch auf dem Bon');
    await kReload();
    const k = await karte(); expect(k.schritt === 'Geliefert' && k.text.includes('Wie war die Lieferung?'), 'Statuskarte: ' + JSON.stringify(k));
    expect(await kp.locator('[data-a="k-rate-ok"]').isDisabled(), '„Bewerten“ ohne Auswahl freigegeben');
    expect(await kp.locator('[data-a="k-cart"]').count() === 1, 'Knopf „Liefern lassen“ nach der Lieferung fehlt');
  });
  await K('Bewertung 4 Schokoriegel + 10 Cent Trinkgeld: einmalig, Trinkgeld auf dem Schuldschein', async () => {
    await kp.locator('[data-a="k-rate"][data-v="4"]').click(); await idle(kp);
    eq((await kp.locator('[data-a="k-rate"]').evaluateAll(bs => bs.map(b => b.getAttribute('aria-pressed')))).join(','), 'true,true,true,true,false', 'markierte Riegel');
    await kp.locator('[data-a="k-tip"][data-v="10cent"]').click(); await idle(kp);
    await kp.locator('[data-a="k-rate-ok"]').click(); await idle(kp);
    await see(kp, 'Danke für 4 von 5 Schokoriegeln! Die 10 Cent Trinkgeld stehen auf deinem Schuldschein.');
    eq(await saldo('Elias'), 310, 'Saldo Elias');
    await see(kp, 'Trinkgeld');
    const d = await lieferung(); eq(`${d.rating}/${d.tip}`, '4/10cent', 'Bewertung in der Datenbank');
    const t = await kp.evaluate(() => localStorage.getItem('ktoken'));
    eq(J(await call('k_rate', { p_token: t, p_id: d.id, p_rating: 5, p_tip: '10cent' })), 'false', 'zweite Bewertung');
    eq(await saldo('Elias'), 310, 'Saldo nach zweitem Versuch');
  });
  await K('Storno: Betrag wird gutgeschrieben, Bestand bleibt, Karte verschwindet', async () => {
    await kp.locator('[data-a="k-cart"]').click();
    await inKorb('E-Limo', 3);
    eq(await bestellen('Raum 3.14'), 'Bestellt! Der Kiosk-Express ist informiert.', 'Hinweis');
    eq(await saldo('Elias'), 310 + 447, 'Saldo nach Bestellung');
    const st = await stock('E-Limo');
    await adminDel('storniert', false);
    eq((await lieferung()).status, 'neu', 'Status nach abgebrochenem Storno');
    await adminDel('storniert');
    const d = await lieferung();
    eq(J({ s: d.status, o: d.office, i: d.items }), J({ s: 'storniert', o: null, i: null }), 'Lieferung nach Storno');
    eq(await saldo('Elias'), 310, 'Saldo nach Storno'); eq(await stock('E-Limo'), st, 'Bestand nach Storno');
    await kReload(); const k = await karte();
    expect(!k || k.schritt === 'Geliefert', 'Statuskarte nach Storno zeigt die stornierte Bestellung: ' + JSON.stringify(k));   // sichtbar bleibt höchstens die frühere, gelieferte
  });
  await K('Rückgängig auf die Lieferbuchung + Storno ergibt keine doppelte Gutschrift', async () => {
    await kp.locator('[data-a="k-cart"]').click();
    await inKorb('E-Riegel', 3);
    await bestellen('Raum 3.14');
    const vor = 310, nach = await saldo('Elias');
    eq(nach, vor + 300, 'Saldo nach Bestellung');
    const undo = await kp.locator('[data-a="k-undo"]').count();
    if (undo) { await hideToast(kp); await kp.locator('[data-a="k-undo"]').first().click(); await toast(kp, /Buchung zurückgenommen/); await idle(kp); }
    const nachUndo = await saldo('Elias');
    const d = await lieferung();
    await adminDel('storniert');
    const end = await saldo('Elias');
    eq(end, vor, `Saldo am Ende (Rückgängig-Knopf an der Lieferbuchung: ${undo ? 'ja' : 'nein'}; nach Rückgängig ${nachUndo}, Lieferung weiter offen über ${d.total_cents} Cent, Storno schreibt ${d.total_cents} gut)`);
  });
  await S('Direkt: Mindestwert, Büro, Menge, Einwilligung werden vor dem Buchen geprüft; nichts halb gebucht', async () => {
    const t = tok.Frieda, l0 = (await db('ledger', 'id', 'person_id', ids.Frieda)).length, s0 = await stock('E-Riegel'), d0 = (await db('deliveries', 'id')).length;
    const F = [
      [[{ id: prod['E-Riegel'], qty: 2 }, { id: prod['E-Inaktiv'], qty: 5 }], 'B', 'mindest', 'inaktives Produkt zählt nicht zum Mindestwert'],
      [[{ id: prod['E-Riegel'], qty: 2 }, { id: prod['E-Limo'], qty: 11 }], 'B', 'mindest', 'Menge 11 zählt nicht'],
      [[{ id: prod['E-Riegel'], qty: 2 }, { id: prod['E-Limo'], qty: 0 }], 'B', 'mindest', 'Menge 0 zählt nicht'],
      [[{ id: prod['E-Riegel'], qty: 3 }], '', 'buero', 'leeres Büro'],
      [[{ id: prod['E-Riegel'], qty: 3 }], 'x'.repeat(41), 'buero', 'Büro mit 41 Zeichen'],
      [[], 'B', 'leer', 'leerer Korb'],
      [Array.from({ length: 21 }, () => ({ id: prod['E-Riegel'], qty: 1 })), 'B', 'leer', '21 Posten'],
      [{ id: prod['E-Riegel'], qty: 5 }, 'B', 'leer', 'kein Array']];
    const bad = [];
    for (const [items, o, err, was] of F) { const r = await call('k_deliver', { p_token: t, p_items: items, p_office: o }); if (!(r && r.ok === false && r.err === err)) bad.push(`${was}: ${JSON.stringify(r).slice(0, 120)}`); }
    const r1 = await call('k_deliver', { p_token: t, p_items: [{ id: prod['E-Riegel'], qty: 2 }, { id: 'kein-uuid', qty: 2 }], p_office: 'B' });
    const r2 = await call('k_deliver', { p_token: 'erfunden', p_items: [{ id: prod['E-Riegel'], qty: 5 }], p_office: 'B' });
    if (!(r2 && r2.err === 'sitzung')) bad.push('erfundene Sitzung: ' + JSON.stringify(r2));
    eq((await db('ledger', 'id', 'person_id', ids.Frieda)).length, l0, `Buchungen von Frieda (ungültige Kennung: ${JSON.stringify(r1).slice(0, 80)})`);
    eq(await stock('E-Riegel'), s0, 'Bestand E-Riegel'); eq((await db('deliveries', 'id')).length, d0, 'Lieferungen');
    expect(bad.length === 0, bad.join(' · '));
  });
  await S('Direkt: ohne Einwilligung keine Lieferung', async () => {
    const l = await call('k_login', { p_code: code, p_person: (await must('a_person', { p_vorname: 'Jana', p_pin: '6767' })), p_pin: '6767' });
    const r = await call('k_deliver', { p_token: l.token, p_items: [{ id: prod['E-Riegel'], qty: 5 }], p_office: 'B' });
    eq(J(r), J({ ok: false, err: 'einwilligung' }), 'Antwort');
  });
  await S('Gültige Posten werden gebucht, ungültige (Menge 11, inaktiv) übersprungen; Gesamtbetrag stimmt', async () => {
    const r = await call('k_deliver', { p_token: tok.Frieda, p_items: [{ id: prod['E-Riegel'], qty: 3 }, { id: prod['E-Limo'], qty: 11 }, { id: prod['E-Inaktiv'], qty: 1 }], p_office: 'Lager' });
    expect(r.ok && r.summe === 300, 'Antwort: ' + JSON.stringify(r));
    const d = (await db('deliveries', 'items,total_cents', 'person_id', ids.Frieda))[0];
    eq(J(d), J({ items: [{ name: 'E-Riegel', qty: 3 }], total_cents: 300 }), 'Lieferung');
    await must('a_delivery', { p_id: r.id, p_status: 'geliefert' });
  });
  await S('Mehrere gleichzeitige Bestellungen derselben Person: höchstens eine offene Lieferung', async () => {
    const d0 = (await db('deliveries', 'id', 'person_id', ids.Gustav)).length, s0 = await stock('E-Riegel');
    const rs = await Promise.all([1, 2, 3, 4].map(() => call('k_deliver', { p_token: tok.Gustav, p_items: [{ id: prod['E-Riegel'], qty: 3 }], p_office: 'Werkstatt' })));
    const okN = rs.filter(r => r.ok).length, n = (await db('deliveries', 'id', 'person_id', ids.Gustav)).length - d0;
    const gebucht = (await db('ledger', 'amount_cents', 'person_id', ids.Gustav)).reduce((a, l) => a + l.amount_cents, 0);
    for (const r of rs.filter(r => r.ok)) await must('a_delivery', { p_id: r.id, p_status: 'storniert' });
    eq(`${okN}/${n}/${s0 - await stock('E-Riegel')}/${gebucht}`, '1/1/3/300', 'erfolgreiche Antworten / neue Lieferungen / abgebuchter Bestand / gebuchter Betrag in Cent');
  });
  await S('Benachrichtigung: ohne Kanal kein Fehler und kein Hinweis; „Einrichten“ erzeugt geheimen Kanal kiosk-+24 Zeichen', async () => {
    const al = (await db('alerts', 'text')).filter(a => /Benachrichtigung/.test(a.text));
    eq(al.length, 0, 'Hinweise „Benachrichtigung konnte nicht gesendet werden“');
    await page.locator('#nav [data-t="leute"]').click();
    await see(page, 'Noch keine Benachrichtigung eingerichtet.');
    await page.locator('#app [data-a="a-ntfy"]').click();
    await fillModal(page, 'Benachrichtigung einrichten', {});
    await idle(page);
    const topic = ((await db('settings', 'value', 'key', 'ntfy_topic'))[0] || {}).value;
    await sql(`delete from settings where key = 'ntfy_topic'`);   // sofort wieder entfernen: Testbestellungen sollen nichts an ntfy.sh senden
    expect(/^kiosk-[0-9a-f]{24}$/.test(topic || ''), 'Kanal: ' + topic);
  });
  await S('Rechte: ohne Anmeldung kein Zugriff auf Lieferungen, Gewinne und interne Funktionen', async () => {
    const bad = [];
    for (const t of ['deliveries', 'advent_wins']) { const r = await api.get(`/rest/v1/${t}?select=*`); if (r.status() < 400) bad.push(`${t} lesbar (${r.status()})`); }
    for (const [f, a] of [['k_notify', { p_title: 'x', p_body: 'x' }], ['k_buy_one', { pid: ids.Elias, p_product: prod['E-Riegel'], p_qty: 1 }], ['k_advent', { pid: ids.Elias }],
      ['a_delivery', { p_id: '00000000-0000-0000-0000-000000000000', p_status: 'geliefert' }], ['http_post', { url: 'https://example.invalid' }]]) {
      const r = await api.post('/rest/v1/rpc/' + f, { data: a }); if (r.status() < 400) bad.push(`${f} aufrufbar (${r.status()})`);
    }
    expect(bad.length === 0, bad.join(' · '));
  });
  await S('Rechte: Kollege sieht nur die eigene Lieferung, k_delivery liefert kein Büro und keine Artikel', async () => {
    const r = await call('k_delivery', { p_token: tok.Frieda });
    eq(Object.keys(r || {}).sort().join(','), 'created_at,id,rating,status,tip,total_cents', 'Felder');
    const e = await call('k_delivery', { p_token: tok.Hilde }); eq(e, null, 'Lieferung für Hilde (hat keine)');
  });
  await S('Aufräumen: offene Lieferung nach 2 Tagen ohne Büro/Artikel, Lieferungen nach 30 Tagen gelöscht', async () => {
    const r = await call('k_deliver', { p_token: tok.Hilde, p_items: [{ id: prod['E-Riegel'], qty: 3 }], p_office: 'Keller' });
    expect(r.ok, 'Bestellung Hilde: ' + JSON.stringify(r));
    await sql(`update deliveries set created_at = now() - interval '3 days' where id = '${r.id}'`);
    await must('a_cleanup', {});
    let d = (await db('deliveries', 'office,items,status', 'id', r.id))[0];
    eq(J(d), J({ office: null, items: null, status: 'neu' }), 'nach 3 Tagen');
    await sql(`update deliveries set created_at = now() - interval '31 days' where id = '${r.id}'`);
    await must('a_cleanup', {});
    eq((await db('deliveries', 'id', 'id', r.id)).length, 0, 'nach 31 Tagen');
  });

  /* ---------- Adventskalender (Gewinnliste advent_pool mit Gewichten, ab v34) ---------- */
  const POOL = '[{"match":"Knoppers%","w":40},{"match":"Corny Big%Banane%","w":35},{"match":"Choceur Peanut%","w":8},{"match":"Corny Erdbeere%","w":8},{"match":"Golden Bridge%","w":8},{"match":"Choceur Milk%","w":8}]';
  const GEW = { 'Knoppers': 40, 'Corny Big Chocolate Banane': 35, 'Choceur Peanut Bits': 8, 'Corny Erdbeere': 8, 'Golden Bridge Müsliriegel': 8, 'Choceur Milk & Crisp': 8 };
const SUMME = Object.values(GEW).reduce((a, b) => a + b, 0);
  const ADV = ['Knoppers', 'Knoppers Joghurt', 'Knoppers Alt', 'Corny Big Chocolate Banane', 'Corny Big Karamell', 'Corny Big Schoko', 'Corny Erdbeere', 'Golden Bridge Müsliriegel', 'Choceur Milk & Crisp', 'Kinder Country', 'Choceur Peanut Bits'];
  const pool = v => sql(`insert into settings values ('advent_pool', '${v.replace(/'/g, "''")}') on conflict (key) do update set value = excluded.value`);
  const mhd = async list => { await sql(`delete from purchase_items where purchase_id is null; ` + list.map(([n, d]) => `insert into purchase_items(purchase_id, product_id, qty, cents, mhd) values (null, '${prod[n]}', 1, 0, '${isoDay(d)}');`).join(' ')); };
  const kauf = async who => call('k_buy', { p_token: tok[who], p_product: prod['E-Riegel'], p_qty: 1 });
  const zeitraum = async (von, bis) => { await setS('advent_von', isoDay(von)); await setS('advent_bis', isoDay(bis)); await sql(`delete from advent_wins`); };
  const vorrat = n => sql(`update products set stock = ${n} where category = 'Adventtest'`);
  await S('Advent-Vorbereitung: Produkte der Gewinnliste anlegen (inkl. Corny Big Karamell/Schoko, die nie gewinnen dürfen)', async () => {
    const rows = await sql(`insert into products(name, category, price_cents, cost_cents, stock, active) values ` +
      ADV.map(n => n === 'Choceur Peanut Bits' ? `('${n}', 'Adventtest', 0, null, 5, false)` : `('${n}', 'Adventtest', 100, 40, 5, true)`).join(',') +
      ` on conflict (name) do update set category = 'Adventtest', stock = 5, active = excluded.active, price_cents = excluded.price_cents, cost_cents = excluded.cost_cents returning id, name`);
    rows.forEach(r => { prod[r.name] = r.id; });
    await pool(POOL);
    eq(rows.length, ADV.length, 'angelegte Produkte');
  });
  await S('Außerhalb des Zeitraums: Kauf liefert „advent“ leer, kein Gewinn', async () => {
    await zeitraum(5, 25);
    eq(J(await kauf('Frieda')), J({ ok: true, advent: null }), 'Antwort');
  });
  await S('Gewinn: Gruppe aus der Gewinnliste, darin das früheste Haltbarkeitsdatum; Verlust zum Einkaufspreis, Hinweis an den Verwalter', async () => {
    await zeitraum(-1, 19);   // Mitte in 9 Tagen
    await pool('[{"match":"Knoppers%","w":1}]');
    await mhd([['Knoppers', 10], ['Knoppers Joghurt', 3], ['Knoppers Alt', -1]]);   // Knoppers Alt ist abgelaufen
    const s0 = await stock('Knoppers Joghurt');
    const r = await kauf('Frieda');
    eq(J(r.advent), J({ tag: 2, gewonnen: true, produkt: 'Knoppers Joghurt' }), 'Gewinn');
    eq(await stock('Knoppers Joghurt'), s0 - 1, 'Bestand Knoppers Joghurt');
    const v = (await db('sales', 'qty,cents,kind', 'product_id', prod['Knoppers Joghurt'])).filter(x => x.kind === 'verlust');
    eq(J(v), J([{ qty: 1, cents: 40, kind: 'verlust' }]), 'Verlustbuchung zum Einkaufspreis');
    expect((await db('alerts', 'text')).some(a => a.text === 'Adventskalender: Frieda hat heute Knoppers Joghurt gewonnen'), 'Hinweis an den Verwalter fehlt');
  });
  await S('Abgelaufenes Produkt gewinnt nie, auch wenn es als einziges übrig ist', async () => {
    await sql(`delete from advent_wins; update products set stock = 0 where id in ('${prod['Knoppers']}', '${prod['Knoppers Joghurt']}')`);
    const r = await kauf('Gustav');
    eq(J(r.advent), J({ tag: 2, gewonnen: false }), 'Antwort (nur „Knoppers Alt“ mit abgelaufenem Datum vorrätig)');
    eq(await stock('Knoppers Alt'), 5, 'Bestand Knoppers Alt');
  });
  await S('Gruppe ohne Bestand wird nie gezogen (100 Ziehungen, Gewicht 99 : 1)', async () => {
    await sql(`update products set stock = 100000 where category = 'Adventtest'`); await mhd([]);
    await pool('[{"match":"Corny Erdbeere%","w":99},{"match":"Knoppers%","w":1}]');
    await sql(`update products set stock = 0 where id = '${prod['Corny Erdbeere']}'`);
    const rows = await sql(`create temp table sim(p text); do $$ declare pid uuid := '${ids.Irma}'; begin for i in 1..100 loop delete from advent_wins; insert into sim select k_advent(pid)->>'produkt'; end loop; end $$;
      select coalesce(p, '(kein Gewinn)') p, count(*)::int n from sim group by 1 order by 1`);
    await sql(`delete from advent_wins; delete from alerts where text like 'Adventskalender:%'; delete from sales where kind = 'verlust' and product_id in (select id from products where category = 'Adventtest')`); await vorrat(5);
    eq(J(rows), J([{ p: 'Knoppers', n: 100 }]), 'Ergebnis der Ziehungen (in der Gruppe gewinnt „Knoppers“ vor „Knoppers Alt“/„Joghurt“ nach Name)');
  });
  await S('Verteilung über 2000 simulierte Tage entspricht der Gewinnliste (40/35/8/8/8/8 von 107); Corny Big Karamell/Schoko und Kinder Country nie', async () => {
    await pool(POOL); await mhd([]);
    await sql(`update products set stock = 100000 where category = 'Adventtest'`);
    const rows = await sql(`create temp table sim(p text); do $$ declare pid uuid := '${ids.Irma}'; begin for i in 1..2000 loop delete from advent_wins; insert into sim select k_advent(pid)->>'produkt'; end loop; end $$;
      select coalesce(p, '(kein Gewinn)') p, count(*)::int n from sim group by 1 order by 2 desc`);
    await sql(`delete from advent_wins; delete from alerts where text like 'Adventskalender:%'; delete from sales where kind = 'verlust' and product_id in (select id from products where category = 'Adventtest'); update products set stock = 5 where category = 'Adventtest'`);
    const n = Object.fromEntries(rows.map(r => [r.p, r.n]));
    console.log('      Verteilung 2000 Ziehungen: ' + rows.map(r => `${r.p} ${(r.n / 20).toFixed(1)} %`).join(' | '));
    const bad = [];
    for (const [p, w] of Object.entries(GEW)) { const soll = w * 100 / SUMME, pct = (n[p] || 0) / 20, tol = soll >= 20 ? 4 : 2.5; if (Math.abs(pct - soll) > tol) bad.push(`${p}: ${pct.toFixed(1)} % statt ${soll.toFixed(1)} %`); }
    for (const p of ['Corny Big Karamell', 'Corny Big Schoko', 'Kinder Country', 'Knoppers Joghurt', 'Knoppers Alt', '(kein Gewinn)']) if (n[p]) bad.push(`${p}: ${n[p]}×`);
    expect(bad.length === 0, bad.join(' · '));
  });
  await S('Ausgeblendete Gewinn-Ware (Preis 0, kein Einkaufspreis) kann gewinnen, Verlust 0,00 ohne Fehler; Kollegen sehen sie nicht', async () => {
    await zeitraum(-1, 19); await vorrat(5); await mhd([]);
    await pool('[{"match":"Choceur Peanut%","w":1}]');
    const r = await kauf('Frieda');
    eq(J(r.advent), J({ tag: 2, gewonnen: true, produkt: 'Choceur Peanut Bits' }), 'Gewinn');
    eq(await stock('Choceur Peanut Bits'), 4, 'Bestand Choceur Peanut Bits');
    const v = (await db('sales', 'qty,cents,kind', 'product_id', prod['Choceur Peanut Bits'])).filter(x => x.kind === 'verlust');
    eq(J(v), J([{ qty: 1, cents: 0, kind: 'verlust' }]), 'Verlustbuchung');
    const st = await call('k_state', { p_token: tok.Frieda });
    expect(!st.products.some(p => p.name === 'Choceur Peanut Bits'), 'ausgeblendete Gewinn-Ware steht in der Kollegen-Ansicht');
    await sql(`delete from sales where kind = 'verlust' and product_id = '${prod['Choceur Peanut Bits']}'`); await pool(POOL);
  });
  await S('Tage ohne Kauf werden nicht nachgeholt: nach drei Tagen ohne Gewinn heute trotzdem nur ein Gewinn', async () => {
    await zeitraum(-3, 17); await vorrat(5); await mhd([]);
    const rs = [await kauf('Frieda'), await kauf('Gustav'), await kauf('Irma')];
    eq(rs.map(r => r.advent.gewonnen).join(','), 'true,false,false', 'Gewinne bei drei Käufen heute');
    eq((await db('advent_wins', 'day')).length, 1, 'Einträge insgesamt');
    eq(rs[0].advent.tag, 4, 'Türchen');
    await zeitraum(-1, 19);
  });
  await S('Leere oder kaputte Gewinnliste: Kauf klappt, kein Gewinn, kein Fehler', async () => {
    const bad = [];
    for (const v of ['[]', '', 'kaputt', '{}', '[{"match":"Knoppers%","w":"viel"}]', '[{"w":40}]', 'null']) {
      await sql(`delete from advent_wins`); await pool(v);
      const l0 = (await db('ledger', 'id', 'person_id', ids.Gustav)).length;
      const r = await kauf('Gustav');
      const gebucht = (await db('ledger', 'id', 'person_id', ids.Gustav)).length - l0;
      if (!(r && r.ok === true && gebucht === 1 && (r.advent === null || r.advent.gewonnen === false))) bad.push(`„${v}“: ${(r && r.message) || JSON.stringify(r).slice(0, 100)} (Kauf gebucht: ${gebucht ? 'ja' : 'nein'})`);
    }
    await sql(`delete from settings where key = 'advent_pool'; delete from advent_wins`);
    const r = await kauf('Gustav');
    if (!(r && r.ok === true && (r.advent === null || r.advent.gewonnen === false))) bad.push(`ohne Eintrag: ${JSON.stringify(r).slice(0, 140)}`);
    await pool(POOL);
    expect(bad.length === 0, bad.join(' · '));
  });
  await S('Höchstens ein Gewinn pro Tag; Bon zeigt „Adventskalender: Heute … gewinnt …“', async () => {
    await sql(`delete from advent_wins`); await pool('[{"match":"Knoppers%","w":1}]'); await vorrat(5);
    expect((await kauf('Frieda')).advent.gewonnen, 'erster Kauf gewinnt nicht');
    eq(J((await kauf('Gustav')).advent), J({ tag: 2, gewonnen: false }), 'zweiter Käufer am Tag');
    await reload();
    await lnIs(page, 'Heute', 'Frieda gewinnt Knoppers');
    await lnIs(page, 'Gewinne bisher', '1');
  });
  await K('Kollege: Fenster „Türchen 2“ mit Spruch, einmal pro Tag und Gerät; beim nächsten Kauf nicht noch einmal', async () => {
    await kp.evaluate(() => localStorage.removeItem('kadvent'));
    await kReload(); await hideToast(kp);
    await kp.locator('button.it', { hasText: 'E-Riegel' }).first().click(); await anzahl(kp, 'E-Riegel', 1);
    await kp.locator('#modal:not([hidden]) h2', { hasText: 'Adventskalender, Türchen 2' }).waitFor();
    const txt = await kp.locator('#modal').innerText();
    expect(/Morgen öffnet sich das nächste Türchen\./.test(txt) && !/Gewonnen/.test(txt), 'Fenster: ' + txt.replace(/\s+/g, ' '));
    await kp.locator('#modal [data-a="m-close"]').click(); await idle(kp);
    eq(await kp.evaluate(() => localStorage.getItem('kadvent')), isoDay(0), 'gemerkter Tag');
    await hideToast(kp);
    await kp.locator('button.it', { hasText: 'E-Riegel' }).first().click(); await anzahl(kp, 'E-Riegel', 1);
    await toast(kp, /angeschrieben/); await idle(kp);
    eq(await kp.locator('#modal:not([hidden])').count(), 0, 'Fenster beim zweiten Kauf');
  });
  await K('Kollege: Gewinn zeigt „Gewonnen!“ mit Produkt (auch über den Lieferkorb)', async () => {
    await sql(`delete from advent_wins`);
    await kp.locator('[data-a="k-cart"]').click();
    await inKorb('E-Riegel', 3);
    await bestellen('Raum 3.14');
    await kp.locator('#modal:not([hidden]) h2', { hasText: 'Türchen 2' }).waitFor();
    const txt = (await kp.locator('#modal').innerText()).replace(/\s+/g, ' ');
    expect(txt.includes('Gewonnen!') && txt.includes('Nimm dir am Kiosk ein Knoppers kostenlos mit.'), 'Fenster: ' + txt);
    await kp.locator('#modal [data-a="m-close"]').click(); await idle(kp);
    await adminDel('geliefert');
  });
  await S('Zweiter Gewinn derselben Person erst ab der Mitte des Zeitraums, höchstens zwei', async () => {
    await sql(`delete from advent_wins; insert into advent_wins(day, person_id) values ('${isoDay(-1)}', '${ids.Hilde}')`);
    let r = await kauf('Hilde');
    eq(r.advent.gewonnen, false, 'Hilde vor der Mitte (hat schon 1)');
    r = await kauf('Irma');
    eq(r.advent.gewonnen, true, 'Irma (noch kein Gewinn) gewinnt danach am selben Tag');
    await zeitraum(-15, 5);   // Mitte vor 5 Tagen
    await sql(`insert into advent_wins(day, person_id) values ('${isoDay(-1)}', '${ids.Hilde}')`);
    r = await kauf('Hilde');
    eq(r.advent.gewonnen, true, 'Hilde nach der Mitte (hat 1)');
    await sql(`delete from advent_wins where day = '${isoDay(0)}'; insert into advent_wins(day, person_id) values ('${isoDay(-2)}', '${ids.Hilde}')`);
    r = await kauf('Hilde');
    eq(r.advent.gewonnen, false, 'Hilde mit schon 2 Gewinnen');
  });
  await S('Gleichzeitige Käufe am selben Tag: genau ein Gewinner, Gewinn nur einmal abgebucht', async () => {
    await zeitraum(-1, 19); await vorrat(5);
    tok.Elias = await kp.evaluate(() => localStorage.getItem('ktoken'));
    const who = ['Frieda', 'Gustav', 'Irma', 'Elias'];
    const rs = await Promise.all([...who, ...who].map(w => kauf(w)));
    const wins = rs.filter(r => r.advent && r.advent.gewonnen).length;
    const rows = (await db('advent_wins', 'day')).filter(x => x.day === isoDay(0)).length;
    const weg = (await sql(`select coalesce(sum(5 - stock), 0)::int n from products where category = 'Adventtest'`))[0].n;
    eq(`${wins}/${rows}/${weg}`, '1/1/1', 'Gewinner / Einträge heute / abgebuchte Gewinne');
  });
  await S('Aufräumen: Adventszeitraum und Gewinnliste zurück; keine Fehler in der Browser-Konsole', async () => {
    await setS('advent_von', '2026-12-01'); await setS('advent_bis', '2026-12-24'); await pool(POOL);
    await sql(`delete from advent_wins; delete from purchase_items where purchase_id is null`);
    for (const t of Object.values(tok)) await call('k_logout', { p_token: t });
    await api.dispose();
    const real = [...page.problems, ...kp.problems].filter(p => !/favicon/i.test(p));
    expect(real.length === 0, real.join(' · '));
  });
  await kp.context().close();
  await page.context().close();
};
