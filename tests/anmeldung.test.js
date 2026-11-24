'use strict';
/* Kollegen-Anmeldemaske: gemerkter Name, Suche ab 13 Personen, Anleitung „Als App auf den Startbildschirm“, Kiosk-Code in der Adresse.
   Der Teil blendet vorübergehend alle anderen Personen aus (nur im Testprojekt, direkt in der Datenbank) und stellt sie am Ende wieder her. */
const { CFG, step, setGroup, expect, eq, newPage, toast, hideToast, idle, see, sql } = require('./lib');

module.exports = async function anmeldung(browser) {
  setGroup('Anmeldung Kollegen');
  const page = await newPage(browser);     // Verwalter
  const kp = await newPage(browser);       // Handy eines Kollegen
  const S = (n, f) => step(n, f, page), K = (n, f) => step(n, f, kp);
  const db = (table, select, filterCol, filterVal) => page.evaluate(async ([t, s, c, v]) => {
    let q = SB.from(t).select(s); if (c) q = q.eq(c, v);
    const { data, error } = await q; if (error) throw new Error(error.message); return data;
  }, [table, select, filterCol, filterVal]);
  const rpc = (fn, args) => page.evaluate(async ([f, a]) => { const { data, error } = await SB.rpc(f, a); return error ? { error: error.message } : { data }; }, [fn, args]);
  const must = async (fn, args) => { const r = await rpc(fn, args); expect(!r.error, `${fn}: ${r.error}`); return r.data; };
  const ids = {}; let code = null, hidden = [];
  const fav = () => kp.evaluate(() => localStorage.getItem('kfav'));
  const kIs = async () => eq(new URL(kp.url()).searchParams.get('k'), code, 'Kiosk-Code in der Adresse');
  const names = () => kp.locator('#app .namegrid button').allInnerTexts();
  const pin = async v => { await hideToast(kp); await kp.fill('#pin', v); await kp.locator('#kpin button.pri').click(); };
  const login = async (name, p, viaFav = false) => {
    if (viaFav) await kp.locator('#app button', { hasText: 'Weiter als ' + name }).click();
    else await kp.locator('#app .namegrid button', { hasText: new RegExp('^' + name + '$') }).click();
    await see(kp, 'Hallo ' + name);
    await pin(p);
    await kp.waitForFunction(() => /Kurz vorab|Schuldschein von/.test(document.querySelector('#app').textContent));
    if (await kp.locator('[data-a="k-consent"]').count()) await kp.locator('[data-a="k-consent"]').click();
    await see(kp, 'Schuldschein von ' + name);
  };
  const logout = async () => { await idle(kp); await kp.locator('[data-a="k-logout"]').click(); await kp.waitForFunction(() => /Willkommen zurück|Wer bist du/.test(document.querySelector('#app').textContent)); };

  await S('Vorbereitung: Verwalter anmelden, drei Testpersonen anlegen, alle anderen vorübergehend ausblenden', async () => {
    await page.goto(CFG.url + '#verwaltung');
    await page.locator('#alog').waitFor();
    await page.fill('#em', CFG.email); await page.fill('#pw', CFG.pw);
    await page.locator('#alog button.pri').click();
    await see(page, 'KASSENSTAND');
    code = (await db('settings', 'value', 'key', 'kiosk_code'))[0].value;
    for (const [n, p] of [['Xaver', '1010'], ['Xenia', '2020'], ['Yara', '3030']]) ids[n] = await must('a_person', { p_vorname: n, p_pin: p });
    hidden = (await sql(`update persons set active = false where active and vorname not in ('Xaver', 'Xenia', 'Yara') returning id`)).map(r => r.id);
  });
  await K('Bis 12 Personen: alle Namen als Knöpfe, kein Suchfeld, Hinweis aufs Merken', async () => {
    await kp.goto(`${CFG.url}?k=${code}`);
    await see(kp, 'Wer bist du?');
    eq((await names()).join(','), 'Xaver,Xenia,Yara', 'Namensliste');
    eq(await kp.locator('#kq').count(), 0, 'Suchfelder');
    await see(kp, 'Nach der Anmeldung merkt sich dein Handy deinen Namen.');
    eq(await fav(), null, 'gemerkter Name vor der ersten Anmeldung');
  });
  await K('Nach der Anmeldung merkt sich das Gerät nur id und Vornamen, keine PIN', async () => {
    await login('Xaver', '1010');
    eq(await fav(), JSON.stringify({ id: ids.Xaver, n: 'Xaver' }), 'Inhalt von kfav');
    const all = await kp.evaluate(() => Object.keys(localStorage).map(k => k + '=' + localStorage.getItem(k)).join('\n') + '\n' + document.cookie);
    expect(!all.includes('1010'), 'PIN steht im Gerätespeicher');
    eq((await kp.evaluate(() => Object.keys(localStorage).sort().join(','))), 'kcode,kfav,ktoken', 'Einträge im Gerätespeicher');
    await kIs();
  });
  await K('Eigene Seite: Hinweis aufs Merken mit „Vergessen“ und aufklappbare Anleitung für den Startbildschirm', async () => {
    await see(kp, 'Dein Handy merkt sich deinen Namen für die nächste Anmeldung.');
    const d = kp.locator('#app details', { hasText: 'Als App auf den Startbildschirm' });
    eq(await d.count(), 1, 'Anleitungen'); eq(await d.evaluate(e => e.open), false, 'Anleitung anfangs aufgeklappt');
    await d.locator('summary').click();
    const txt = await d.innerText();
    for (const t of ['iPhone:', 'Safari', 'Teilen', '„Zum Home-Bildschirm“', 'Android:', 'Chrome', 'drei Punkte', '„Zum Startbildschirm hinzufügen“', 'Installiert wird nichts.']) expect(txt.includes(t), `In der Anleitung fehlt „${t}“`);
    expect(await d.locator('p').first().isVisible(), 'Anleitung klappt nicht auf');
  });
  await K('Abgemeldet: nur „Weiter als Xaver“ und „Andere Person“, keine Namensliste; Kiosk-Code bleibt in der Adresse', async () => {
    await logout();
    await see(kp, 'Willkommen zurück');
    eq((await kp.locator('#app button').allInnerTexts()).join('|'), 'Weiter als Xaver|Andere Person', 'Knöpfe');
    const txt = await kp.locator('#app').innerText();
    expect(!/Xenia|Yara/.test(txt), 'andere Namen sind sichtbar');
    await kIs();
  });
  await K('Mit gemerktem Namen ist weiterhin die PIN nötig', async () => {
    await kp.locator('#app button', { hasText: 'Weiter als Xaver' }).click();
    await see(kp, 'Hallo Xaver');
    eq(await kp.evaluate(() => localStorage.getItem('ktoken')), null, 'Sitzung ohne PIN');
    await pin('0000');
    await toast(kp, /Falsche PIN\. Noch 2 Versuche\./);
    await kp.locator('[data-a="k-back"]').click();
    await see(kp, 'Willkommen zurück');
    await login('Xaver', '1010', true);
    await logout();
  });
  await K('„Andere Person“ zeigt die Liste und „Zurück zu meinem Namen“', async () => {
    await kp.locator('#app button', { hasText: 'Andere Person' }).click();
    await see(kp, 'Wer bist du?');
    eq((await names()).join(','), 'Xaver,Xenia,Yara', 'Namensliste');
    await kp.locator('#app button', { hasText: 'Zurück zu meinem Namen' }).click();
    await see(kp, 'Weiter als Xaver');
    await kIs();
  });
  await K('Meldet sich eine andere Person an, merkt sich das Gerät diese', async () => {
    await kp.locator('#app button', { hasText: 'Andere Person' }).click();
    await login('Xenia', '2020');
    eq(await fav(), JSON.stringify({ id: ids.Xenia, n: 'Xenia' }), 'Inhalt von kfav');
    await logout();
    await see(kp, 'Weiter als Xenia');
  });
  await K('Nach PIN-Sperre zeigt „Weiter als“ die Sperrmeldung, auch mit richtiger PIN und nach neuem Laden', async () => {
    await kp.locator('#app button', { hasText: 'Weiter als Xenia' }).click();
    await pin('0001'); await toast(kp, /Noch 2 Versuche/);
    await pin('0002'); await toast(kp, /Noch 1 Versuch\./);
    await pin('0003'); await toast(kp, /Gesperrt bis \d{2}:\d{2} Uhr\./);
    await kp.reload();
    await see(kp, 'Weiter als Xenia');
    await kp.locator('#app button', { hasText: 'Weiter als Xenia' }).click();
    await pin('2020'); await toast(kp, /Gesperrt bis \d{2}:\d{2} Uhr\./);
    eq(await kp.evaluate(() => localStorage.getItem('ktoken')), null, 'Sitzung trotz Sperre');
    await must('a_pin', { p_person: ids.Xenia, p_pin: '2020' });   // Sperre wieder aufheben
    await kp.locator('[data-a="k-back"]').click();
  });
  await K('„Vergessen“ löscht den gemerkten Namen; danach erscheint abgemeldet wieder die Liste', async () => {
    await kp.locator('#app button', { hasText: 'Andere Person' }).click();
    await login('Yara', '3030');
    await hideToast(kp);
    await kp.locator('[data-a="k-forget"]').click();
    await toast(kp, /^Dein Handy hat deinen Namen vergessen\.$/);
    eq(await fav(), null, 'kfav nach „Vergessen“');
    await see(kp, 'Schuldschein von Yara');
    await logout();
    await see(kp, 'Wer bist du?');
    expect(!(await kp.locator('#app').innerText()).includes('Weiter als'), '„Weiter als“ trotz Vergessen');
    await kIs();
  });
  await K('Nach „Vergessen“ behauptet die eigene Seite nicht weiter, der Name sei gemerkt', async () => {
    await login('Yara', '3030');
    await kp.locator('[data-a="k-forget"]').click();
    await idle(kp);
    const txt = await kp.locator('#app').innerText();
    await logout();
    expect(!txt.includes('Dein Handy merkt sich deinen Namen für die nächste Anmeldung.'), 'Nach „Vergessen“ steht weiter da: „Dein Handy merkt sich deinen Namen für die nächste Anmeldung.“ (der Name ist aber gelöscht und wird erst bei der nächsten Anmeldung wieder gemerkt)');
  });
  await K('Gemerkte Person gibt es nicht mehr (gelöscht): Merker wird verworfen, Liste erscheint', async () => {
    await login('Xaver', '1010'); await logout();
    await see(kp, 'Weiter als Xaver');
    eq(await must('a_person_delete', { p_person: ids.Xaver }), true, 'Xaver löschen');
    await kp.reload();
    await see(kp, 'Wer bist du?');
    eq(await fav(), null, 'kfav nach dem Löschen der Person');
    eq((await names()).join(','), 'Xenia,Yara', 'Namensliste');
  });
  await K('Gemerkte Person ist ausgeblendet (inaktiv): Merker wird verworfen', async () => {
    await login('Xenia', '2020'); await logout();
    await sql(`update persons set active = false where id = '${ids.Xenia}'`);
    await kp.reload();
    await see(kp, 'Wer bist du?');
    eq(await fav(), null, 'kfav bei inaktiver Person');
    await sql(`update persons set active = true where id = '${ids.Xenia}'`);
  });
  await K('Verbogener Merker (kaputter Inhalt, fremder Name mit HTML) richtet nichts an', async () => {
    await kp.evaluate(() => localStorage.setItem('kfav', '{kaputt'));
    await kp.reload(); await see(kp, 'Wer bist du?');
    await kp.evaluate(id => localStorage.setItem('kfav', JSON.stringify({ id, n: '<img src=x onerror="window.__x=1">Chef' })), ids.Yara);
    await kp.reload(); await see(kp, 'Willkommen zurück');
    eq(await kp.locator('#app img').count(), 0, 'eingeschleuste Elemente');
    expect(await kp.evaluate(() => window.__x) === undefined, 'eingeschleuster Code wurde ausgeführt');
    await kp.locator('[data-a="k-sel"]').click();
    await pin('9999'); await toast(kp, /Falsche PIN/);   // der Name ist nur Anzeige, ohne Yaras PIN geht nichts
    await must('a_pin', { p_person: ids.Yara, p_pin: '3030' });
    await kp.evaluate(() => localStorage.removeItem('kfav'));
  });
  await K('Genau 12 Personen: weiterhin alle Namen als Knöpfe, kein Suchfeld', async () => {
    const made = await must('a_persons', { p_names: ['Alma', 'Bodo', 'Cora', 'Dirk', 'Edda', 'Falk', 'Gina', 'Hugo', 'Ines', 'Jost'] });
    eq(made.length, 10, 'angelegte Personen');
    await kp.reload(); await see(kp, 'Wer bist du?');
    eq((await names()).length, 12, 'Knöpfe'); eq(await kp.locator('#kq').count(), 0, 'Suchfelder');
  });
  await K('Ab 13 Personen: Feld „Vorname eintippen“, Liste erst nach Eingabe', async () => {
    eq((await must('a_persons', { p_names: ['Almut'] })).length, 1, 'angelegte Personen');
    await kp.reload(); await see(kp, 'Wer bist du?');
    await see(kp, 'Vorname eintippen');
    eq(await kp.locator('#kq').count(), 1, 'Suchfelder'); eq((await names()).length, 0, 'Knöpfe vor der Eingabe');
    expect(!/Alma|Bodo|Yara/.test(await kp.locator('#app').innerText()), 'Namen ohne Eingabe sichtbar');
    expect(await kp.evaluate(() => document.activeElement && document.activeElement.id === 'kq'), 'Suchfeld hat nicht den Fokus');
  });
  await K('Suche: Treffer nach Wortanfang, Groß/Klein egal, Leerzeichen egal, „Kein Treffer.“', async () => {
    const q = async v => { await kp.fill('#kq', v); return (await names()).join(','); };
    eq(await q('a'), 'Alma,Almut', 'Treffer für „a“ (nicht Yara, Edda, Cora)');
    eq(await q('ALMU'), 'Almut', 'Treffer für „ALMU“');
    eq(await q('  x '), 'Xenia', 'Treffer für „  x “');
    eq(await q('ar'), '', 'Treffer für „ar“ (kommt nur mitten im Namen vor)');
    await see(kp, 'Kein Treffer.');
    eq(await q(''), '', 'Liste nach dem Leeren'); expect(!(await kp.locator('#app').innerText()).includes('Kein Treffer.'), '„Kein Treffer.“ bei leerem Feld');
    await kp.fill('#kq', 'ya');
    await login('Yara', '3030');
    await kIs();
  });
  await K('Ab 13 Personen mit gemerktem Namen: erst „Weiter als“, unter „Andere Person“ Suche und „Zurück zu meinem Namen“', async () => {
    await logout();
    await see(kp, 'Weiter als Yara');
    eq(await kp.locator('#kq').count(), 0, 'Suchfeld neben „Weiter als“');
    await kp.locator('#app button', { hasText: 'Andere Person' }).click();
    eq(await kp.locator('#kq').count(), 1, 'Suchfelder'); eq((await names()).length, 0, 'Knöpfe vor der Eingabe');
    await kp.fill('#kq', 'bo'); eq((await names()).join(','), 'Bodo', 'Treffer');
    await kp.locator('#app button', { hasText: 'Zurück zu meinem Namen' }).click();
    await see(kp, 'Weiter als Yara');
    await kp.locator('#app button', { hasText: 'Andere Person' }).click();
    eq(await kp.inputValue('#kq'), '', 'Suchfeld nach „Zurück“ und erneutem Öffnen');
    await kIs();
  });
  await K('Symbol auf dem Startbildschirm (eigener Speicher, Adresse mit ?k=…): Anmeldung geht, Adresse behält den Code', async () => {
    const hp = await newPage(browser);   // frischer Speicher wie bei einer iOS-Web-App
    try {
      await hp.goto(kp.url());
      await see(hp, 'Wer bist du?');
      await hp.fill('#kq', 'xe');
      await hp.locator('#app .namegrid button', { hasText: /^Xenia$/ }).click();
      await hp.fill('#pin', '2020'); await hp.locator('#kpin button.pri').click();
      await see(hp, 'Schuldschein von Xenia');
      await hp.reload(); await see(hp, 'Schuldschein von Xenia');
      await hp.locator('[data-a="k-logout"]').click(); await see(hp, 'Weiter als Xenia');
      eq(new URL(hp.url()).searchParams.get('k'), code, 'Kiosk-Code in der Adresse nach Anmelden, Neuladen und Abmelden');
      const meta = await hp.evaluate(() => ({ cap: (document.querySelector('meta[name="apple-mobile-web-app-capable"]') || {}).content, icon: (document.querySelector('link[rel="apple-touch-icon"]') || {}).href, manifest: !!document.querySelector('link[rel="manifest"]') }));
      eq(meta.cap, 'yes', 'Kennzeichnung als Web-App fürs iPhone');
      const ic = await hp.request.get(meta.icon); eq(ic.status(), 200, 'Symbol fürs iPhone abrufbar');
    } finally { await hp.context().close(); }
  });
  await S('Verwaltung, Leute: Anleitung beim QR-Code vorhanden, aber nicht im Druck', async () => {
    await page.reload(); await page.locator('#nav:not([hidden])').waitFor();
    await page.locator('#nav [data-t="leute"]').click();
    const d = page.locator('#app .poster details', { hasText: 'Als App auf den Startbildschirm' });
    eq(await d.count(), 1, 'Anleitungen beim QR-Code');
    await d.locator('summary').click();
    expect((await d.innerText()).includes('„Zum Home-Bildschirm“'), 'Text der Anleitung');
    await page.emulateMedia({ media: 'print' });
    try { expect(!(await d.isVisible()), 'Anleitung steht im gedruckten Aushang'); expect(!(await page.locator('#app .poster').innerText()).includes('Startbildschirm'), 'Text der Anleitung im Druck'); }
    finally { await page.emulateMedia({ media: 'screen' }); }
  });
  await S('Aufräumen: ausgeblendete Personen wieder einblenden; keine Fehler in der Browser-Konsole', async () => {
    if (hidden.length) await sql(`update persons set active = true where id in (${hidden.map(i => `'${i}'`).join(',')})`);
    const real = [...page.problems, ...kp.problems].filter(p => !/favicon/i.test(p));
    expect(real.length === 0, real.join(' · '));
  });
  await kp.context().close();
  await page.context().close();
};
