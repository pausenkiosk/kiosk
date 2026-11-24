// Anmeldemaske der Kollegen mit erfundenen Daten prüfen: gemerkter Name, Suche, Liste.
// Alle Anfragen an Supabase werden hier beantwortet, die echte Datenbank wird nicht berührt.
// Start: im Projektordner `python3 -m http.server 8765`, dann `node tests/kollege-mock.js <Ordner für Bildschirmfotos>`
const { chromium } = require('playwright');
const VORNAMEN = ['Alex', 'Anna', 'Ben', 'Carla', 'Dana', 'Emil', 'Finn', 'Gina', 'Hanna', 'Ida', 'Jan', 'Karl', 'Lena', 'Mia', 'Noah', 'Ole', 'Paul', 'Rosa', 'Sam', 'Tom'];
const names = n => VORNAMEN.slice(0, n).map((v, i) => ({ id: 'id-' + i, vorname: v }));
const state = { vorname: 'Karl', consent: true, saldo: -1250, entries: [{ id: 'e1', day: '2026-11-24', cents: -2000, kind: 'zahlung', undo: false }, { id: 'e2', day: '2026-11-24', cents: 750, kind: 'kauf', undo: false }],
  products: [{ id: 'p1', name: 'Cola', cat: 'Getränke', cents: 100, normal: 100, sale: false, stock: 4 }, { id: 'p2', name: 'Fanta', cat: 'Getränke', cents: 100, normal: 100, sale: false, stock: 0 }] };

(async () => {
  const b = await chromium.launch();
  let failed = 0;
  const out = process.argv[2] || '.';
  const run = async (title, n, preset, fn) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(p => { for (const [k, v] of Object.entries(p)) localStorage.setItem(k, v); }, preset);
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.route('**/kglxlmjhrzeaswqadfnn.supabase.co/**', r => {
      const u = r.request().url();
      if (u.includes('rpc/k_names')) return r.fulfill({ json: names(n) });
      if (u.includes('rpc/k_login')) return r.fulfill({ json: { ok: true, token: 'tok' } });
      if (u.includes('rpc/k_state')) return r.fulfill({ json: state });
      return r.fulfill({ json: null });
    });
    try { await fn(p, ctx); if (errs.length) throw new Error('Konsole: ' + errs.join(' | ')); console.log('ok  ', title); }
    catch (e) { failed++; console.log('FAIL', title, '|', e.message.split('\n')[0]); }
    await ctx.close();
  };
  const grid = p => p.$$eval('#kgrid button', bs => bs.map(x => x.textContent));
  const login = async p => { await p.fill('#pin', '1234'); await p.click('text=Anmelden'); await p.waitForSelector('text=Deine Buchungen'); };

  await run('Wenige Namen: Liste ohne Suchfeld', 5, { kcode: 'c' }, async p => {
    await p.goto('http://localhost:8765/'); await p.waitForSelector('text=Wer bist du?');
    if (await p.$('#kq')) throw new Error('Suchfeld bei 5 Namen');
    if ((await grid(p)).length !== 5) throw new Error('Liste');
  });
  await run('Viele Namen: Suche statt Liste', 20, { kcode: 'c' }, async p => {
    await p.goto('http://localhost:8765/'); await p.waitForSelector('#kq');
    if ((await grid(p)).length) throw new Error('Liste ohne Eingabe sichtbar');
    await p.fill('#kq', 'k'); if (JSON.stringify(await grid(p)) !== '["Karl"]') throw new Error('Treffer k: ' + await grid(p));
    await p.fill('#kq', 'xy'); await p.waitForSelector('text=Kein Treffer.');
    await p.fill('#kq', 'A'); if ((await grid(p)).join() !== 'Alex,Anna') throw new Error('Treffer A');
    await p.screenshot({ path: out + '/k-suche.png' });
  });
  await run('Nach Anmeldung merkt sich das Handy den Namen', 20, { kcode: 'c' }, async (p, ctx) => {
    await p.goto('http://localhost:8765/'); await p.fill('#kq', 'Ka'); await p.click('#kgrid >> text=Karl'); await login(p);
    const fav = await p.evaluate(() => localStorage.getItem('kfav'));
    if (!fav || !fav.includes('Karl')) throw new Error('nicht gemerkt: ' + fav);
    await p.screenshot({ path: out + '/k-seite.png', fullPage: true });
    if (!(await p.$('text=Als App auf den Startbildschirm'))) throw new Error('Anleitung fehlt');
    await p.click('text=Als App auf den Startbildschirm'); await p.waitForSelector('text=Zum Home-Bildschirm');
    if (await p.$('button.it:has-text("Fanta")')) throw new Error('Produkt ohne Bestand sichtbar');
    if (!(await p.$('button.it:has-text("Cola")'))) throw new Error('Produkt mit Bestand fehlt');
    await p.click('text=PIN ändern'); await p.fill('#f_o', '1234'); await p.fill('#f_n', '5678'); await p.fill('#f_w', '5679'); await p.click('#mform button.pri');
    await p.waitForFunction(() => document.querySelector('#toast').textContent.includes('nicht gleich'), null, { timeout: 5000 });
    const sal = await p.$eval('.big span.pos', x => x.textContent).catch(() => null);
    if (sal !== '12,50 €') throw new Error('Guthaben nicht grün: ' + sal);
    await p.click('text=Abmelden'); await p.waitForSelector('text=Weiter als Karl');
    if (await p.$('#kq')) throw new Error('Suchfeld trotz Favorit');
    await p.screenshot({ path: out + '/k-favorit.png' });
    await p.click('text=Andere Person'); await p.waitForSelector('#kq');
    await p.click('text=Zurück zu meinem Namen'); await p.waitForSelector('text=Weiter als Karl');
    await p.click('text=Weiter als Karl'); await p.waitForSelector('text=Hallo Karl');
  });
  await run('Vergessen entfernt den Namen', 20, { kcode: 'c', ktoken: 'tok', kfav: JSON.stringify({ id: 'id-11', n: 'Karl' }) }, async p => {
    await p.goto('http://localhost:8765/'); await p.waitForSelector('text=Deine Buchungen');
    await p.click('[data-a="k-forget"]');
    if (await p.evaluate(() => localStorage.getItem('kfav'))) throw new Error('noch gespeichert');
  });
  await run('Gemerkter Name, der nicht mehr existiert, wird verworfen', 5, { kcode: 'c', kfav: JSON.stringify({ id: 'weg', n: 'Weg' }) }, async p => {
    await p.goto('http://localhost:8765/'); await p.waitForSelector('text=Wer bist du?');
    if (await p.$('text=Weiter als Weg')) throw new Error('alter Name angezeigt');
    if (await p.evaluate(() => localStorage.getItem('kfav'))) throw new Error('nicht verworfen');
  });
  await b.close();
  process.exit(failed ? 1 : 0);
})();
