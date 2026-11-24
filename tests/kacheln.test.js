'use strict';
/* Kollegen-Ansicht „Kacheln“ (ab app.js v30, icons.js): Umschalter Liste/Kacheln, gezeichnete Produktbilder, Anschreiben aus beiden Ansichten. */
const { CFG, step, setGroup, expect, eq, newPage, toast, hideToast, idle, pickName, loggedOut, anzahl, zusammen, see, lnIs } = require('./lib');

const FORM = { can: '<rect x="30" y="18"', bottle: 'M44 12h12', bar: 'rotate(-14', choc: 'M24 30h52', waffle: '#d8b27a', bag: 'M26 16h48', cup: 'M22 32h56' };
/* Namen, wie sie im Kiosk vorkommen können, und die erwartete Form (Stichwort nur am Wortanfang). */
const ERWARTET = [
  ['Corny Big Chocolate Banane', 'Süßes', 'bar'], ['Coca-Cola', 'Getränke', 'can'], ['Coca-Cola Zero', 'Getränke', 'can'], ['Cola Light', 'Getränke', 'can'],
  ['Vita Cola', 'Getränke', 'can'], ['Red Bull', 'Energy', 'can'], ['Monster Energy Zero Ultra', 'Energy', 'can'], ['Lipton Ice Tea Zero', 'Getränke', 'can'],
  ['Spezi', 'Getränke', 'bottle'], ['Protein Shake Vanille', 'Getränke', 'bottle'], ['Proteinriegel Schoko', 'Süßes', 'bar'], ['Twix', 'Süßes', 'bar'],
  ['Snickers', 'Süßes', 'bar'], ['Mars', 'Süßes', 'bar'], ['Knoppers', 'Süßes', 'waffle'], ['Knoppers Himbeer', 'Süßes', 'waffle'],
  ['Kinder Bueno', 'Süßes', 'choc'], ['Choceur Vollmilch', 'Süßes', 'choc'], ['Haribo Goldbären', 'Süßes', 'bag'], ["M&M's Peanut", 'Süßes', 'bag'],
  ['ÜLTJE Erdnüsse', 'Herzhaft', 'bag'], ['Beef Jerky', 'Herzhaft', 'bag'], ['Nudelsuppe Huhn', 'Herzhaft', 'cup'], ['Instant-Nudeln', 'Herzhaft', 'cup'],
  ['Schokocola-Drops', 'Süßes', 'bar'], ['Colanüsse', 'Herzhaft', 'bag']
];
/* Nur zur Beobachtung (Form passt evtl. nicht, ist aber kein Fehler im Sinne der Vorgabe). */
const BEOBACHTEN = [['Monster Munch', 'Herzhaft'], ['Mineralwasser still', 'Getränke'], ['Wasser', 'Getränke'], ['Apfelsaftschorle', 'Getränke'], ['Kinder Pingui', 'Süßes'], ['Marshmallows', 'Süßes'], ['Erdnüsse', 'Herzhaft']];

