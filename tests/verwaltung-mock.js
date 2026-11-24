// Verwalter-Ansichten mit erfundenen Daten prüfen.
// Alle Anfragen an Supabase werden hier beantwortet, die echte Datenbank wird nicht berührt.
// Start: im Projektordner `python3 -m http.server 8765`, dann `node tests/verwaltung-mock.js <Ordner für Bildschirmfotos>`
const { chromium } = require('playwright');
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const ago = n => new Date(Date.now() - n * 864e5).toISOString();
const data = {
  products: [
    { id: 'p1', name: 'Cola', category: 'Getränke', price_cents: 100, sale_cents: null, cost_cents: 60, stock: 3, active: true, created_at: '2026-01-01T00:00:00Z' },
    { id: 'p2', name: 'Twix', category: 'Süßes', price_cents: 80, sale_cents: 50, cost_cents: 90, stock: 12, active: true, created_at: '2026-01-01T00:00:00Z' },
    { id: 'p3', name: 'Alt', category: 'Süßes', price_cents: 0, sale_cents: null, cost_cents: null, stock: 0, active: false, created_at: '2026-01-01T00:00:00Z' }],
  sales: [{ product_id: 'p1', qty: 20, cents: 2000, kind: 'app', at: ago(5) }, { product_id: 'p2', qty: 2, cents: 160, kind: 'zaehlung', at: ago(3) }],
  journal: [{ id: 'jn1', day: day(-2), text: 'Einkauf Rewe', in_cents: 0, out_cents: 1500, kind: 'einkauf', ref: 'pu1', source: 'app' }, { id: 'jn2', day: day(-40), text: 'Verkauf', in_cents: 3000, out_cents: 0, kind: 'excel', ref: null, source: 'excel' }, { id: 'jn3', day: '2025-12-01', text: 'Verkauf', in_cents: 500, out_cents: 0, kind: 'hand', ref: null, source: 'hand' }],
  ledger: [{ person_id: 'a', amount_cents: 350, kind: 'kauf', day: day(-1) }, { person_id: 'a', amount_cents: -100, kind: 'zahlung', day: day(0) }, { person_id: 'b', amount_cents: -2000, kind: 'zahlung', day: day(0) }, { person_id: 'b', amount_cents: 150, kind: 'kauf', day: day(0) }],
  persons: [{ id: 'a', vorname: 'Muster', consent_at: '2026-11-01', locked_until: null, active: true }, { id: 'b', vorname: 'Beispiel', consent_at: null, locked_until: new Date(Date.now() + 3e6).toISOString(), active: true }],
  purchase_items: [{ id: 'm1', qty: 6, mhd: day(5), product_id: 'p2' }, { id: 'm2', qty: 0, mhd: day(22), product_id: 'p1' }, { id: 'm3', qty: 0, mhd: day(200), product_id: 'p1' }],
  alerts: [{ id: 'al', at: ago(0), text: 'Anmeldung von Beispiel nach 3 falschen PINs für 1 Stunde gesperrt' }],
  cash_counts: [{ day: day(0), cents: 1820, bar_cents: 1500, at: ago(0) }],
  settings: [{ key: 'kiosk_code', value: 'abc123' }, { key: 'backup_at', value: day(-20) }, { key: 'kiosk_code_at', value: day(-45) }, { key: 'advent_von', value: day(-3) }, { key: 'advent_bis', value: day(20) }],
  wishes: [{ id: 'w1', text: 'Mehr Eistee', created_at: '2026-11-24T08:00:00Z', wish_votes: [{ count: 3 }] }],
  deliveries: [{ id: 'd1', person_id: 'a', office: '2.14', items: [{ name: 'Cola', qty: 3 }], total_cents: 300, status: 'neu', rating: null, tip: null, created_at: ago(0) }],
  advent_wins: [{ day: day(0), person_id: 'a', product_id: 'p2' }],
  requests: [{ id: 'r1', at: ago(0), text: 'Bitte Knopf größer', status: 'neu', answer: null }, { id: 'r2', at: ago(0), text: '8 Produktfotos', status: 'erledigt', answer: 'Eingetragen.' }],
  photo_jobs: [
    { id: 'j1', at: ago(0), paths: ['x'], status: 'vorschlag', result: [{ id: 'p1', qty: 7 }], note: 'Twix verdeckt', kind: 'foto', text: null },
    { id: 'j2', at: ago(0), paths: [], status: 'vorschlag', result: { store: 'Rewe', day: day(-1), items: [{ id: 'p1', qty: 12, cents: 948 }, { id: 'p2', qty: 6, cents: 390 }] }, note: 'Preis Twix geschätzt', kind: 'einkauf', text: 'bei Rewe' },
    { id: 'j3', at: ago(0), paths: ['a', 'b'], status: 'neu', result: null, note: null, kind: 'einkauf', text: null }]
};
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => localStorage.setItem('sb-kglxlmjhrzeaswqadfnn-auth-token', JSON.stringify({
    access_token: 'x', refresh_token: 'y', token_type: 'bearer', expires_in: 99999, expires_at: Math.floor(Date.now() / 1000) + 99999, user: { id: 'u', email: 't@example.invalid' } })));
  const p = await ctx.newPage();
  const errs = [], calls = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await p.route('**/kglxlmjhrzeaswqadfnn.supabase.co/**', r => {
    const u = new URL(r.request().url()), m = r.request().method(), t = u.pathname.split('/').pop();
    if (m !== 'GET') calls.push(m + ' ' + u.pathname.replace('/rest/v1/', '') + ' ' + (r.request().postData() || '').slice(0, 110));
    if (u.pathname.includes('/rpc/is_admin')) return r.fulfill({ json: true });
    if (u.pathname.includes('/rpc/a_cash_box')) return r.fulfill({ json: { paid: 500, bar: 1320 } });
    if (u.pathname.includes('/rpc/a_storno')) return r.fulfill({ json: 'ok' });
    if (u.pathname.includes('/rpc/a_payout')) return r.fulfill({ json: 'ok' });
    if (u.pathname.includes('/rpc/a_cleanup')) return r.fulfill({ json: null });
    if (u.pathname.includes('/rpc/a_delivery')) return r.fulfill({ json: 'ok' });
    if (u.pathname.includes('/rpc/a_fix')) return r.fulfill({ json: null });
    if (u.pathname.includes('/storage/v1/object/list')) return r.fulfill({ json: [] });
    if (u.pathname.includes('/auth/')) return r.fulfill({ json: {} });
    const pid = (u.searchParams.get('person_id') || '').replace(/^eq\./, '');
    if (m === 'GET' && data[t]) return r.fulfill({ json: pid ? data[t].filter(x => x.person_id === pid) : data[t] });
    return r.fulfill({ json: m === 'GET' ? [] : null });
  });
  const out = process.argv[2] || '.';
  let failed = 0;
  const step = async (n, f) => { try { await f(); console.log('ok  ', n); } catch (e) { failed++; console.log('FAIL', n, '|', e.message.split('\n')[0]); } };
  const has = async (...ts) => { const x = await p.textContent('#app'); for (const t of ts) if (!x.includes(t)) throw new Error('fehlt: ' + t); };
  const closed = () => p.waitForSelector('#modal', { state: 'hidden' });

  await p.goto('http://localhost:8765/#verwaltung');
  await step('Bon', async () => { await p.waitForSelector('text=KASSENSTAND', { timeout: 8000 }); await has('Läuft in 14 Tagen ab (1)', 'Läuft in 30 Tagen ab (1)', 'Unter Einkaufspreis (1)', 'Hinweise', 'Nachbestellen', 'Bitte jetzt sichern', 'An Claude', 'Guthaben der Kollegen', '18,50', 'Läuft als Nächstes ab', 'QR-Code erneuern', '45 Tage alt'); });
  await p.screenshot({ path: out + '/a-bon.png', fullPage: true });
  await step('Bon: Kiosk-Express und Adventskalender', async () => { await has('Kiosk-Express (1)', 'Büro 2.14', '3 × Cola', 'Adventskalender', 'Muster gewinnt Twix');
    await p.click('[data-a="a-del"][data-s="geliefert"]'); await p.waitForFunction(() => document.querySelector('#toast').textContent.includes('geliefert'), null, { timeout: 5000 });
    if (!calls.some(c => c.includes('a_delivery') && c.includes('geliefert'))) throw new Error('Status nicht gesendet'); });
  await step('Regal', async () => { await p.click('#nav >> text=Regal'); await has('Cola', 'Alt', 'Vorschlag liegt vor', 'Wünsche der Kollegen', 'Mehr Eistee', '3×', 'Ampel', 'Preisliste drucken', 'Preisliste · Stand');
    if (await p.isVisible('.sheet.printonly')) throw new Error('Preisliste am Bildschirm sichtbar');
    await p.emulateMedia({ media: 'print' }); const vis = await p.isVisible('.sheet.printonly'), nav = await p.isVisible('#nav'); await p.emulateMedia({ media: 'screen' });
    if (!vis || nav) throw new Error('Druckansicht: Preisliste ' + vis + ', Leiste ' + nav); });
  await step('Regal: Foto-Vorschlag prüfen', async () => { await p.click('[data-a="a-job"]'); await has('Foto 7', 'Twix verdeckt'); const v = await p.inputValue('[data-cnt="p1"]'); if (v !== '7') throw new Error('Wert ' + v); await p.click('text=Zählung speichern'); await p.waitForSelector('[data-a="a-cnt"]'); });
  await step('Regal: Produkt bearbeiten', async () => { await p.click('button.it:has-text("Cola")'); await p.fill('#f_price', '1,20'); await p.click('#mform button.pri'); await closed(); });
  await step('Regal: Produkt löschen', async () => { await p.waitForTimeout(600); await p.click('button.it:has-text("Alt")'); await p.selectOption('#f_active', 'del'); await p.click('#mform button.pri'); await p.waitForSelector('text=endgültig löschen?'); await p.click('#mform button.pri'); await closed(); });
  await step('Einkauf', async () => { await p.click('#nav >> text=Einkauf'); await has('Einkauf per Foto oder Ansage', 'Vorschlag liegt vor', 'wartet auf Auswertung', 'Haltbarkeit'); });
  await p.screenshot({ path: out + '/a-einkauf.png', fullPage: true });
  await step('Einkauf: Vorschlag prüfen und speichern', async () => {
    await p.click('[data-a="a-draft"]'); await has('Vorschlag prüfen', 'Preis Twix geschätzt');
    if (await p.inputValue('#estore') !== 'Rewe') throw new Error('Laden');
    if ((await p.$$('#cart .cart')).length !== 2) throw new Error('Zeilen');
    if (await p.inputValue('#cart .cart:nth-child(1) input:nth-of-type(2)') !== '9,48') throw new Error('Preis');
    await p.click('text=Einkauf speichern'); await p.waitForSelector('text=Einkauf von Hand');
  });
  await step('Einkauf ansagen', async () => { await p.click('text=Einkauf ansagen'); await p.fill('#f_t', 'Bei Rewe 12 Cola für 9,48'); await p.click('#mform button.pri'); await closed(); });
  await step('Kasse', async () => { await p.click('#nav >> text=Kasse'); await has('Einnahmen und Ausgaben', 'Verkauf letzte 4 Wochen', 'Letzte Buchungen'); await p.click('.seg >> text=Woche'); await p.click('.seg >> text=Jahr'); await has('2025'); });
  await step('Kasse: Ein- und Verkaufspreise', async () => { await has('Ein- und Verkaufspreise', 'Warenwert im Regal'); const tx = await p.textContent('#app'); if (!/Cola\s*0,60\s*1,00\s*0,40\s*40/.test(tx.replace(/\s+/g, ' '))) throw new Error('Zeile Cola falsch'); });
  await step('Kasse: Kassensturz', async () => { await p.click('[data-a="a-cash"]'); await p.fill('#f_c', '18,20'); await p.click('#mform button.pri'); await closed(); await p.waitForFunction(() => { const t = document.querySelector('#toast').textContent; return t.includes('13,20 € Barverkäufe') && t.includes('5,00 €'); }, null, { timeout: 5000 }); });
  await step('Kasse: Storno', async () => { await p.waitForSelector('[data-a="a-storno"]'); const n = (await p.$$('[data-a="a-storno"]')).length; if (n !== 2) throw new Error('Storno-Knöpfe: ' + n); await p.click('[data-a="a-storno"] >> nth=0'); await p.waitForSelector('text=Buchung stornieren?'); await p.click('#mform button.pri'); await closed(); });
  await step('Leute', async () => { await p.click('#nav >> text=Leute'); await has('Muster', 'Rangliste Umsatz', 'QR-Code'); if (!(await p.$('.qr img'))) throw new Error('QR fehlt'); });
  await step('Leute: neuer QR-Code', async () => { await p.click('[data-a="a-newcode"]'); await p.waitForSelector('text=Neuen QR-Code erzeugen?'); await p.click('#mform button.pri'); await closed(); await p.waitForFunction(() => document.querySelector('#toast').textContent.includes('Neuer QR-Code erzeugt'), null, { timeout: 5000 }); if (!calls.some(c => c.includes('settings') && c.includes('kiosk_code_at'))) throw new Error('nicht gespeichert'); });
  await step('Leute: Guthaben-Anzeige', async () => { await has('Einzahlung'); const cls = await p.$$eval('.it span.pos, .it span.neg', xs => xs.map(x => x.className + ':' + x.textContent));
    if (!cls.includes('pos:18,50') || !cls.includes('neg:−2,50')) throw new Error(cls.join(' | ')); });
  await step('Leute: Auszahlung', async () => { await p.click('[data-a="a-payout"]'); await p.waitForSelector('text=Auszahlung an Beispiel'); if (await p.inputValue('#f_c') !== '18,50') throw new Error('Vorschlag ' + await p.inputValue('#f_c')); await p.click('#mform button.pri'); await closed(); await p.waitForFunction(() => document.querySelector('#toast').textContent.includes('Ausgezahlt: 18,50'), null, { timeout: 5000 }); if (!calls.some(c => c.includes('a_payout'))) throw new Error('nicht gebucht'); });
  await step('Info-Knopf', async () => { const n = (await p.$$('[data-a="info"]')).length; if (n < 3) throw new Error('nur ' + n); await p.click('[data-a="info"] >> nth=0'); await p.waitForSelector('#modal:not([hidden]) >> text=Rot mit Minus'); await p.click('[data-a="m-close"]'); await closed(); });
  await step('Leute: Guthaben übertragen', async () => { await p.click('[data-a="a-more"] >> nth=0'); await p.selectOption('#f_a', 'guthaben'); await p.fill('#f_x', '-12,00'); await p.click('#mform button.pri'); await closed();
    await p.waitForFunction(() => document.querySelector('#toast').textContent.includes('12,00 € Guthaben'), null, { timeout: 5000 }); if (!calls.some(c => c.includes('a_fix') && c.includes('-1200'))) throw new Error('falsches Vorzeichen'); });
  await step('Leute: Schulden übertragen', async () => { await p.click('[data-a="a-more"] >> nth=0'); await p.selectOption('#f_a', 'schuld'); await p.fill('#f_x', '7,50'); await p.click('#mform button.pri'); await closed();
    await p.waitForFunction(() => document.querySelector('#toast').textContent.includes('7,50 € Schulden'), null, { timeout: 5000 }); if (!calls.some(c => c.includes('a_fix') && c.includes('"p_cents":750'))) throw new Error('falsches Vorzeichen'); });
  await step('Leute: ohne Auswahl nichts gebucht', async () => { const n = calls.length; await p.click('[data-a="a-more"] >> nth=0'); await p.fill('#f_x', '4711'); await p.click('#mform button.pri'); await closed();
    await p.waitForFunction(() => document.querySelector('#toast').textContent.includes('zuerst eine Aktion'), null, { timeout: 5000 }); if (calls.slice(n).some(c => c.includes('a_fix'))) throw new Error('gebucht'); });
  await step('Leute: hoher Betrag fragt nach', async () => { const n = calls.length; await p.click('[data-a="a-more"] >> nth=0'); await p.selectOption('#f_a', 'schuld'); await p.fill('#f_x', '4711'); await p.click('#mform button.pri');
    await p.waitForSelector('text=ungewöhnlich hoher Betrag'); await p.click('[data-a="m-x"]'); await closed(); if (calls.slice(n).some(c => c.includes('a_fix'))) throw new Error('trotz Abbruch gebucht'); });
  await step('Leute: Benachrichtigung einrichten', async () => { await has('Benachrichtigung'); await p.click('[data-a="a-ntfy"]'); await p.waitForSelector('text=Neuen Kanal erzeugen'); await p.click('#mform button.pri'); await closed();
    await p.waitForFunction(() => true); await p.waitForTimeout(300); if (!calls.some(c => c.includes('settings') && c.includes('ntfy_topic') && /kiosk-[0-9a-f]{24}/.test(c))) throw new Error('Kanal nicht gespeichert'); });
  await step('Leute: Zahlung', async () => { await p.click('[data-a="a-pay"] >> nth=0'); await p.fill('#f_c', '2,50'); await p.click('#mform button.pri'); await closed(); });
  await p.screenshot({ path: out + '/a-leute.png', fullPage: true });
  console.log('Schreibzugriffe:'); calls.forEach(c => console.log('  ', c));
  console.log('Fehler in der Konsole:', errs);
  await b.close();
  process.exit(failed || errs.length ? 1 : 0);
})();
