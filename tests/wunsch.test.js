'use strict';
/* Wunsch abgeben (Ausbaustufe 4): Kollegen geben Wünsche ab, gleiche werden zusammengezählt, der Verwalter sieht sie ohne Namen. */
const { CFG, step, setGroup, expect, eq, newPage, toast, hideToast, idle, fillModal, see, anonApi } = require('./lib');

module.exports = async function wunsch(browser) {
  setGroup('Wunsch');
  const page = await newPage(browser);     // Verwalter
  const kp = await newPage(browser);       // Kollegin Mila
  const S = (n, f) => step(n, f, page), K = (n, f) => step(n, f, kp);
  const tab = async t => { await idle(page); await page.locator(`#nav [data-t="${t}"]`).click(); await page.locator(`#nav [data-t="${t}"].on`).waitFor(); };
  const db = (table, select, filterCol, filterVal) => page.evaluate(async ([t, s, c, v]) => {
    let q = SB.from(t).select(s); if (c !== undefined && c !== null) q = q.eq(c, v);
    const { data, error } = await q; if (error) throw new Error(error.message); return data;
  }, [table, select, filterCol, filterVal]);
  const rpc = (fn, args) => page.evaluate(async ([f, a]) => { const { data, error } = await SB.rpc(f, a); return error ? { error: error.message } : { data }; }, [fn, args]);
  /* offene Wünsche mit Stimmenzahl aus der Datenbank */
  const open = async () => (await db('wishes', 'id,text,wish_votes(count)', 'done', false)).map(w => [w.text, (w.wish_votes[0] || {}).count || 0]);
  const find = async t => (await open()).filter(w => w[0] === t).map(w => w[1]);
  const regalWishes = async () => {
    await page.reload(); await page.locator('#nav:not([hidden])').waitFor(); await tab('regal');
    const paper = page.locator('#app .paper', { hasText: 'Wünsche der Kollegen' });
    return paper.locator('.it').evaluateAll(rs => rs.map(r => r.children[1].textContent + ' ' + r.children[2].textContent));
  };
  let code = null, api = null; const tok = {};
  const wish = async (who, text) => { const r = await api.post('/rest/v1/rpc/k_wish', { data: { p_token: tok[who], p_text: text } }); expect(r.status() < 300, `k_wish Status ${r.status()}`); };
  const kWish = async text => {
    await idle(kp); await hideToast(kp);
    await kp.locator('[data-a="k-wish"]').click();
    await fillModal(kp, 'Wunsch abgeben', { t: text });
  };

  await S('Vorbereitung: Verwalter anmelden, alte Wünsche abräumen, Mila, Nico und Olga anlegen und anmelden', async () => {
    await page.goto(CFG.url + '#verwaltung');
    await page.locator('#alog').waitFor();
    await page.fill('#em', CFG.email); await page.fill('#pw', CFG.pw);
    await page.locator('#alog button.pri').click();
    await see(page, 'KASSENSTAND');
    code = (await db('settings', 'value', 'key', 'kiosk_code'))[0].value;
    await page.evaluate(async nil => { const { error } = await SB.from('wishes').delete().neq('id', nil); if (error) throw new Error(error.message); }, '00000000-0000-0000-0000-000000000000');
    api = await anonApi();
    for (const [n, p] of [['Mila', '7171'], ['Nico', '7272'], ['Olga', '7373']]) {
      const r = await rpc('a_person', { p_vorname: n, p_pin: p }); expect(!r.error, `a_person ${n}: ${r.error}`);
      const l = await (await api.post('/rest/v1/rpc/k_login', { data: { p_code: code, p_person: r.data, p_pin: p } })).json();
      expect(l.ok, `Anmeldung ${n}: ` + JSON.stringify(l)); tok[n] = l.token;
    }
  });
  await K('Kollegin: Abschnitt „Wunsch“ mit Knopf, Dialog lässt höchstens 60 Zeichen zu', async () => {
    expect(code, 'Vorbereitung fehlgeschlagen');
    await kp.goto(`${CFG.url}?k=${code}`);
    await kp.locator('.namegrid button', { hasText: /^Mila$/ }).click();
    await kp.fill('#pin', '7171');
    await kp.locator('#kpin button.pri').click();
    await kp.locator('[data-a="k-consent"]').click();
    await see(kp, 'Schuldschein von Mila');
    await see(kp, 'Dein Wunsch geht ohne Namen an den Betreiber.');
    await kp.locator('[data-a="k-wish"]').click();
    eq(await kp.locator('#modal #f_t').getAttribute('maxlength'), '60', 'Zeichenbegrenzung im Feld');
    await kp.locator('#modal #f_t').fill('x'.repeat(80));
    eq((await kp.locator('#modal #f_t').inputValue()).length, 60, 'Länge nach Eingabe von 80 Zeichen');
    await kp.locator('#modal [data-a="m-x"]').click();
  });
  await K('Kollegin: leerer und zu kurzer Wunsch werden nicht gespeichert', async () => {
    await kWish('   '); await idle(kp);
    await kWish('a'); await idle(kp);
    eq((await open()).length, 0, 'offene Wünsche');
  });
  await K('Kollegin: Wunsch abgeben – Dank, aber keine Wunschliste für Kollegen', async () => {
    await kWish('Club Mate');
    await toast(kp, /^Danke, dein Wunsch ist angekommen\.$/);
    eq(JSON.stringify(await open()), '[["Club Mate",1]]', 'offene Wünsche');
    await kp.reload(); await see(kp, 'Schuldschein von Mila');
    expect(!(await kp.locator('#app').innerText()).includes('Club Mate'), 'Kollegin sieht die Wunschliste');
    const st = await kp.evaluate(async () => (await SB.rpc('k_state', { p_token: K.token })).data);
    expect(!('wishes' in st), 'k_state liefert Wünsche an Kollegen');
  });
  await K('Gleicher Wunsch derselben Person (andere Schreibweise, mehrere Leerzeichen) zählt nur einmal', async () => {
    await kWish('  club    MATE ');
    await toast(kp, /Danke/);
    eq(JSON.stringify(await open()), '[["Club Mate",1]]', 'offene Wünsche');
  });
  await S('Gleicher Wunsch einer anderen Person wird als weitere Stimme gezählt, nicht doppelt angelegt', async () => {
    await wish('Nico', 'CLUB mate');
    await wish('Nico', 'Eistee');
    await wish('Olga', 'club mate');
    await wish('Olga', 'Club  Mate');
    eq(JSON.stringify((await open()).sort()), '[["Club Mate",3],["Eistee",1]]', 'offene Wünsche');
  });
  await S('Grenzen: 1 Zeichen und 61 Zeichen werden ignoriert, 60 Zeichen und 2 Zeichen gehen; ohne gültige Sitzung nichts', async () => {
    const n = (await open()).length;
    await wish('Nico', 'x'); await wish('Nico', 'L'.repeat(61)); await wish('Nico', '        ');
    const r = await api.post('/rest/v1/rpc/k_wish', { data: { p_token: 'erfunden', p_text: 'Fremder Wunsch' } }); expect(r.status() < 300, 'Status ' + r.status());
    eq((await open()).length, n, 'offene Wünsche nach ungültigen Versuchen');
    expect(!(await open()).some(w => /Eindringling|Fremder/.test(w[0])), 'Wunsch ohne gültige Sitzung wurde angelegt');
    await wish('Nico', 'S'.repeat(60)); await wish('Nico', 'OK');
    eq(JSON.stringify(await find('S'.repeat(60))), '[1]', 'Wunsch mit 60 Zeichen'); eq(JSON.stringify(await find('OK')), '[1]', 'Wunsch mit 2 Zeichen');
  });
  await S('Verwalter, Regal: „Wünsche der Kollegen“ nach Stimmen sortiert mit „n×“, ohne Namen', async () => {
    await wish('Olga', 'Eistee');
    const rows = await regalWishes();
    eq(rows.slice(0, 2).join(' | '), 'Club Mate 3× | Eistee 2×', 'erste Zeilen');
    eq(rows.length, 4, 'Anzahl Zeilen');
    const txt = await page.locator('#app .paper', { hasText: 'Wünsche der Kollegen' }).innerText();
    expect(!/Mila|Nico|Olga/.test(txt), 'Namen in der Wunschliste');
    await see(page, 'Gleiche Wünsche werden zusammengezählt. Namen werden nicht angezeigt.');
  });
  await S('Wunschtext wird als Text angezeigt, nicht als Seiteninhalt ausgeführt', async () => {
    await wish('Nico', '<img src=x onerror="window.__x=1"><b>fett</b>');
    const rows = await regalWishes();
    expect(rows.some(r => r.startsWith('<img src=x onerror="window.__x=1"><b>fett</b> 1×')), 'Text nicht wörtlich angezeigt: ' + rows.join(' | '));
    const paper = page.locator('#app .paper', { hasText: 'Wünsche der Kollegen' });
    eq(await paper.locator('img, b').count(), 0, 'eingeschleuste Elemente');
    expect(await page.evaluate(() => window.__x) === undefined, 'eingeschleuster Code wurde ausgeführt');
  });
  await S('„Erledigt“ entfernt den Wunsch; derselbe Wunsch kann danach neu abgegeben werden', async () => {
    const paper = page.locator('#app .paper', { hasText: 'Wünsche der Kollegen' });
    await paper.locator('.it', { hasText: 'Club Mate' }).locator('[data-a="a-wish"]').click();
    await page.waitForFunction(() => ![...document.querySelectorAll('#app .it')].some(e => e.textContent.includes('Club Mate')));
    await idle(page);
    eq((await find('Club Mate')).length, 0, 'offene „Club Mate“-Wünsche');
    eq((await db('wishes', 'done', 'text', 'Club Mate'))[0].done, true, 'Wunsch als erledigt gespeichert');
    await wish('Olga', 'club mate');
    eq(JSON.stringify((await open()).filter(w => w[0].toLowerCase() === 'club mate')), '[["club mate",1]]', 'neu abgegebener Wunsch');
  });
  await S('Höchstens 60 offene Wünsche: der 61. neue wird ignoriert, eine Stimme für einen vorhandenen zählt weiter', async () => {
    const n = (await open()).length;
    for (let i = n; i < 60; i++) await wish('Nico', 'Füllwunsch ' + String(i).padStart(2, '0'));
    eq((await open()).length, 60, 'offene Wünsche');
    await wish('Nico', 'Einer zu viel');
    eq((await open()).length, 60, 'offene Wünsche nach dem 61.');
    eq((await find('Einer zu viel')).length, 0, '61. Wunsch');
    await wish('Mila', 'eistee');
    eq(JSON.stringify(await find('Eistee')), '[3]', 'Stimmen für „Eistee“ bei voller Liste');
    const rows = await regalWishes();
    eq(rows.length, 60, 'Zeilen beim Verwalter'); eq(rows[0], 'Eistee 3×', 'erste Zeile');
  });
  await S('Aufräumen: Füllwünsche erledigen; keine Fehler in der Browser-Konsole', async () => {
    await page.evaluate(async () => { const { error } = await SB.from('wishes').update({ done: true }).eq('done', false); if (error) throw new Error(error.message); });
    for (const t of Object.values(tok)) await api.post('/rest/v1/rpc/k_logout', { data: { p_token: t } });
    await api.dispose();
    const rows = await regalWishes();
    eq(rows.length, 0, 'Zeilen beim Verwalter'); await see(page, 'Noch keine Wünsche.');
    const real = [...page.problems, ...kp.problems].filter(p => !/favicon/i.test(p));
    expect(real.length === 0, real.join(' · '));
  });
  await kp.context().close();
  await page.context().close();
};