module.exports = async function kacheln(browser) {
  setGroup('Kacheln');
  const page = await newPage(browser);                         // Verwalter
  const kp = await newPage(browser, { hasTouch: true });        // Handy der Kollegin
  const S = (n, f) => step(n, f, page), K = (n, f) => step(n, f, kp);
  const fremd = [];
  kp.on('request', r => { const h = new URL(r.url()).hostname; if (!['127.0.0.1', 'localhost', `${CFG.ref}.supabase.co`].includes(h) && !r.url().startsWith('data:')) fremd.push(r.url()); });
  const db = (table, select, filterCol, filterVal) => page.evaluate(async ([t, s, c, v]) => {
    let q = SB.from(t).select(s); if (c) q = q.eq(c, v);
    const { data, error } = await q; if (error) throw new Error(error.message); return data;
  }, [table, select, filterCol, filterVal]);
  const rpc = (fn, args) => page.evaluate(async ([f, a]) => { const { data, error } = await SB.rpc(f, a); return error ? { error: error.message } : { data }; }, [fn, args]);
  const must = async (fn, args) => { const r = await rpc(fn, args); expect(!r.error, `${fn}: ${r.error}`); return r.data; };
  const LANG = 'Corny Big Chocolate Banane mit extra langem Namen zum Testen';
  const HTML = '<img src=x onerror="window.__x=1">Keks';
  let code = null;
  const view = () => kp.evaluate(() => ({ ls: localStorage.getItem('kview'), on: (document.querySelector('.viewsw .on') || {}).textContent, tiles: document.querySelectorAll('.tile').length, liste: document.querySelectorAll('#app button.it[data-a="k-buy"]').length }));
  const umschalten = async v => { await idle(kp); await kp.locator(`.viewsw [data-v="${v}"]`).click(); await kp.locator(`.viewsw [data-v="${v}"].on`).waitFor(); };
  const login = async () => {
    await kp.goto(`${CFG.url}?k=${code}`);
    await pickName(kp, 'Kira');
    await kp.fill('#pin', '7878'); await kp.locator('#kpin button.pri').click();
    await kp.waitForFunction(() => /Kurz vorab|Schuldschein von/.test(document.querySelector('#app').textContent));
    if (await kp.locator('[data-a="k-consent"]').count()) await kp.locator('[data-a="k-consent"]').click();
    await see(kp, 'Schuldschein von Kira');
  };
  const kachel = name => kp.locator('.tile', { has: kp.locator('.tn', { hasText: name }) }).first();

  await S('Vorbereitung: anmelden, Testprodukte (Kachel-Gruppe, langer Name, HTML im Namen, Abverkauf, leer) und Kira anlegen', async () => {
    await page.goto(CFG.url + '#verwaltung');
    await page.locator('#alog').waitFor();
    await page.fill('#em', CFG.email); await page.fill('#pw', CFG.pw);
    await page.locator('#alog button.pri').click();
    await see(page, 'KASSENSTAND');
    code = (await db('settings', 'value', 'key', 'kiosk_code'))[0].value;
    await page.evaluate(async ([lang, html]) => {
      const { error } = await SB.from('products').insert([
        { name: 'K-Coca-Cola', category: 'Kacheltest', price_cents: 150, stock: 9 },
        { name: lang, category: 'Kacheltest', price_cents: 120, stock: 4 },
        { name: html, category: 'Kacheltest', price_cents: 90, stock: 3 },
        { name: 'K-Twix', category: 'Kacheltest', price_cents: 100, sale_cents: 60, stock: 5 },
        { name: 'K-Leer', category: 'Kacheltest', price_cents: 100, stock: 0 },
        { name: 'K-Haribo', category: 'Kacheltest 2', price_cents: 130, stock: 2 }]);
      if (error) throw new Error(error.message);
    }, [LANG, HTML]);
    await must('a_person', { p_vorname: 'Kira', p_pin: '7878' });
  });
  await K('Erster Aufruf: Ansicht „Liste“ ist eingestellt, Umschalter Liste/Kacheln vorhanden', async () => {
    await login();
    const v = await view();
    eq(`${v.ls}/${v.on}`, 'null/Liste', 'gemerkte Ansicht / markierter Knopf');
    expect(v.tiles === 0 && v.liste > 0, 'Anzeige: ' + JSON.stringify(v));
    eq((await kp.locator('.viewsw button').evaluateAll(bs => bs.map(b => `${b.textContent}:${b.getAttribute('aria-pressed')}`))).join(' '), 'Liste:true Kacheln:false', 'Umschalter');
  });
  await K('Umschalten auf Kacheln: wird gemerkt, Kacheln nach Gruppen, nur Produkte mit Bestand', async () => {
    await umschalten('kacheln');
    const v = await view();
    eq(`${v.ls}/${v.on}`, 'kacheln/Kacheln', 'gemerkte Ansicht / markierter Knopf');
    eq(v.liste, 0, 'Listenzeilen in der Kachel-Ansicht');
    const g = await kp.evaluate(() => [...document.querySelectorAll('#app h2')].filter(h => h.textContent.startsWith('Kacheltest')).map(h => h.textContent + ':' + [...h.nextElementSibling.querySelectorAll('.tn')].map(t => t.textContent).join('|')));
    const norm = x => x.map(e => { const [h, t] = e.split(':'); return h + ':' + t.split('|').sort().join('|'); }).join(' ; ');
    eq(norm(g), norm([`Kacheltest:K-Coca-Cola|${LANG}|${HTML}|K-Twix`, 'Kacheltest 2:K-Haribo']), 'Gruppen und Kacheln');
    eq(await kachel('K-Leer').count(), 0, 'Kachel für leeres Produkt');
  });
  await K('Kachel zeigt Bild, Name, Preis und Stückzahl; Abverkauf durchgestrichen und rot', async () => {
    const k = await kachel('K-Coca-Cola').evaluate(t => ({ svg: !!t.querySelector('svg'), tp: t.querySelector('.tp').textContent.trim(), ts: t.querySelector('.ts').textContent.trim() }));
    eq(JSON.stringify(k), JSON.stringify({ svg: true, tp: '1,50 €', ts: '9 St' }), 'Kachel K-Coca-Cola');
    const s = await kachel('K-Twix').evaluate(t => { const b = t.querySelector('.tp b'); const [r, g] = getComputedStyle(b).color.match(/\d+/g).map(Number);
      return { s: (t.querySelector('.tp s') || {}).textContent, b: b.textContent.trim(), rot: r > g + 40 }; });
    eq(JSON.stringify(s), JSON.stringify({ s: '1,00', b: '0,60 €', rot: true }), 'Kachel K-Twix (Abverkauf)');
  });
  await K('Langer Name höchstens 2 Zeilen; HTML im Namen wird als Text gezeigt und nicht ausgeführt', async () => {
    const h = await kachel('Corny Big Chocolate').locator('.tn').evaluate(e => ({ h: e.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(e).lineHeight) || parseFloat(getComputedStyle(e).fontSize) * 1.15 }));
    expect(h.h <= h.lh * 2 + 1, `Name ist ${Math.round(h.h)} px hoch, erlaubt ${Math.round(h.lh * 2)} px`);
    eq(await kp.locator('#app img').count(), 0, 'eingeschleuste Bilder');
    expect(await kp.evaluate(() => window.__x) === undefined, 'eingeschleuster Code wurde ausgeführt');
    eq(await kachel('Keks').locator('.tn').innerText(), HTML, 'angezeigter Name');
  });
  for (const [w, h, cols] of [[390, 844, 3], [320, 568, 2]]) {
    await K(`Bei ${w} px: ${cols} Spalten, alle Kacheln gleich hoch, nichts ragt heraus, Tippfläche groß genug`, async () => {
      await kp.setViewportSize({ width: w, height: h }); await kp.waitForTimeout(200);
      const m = await kp.evaluate(() => {
        const grid = [...document.querySelectorAll('.tiles')].sort((a, b) => b.children.length - a.children.length)[0], tiles = [...grid.querySelectorAll('.tile')], paper = grid.closest('.paper').getBoundingClientRect();
        const tops = [...new Set(tiles.map(t => Math.round(t.getBoundingClientRect().top)))];
        const all = [...document.querySelectorAll('.tile')];
        const hs = [...new Set(tiles.map(t => Math.round(t.getBoundingClientRect().height)))];   // innerhalb einer Gruppe
        const hsAlle = [...new Set(all.map(t => Math.round(t.getBoundingClientRect().height)))];
        const out = all.filter(t => { const r = t.getBoundingClientRect(); return r.left < paper.left - 0.5 || r.right > paper.right + 0.5; }).length;
        const inner = all.filter(t => [...t.children].some(c => { const a = c.getBoundingClientRect(), b = t.getBoundingClientRect(); return a.right > b.right + 1 || a.left < b.left - 1 || a.bottom > b.bottom + 1; })).length;
        return { hsAlle, proReihe: tiles.filter(t => Math.round(t.getBoundingClientRect().top) === tops[0]).length, hs, out, inner,
          minW: Math.min(...all.map(t => t.getBoundingClientRect().width)), scroll: document.documentElement.scrollWidth - innerWidth };
      });
      await kp.setViewportSize({ width: 390, height: 844 });
      eq(m.proReihe, cols, 'Kacheln pro Reihe'); eq(m.hs.length, 1, `verschiedene Kachelhöhen innerhalb einer Gruppe (${m.hs.join(', ')} px)`);
      if (m.hsAlle.length > 1) console.log(`      Beobachtung ${w} px: Kachelhöhen über alle Gruppen ${m.hsAlle.join(', ')} px`);
      eq(m.out, 0, 'Kacheln über den Rand'); eq(m.inner, 0, 'Kacheln, deren Inhalt herausragt'); expect(m.minW >= 44, 'schmalste Kachel ' + Math.round(m.minW) + ' px');
      expect(m.scroll <= 0, `Seite lässt sich ${m.scroll} px seitlich schieben`);
    });
  }
  await K('Ansicht bleibt nach Neuladen und nach Ab- und Wiederanmelden', async () => {
    await kp.reload(); await see(kp, 'Schuldschein von Kira');
    eq((await view()).on, 'Kacheln', 'Ansicht nach Neuladen');
    await idle(kp); await kp.locator('[data-a="k-logout"]').click();
    await loggedOut(kp);
    await login();
    eq((await view()).on, 'Kacheln', 'Ansicht nach Ab- und Anmelden');
  });
  await K('Anschreiben aus der Kachel: Anzahl-Dialog, Abbrechen bucht nichts, 3 Stück buchen, Bestand sinkt', async () => {
    await kachel('K-Coca-Cola').click();
    await see(kp, 'Wie viele? Je 1,50 €', '#modal');
    await anzahl(kp, 'K-Coca-Cola', 1, false);
    await lnIs(kp, 'OFFEN', '0,00 €');
    await hideToast(kp);
    await kachel('K-Coca-Cola').click();
    await kp.locator('#modal [data-q="3"]').click();
    await zusammen(kp, '4,50 €');
    await kp.locator('#modal [data-q="ok"]').click();
    await toast(kp, /K-Coca-Cola angeschrieben/);
    await idle(kp);
    await lnIs(kp, 'OFFEN', '4,50 €');
    eq((await kachel('K-Coca-Cola').locator('.ts').innerText()).trim(), '6 St', 'Stückzahl auf der Kachel');
    eq((await view()).on, 'Kacheln', 'Ansicht nach dem Anschreiben');
  });
  await K('Abverkauf aus der Kachel: gebucht wird der Abverkaufspreis', async () => {
    await hideToast(kp);
    await kachel('K-Twix').click();
    await see(kp, 'Je 0,60 €', '#modal');
    await anzahl(kp, 'K-Twix', 2);
    await toast(kp, /K-Twix angeschrieben/); await idle(kp);
    await lnIs(kp, 'OFFEN', '5,70 €');
  });
  await K('Letztes Stück aus der Kachel: Kachel verschwindet; Rückgängig bringt sie zurück', async () => {
    await hideToast(kp);
    await kachel('K-Haribo').click(); await anzahl(kp, 'K-Haribo', 2);
    await toast(kp, /K-Haribo angeschrieben/); await idle(kp);
    eq(await kachel('K-Haribo').count(), 0, 'Kachel K-Haribo nach dem letzten Stück');
    expect(!(await kp.locator('#app h2', { hasText: 'Kacheltest 2' }).count()), 'leere Gruppe steht noch da');
    await hideToast(kp); await kp.locator('[data-a="k-undo"]').first().click(); await toast(kp, /Buchung zurückgenommen/); await idle(kp);
    eq(await kachel('K-Haribo').count(), 1, 'Kachel K-Haribo nach Rückgängig');
  });
  await K('Zurück auf Liste: wird gemerkt, Anschreiben aus der Liste geht', async () => {
    await umschalten('liste');
    eq((await view()).ls, 'liste', 'gemerkte Ansicht');
    await hideToast(kp);
    await kp.locator('button.it', { hasText: 'K-Coca-Cola' }).click(); await anzahl(kp, 'K-Coca-Cola', 1);
    await toast(kp, /K-Coca-Cola angeschrieben/); await idle(kp);
    await lnIs(kp, 'OFFEN', '7,20 €');
    await kp.reload(); await see(kp, 'Schuldschein von Kira');
    eq((await view()).on, 'Liste', 'Ansicht nach Neuladen');
    await umschalten('kacheln');
  });
  await K('Tastatur: Kachel per Tab erreichbar, Enter öffnet den Anzahl-Dialog', async () => {
    const t = kachel('K-Coca-Cola');
    await t.focus();
    eq(await t.evaluate(e => e === document.activeElement && e.tagName), 'BUTTON', 'Kachel als Knopf im Fokus');
    await kp.keyboard.press('Enter');
    await kp.locator('#modal:not([hidden]) h2', { hasText: 'K-Coca-Cola' }).waitFor();
  });
  const perTaste = async () => {   // Dialog nur per Tastatur öffnen
    if (await kp.locator('#modal:not([hidden])').count()) await kp.locator('#modal [data-q="x"]').click();
    await idle(kp);
    await kachel('K-Coca-Cola').focus(); await kp.keyboard.press('Enter');
    await kp.locator('#modal:not([hidden]) h2', { hasText: 'K-Coca-Cola' }).waitFor();
  };
  await K('Tastatur: Beim Öffnen springt der Fokus in den Anzahl-Dialog', async () => {
    await perTaste();
    const r = await kp.evaluate(() => ({ inModal: !!document.activeElement.closest('#modal'), el: document.activeElement.className + ' ' + document.activeElement.textContent.trim().slice(0, 20) }));
    expect(r.inModal, 'Fokus bleibt hinter dem Dialog auf: ' + r.el);
  });
  await K('Tastatur: Mit Tab erreicht man die Knöpfe im Dialog, bevor man zu anderen Kacheln kommt', async () => {
    await perTaste();
    let erster = null;
    for (let i = 0; i < 3; i++) { await kp.keyboard.press('Tab'); const a = await kp.evaluate(() => (document.activeElement.closest('#modal') ? 'Dialog' : 'Seite') + ': ' + document.activeElement.textContent.trim().slice(0, 20)); if (!erster) erster = a; }
    expect(erster.startsWith('Dialog'), 'Erstes Ziel der Tab-Taste: ' + erster);
  });
  await K('Tastatur: Escape schließt den Anzahl-Dialog, ohne zu buchen', async () => {
    await perTaste();
    const before = (await kachel('K-Coca-Cola').locator('.ts').innerText()).trim();
    await kp.keyboard.press('Escape');
    await kp.waitForTimeout(300);
    const offen = await kp.locator('#modal:not([hidden])').count();
    if (offen) await kp.locator('#modal [data-q="x"]').click();
    await idle(kp);
    eq((await kachel('K-Coca-Cola').locator('.ts').innerText()).trim(), before, 'Stückzahl');
    expect(!offen, 'Dialog bleibt nach Escape offen');
  });
  await K('Anzahl-Dialog am kleinen Handy (320 × 568): alle Knöpfe sichtbar, „Anschreiben“ nicht verdeckt', async () => {
    await kp.setViewportSize({ width: 320, height: 568 });
    try {
      await kachel('K-Coca-Cola').click();
      const m = await kp.evaluate(() => [...document.querySelectorAll('#modal [data-q]')].map(b => { const r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        return { q: b.dataset.q, sichtbar: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth, oben: document.elementFromPoint(x, y) === b, h: r.height, w: r.width }; }));
      const bad = m.filter(b => !b.sichtbar || !b.oben || b.h < 40 || b.w < 40);
      expect(bad.length === 0, 'Nicht bedienbar: ' + JSON.stringify(bad));
      await kp.locator('#modal [data-q="x"]').click();
    } finally { await kp.setViewportSize({ width: 390, height: 844 }); }
  });
  await K('Bilder: Form passt zum Produkt (Stichwort nur am Wortanfang, z. B. Corny … Chocolate ist keine Cola-Dose)', async () => {
    const r = await kp.evaluate(([list, F]) => list.map(([name, cat, want]) => {
      const svg = productIcon({ name, cat }); const got = Object.keys(F).find(k => svg.includes(F[k])) || '?';
      return { name, want, got };
    }), [ERWARTET, FORM]);
    const bad = r.filter(x => x.got !== x.want).map(x => `${x.name}: erwartet ${x.want}, gezeichnet ${x.got}`);
    expect(bad.length === 0, bad.join(' · '));
  });
  await K('Bilder: jedes Produkt im Testprojekt bekommt ein Bild ohne Text, Logo oder Verweis nach außen', async () => {
    const r = await kp.evaluate(() => [...document.querySelectorAll('.tile')].map(t => { const s = t.querySelector('svg');
      return { n: t.querySelector('.tn').textContent, ok: !!s && !s.querySelector('text,image,use,a,foreignObject') && !/href|url\(/.test(s.outerHTML) && s.getAttribute('aria-hidden') === 'true' }; }));
    const bad = r.filter(x => !x.ok).map(x => x.n);
    expect(r.length >= 5 && bad.length === 0, 'Ohne passendes Bild: ' + bad.join(', ') + ' (geprüft: ' + r.length + ')');
  });
  await K('Keine externen Ladevorgänge, keine Fehler in der Browser-Konsole', async () => {
    const real = [...page.problems, ...kp.problems].filter(p => !/favicon/i.test(p));
    expect(fremd.length === 0 && real.length === 0, [...fremd.map(u => 'extern: ' + u), ...real].join(' · '));
  });
  /* Nur zur Beobachtung: Formen bei Namen, die ein Stichwort treffen, aber etwas anderes sein könnten */
  await K('Beobachtung: Formen bei mehrdeutigen Namen (wird nur berichtet)', async () => {
    const r = await kp.evaluate(([list, F]) => list.map(([name, cat]) => { const svg = productIcon({ name, cat }); return name + ' → ' + (Object.keys(F).find(k => svg.includes(F[k])) || '?'); }), [BEOBACHTEN, FORM]);
    console.log('      Beobachtung Formen: ' + r.join(' | '));
  });
  await kp.context().close();
  await page.context().close();
};
