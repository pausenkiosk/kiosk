'use strict';
/* Francos Wünsche (ab app.js v23):
   1. Personenliste der Verwaltung: Schulden rot mit Minus, Guthaben grün, Knöpfe in eigener Zeile.
   2. Erste Seite: „Läuft als Nächstes ab“ – die drei nächsten Haltbarkeitsdaten, auch wenn es noch lange hin ist. */
const { CFG, step, setGroup, expect, eq, newPage, toast, hideToast, idle, fillModal, pickName, see, prow, anonApi, isoDay } = require('./lib');

module.exports = async function liste(browser) {
  setGroup('Personenliste und nächste Abläufe');
  const page = await newPage(browser);
  const S = (n, f) => step(n, f, page);
  const tab = async t => { await idle(page); await page.locator(`#nav [data-t="${t}"]`).click(); await page.locator(`#nav [data-t="${t}"].on`).waitFor(); };
  const db = (table, select, filterCol, filterVal) => page.evaluate(async ([t, s, c, v]) => {
    let q = SB.from(t).select(s); if (c) q = q.eq(c, v);
    const { data, error } = await q; if (error) throw new Error(error.message); return data;
  }, [table, select, filterCol, filterVal]);
  const rpc = (fn, args) => page.evaluate(async ([f, a]) => { const { data, error } = await SB.rpc(f, a); return error ? { error: error.message } : { data }; }, [fn, args]);
  const must = async (fn, args) => { const r = await rpc(fn, args); expect(!r.error, `${fn}: ${r.error}`); return r.data; };
  const reload = async () => { await page.reload(); await page.locator('#nav:not([hidden])').waitFor(); };
  const ids = {};
  /* Betragsfeld einer Person: Text, Klasse und Farbe (als „rot“/„grün“/„grau“) */
  const feld = async name => prow(page, name).locator('span').nth(1).evaluate(el => {
    const [r, g, b] = getComputedStyle(el).color.match(/\d+/g).map(Number);
    const farbe = r > g + 40 && r > b + 40 ? 'rot' : g > r + 25 && g > b + 15 ? 'grün' : 'grau';
    return { text: el.textContent.trim(), cls: el.className, farbe, fett: Number(getComputedStyle(el).fontWeight) >= 600 };
  });

  const feldReload = async name => { await reload(); await tab('leute'); return feld(name); };
  await S('Vorbereitung: anmelden; Quirin 4,50 Schulden, Qara 12,00 Guthaben, Quno 0,00, Quendolin-Maximilian 1.234,56 Guthaben', async () => {
    await page.goto(CFG.url + '#verwaltung');
    await page.locator('#alog').waitFor();
    await page.fill('#em', CFG.email); await page.fill('#pw', CFG.pw);
    await page.locator('#alog button.pri').click();
    await see(page, 'KASSENSTAND');
    for (const [n, p] of [['Quirin', '5151'], ['Qara', '5252'], ['Quno', '5353'], ['Quendolin-Maximilian', '5454']]) ids[n] = await must('a_person', { p_vorname: n, p_pin: p });
    await must('a_fix', { p_person: ids.Quirin, p_cents: 450 });
    await must('a_fix', { p_person: ids.Qara, p_cents: -1200 });
    await must('a_fix', { p_person: ids['Quendolin-Maximilian'], p_cents: -123456 });
    await reload(); await tab('leute');
  });
  await S('Schulden stehen rot mit Minus davor', async () => {
    const f = await feld('Quirin');
    eq(f.text, '−4,50', 'Anzeige bei Quirin'); eq(f.farbe, 'rot', 'Farbe bei Quirin');
  });
  await S('Guthaben steht grün, ohne Vorzeichen und ohne das Wort „Guthaben“', async () => {
    const f = await feld('Qara');
    eq(f.text, '12,00', 'Anzeige bei Qara'); eq(f.farbe, 'grün', 'Farbe bei Qara');
    const g = await feld('Quendolin-Maximilian');
    eq(g.text, '1.234,56', 'Anzeige bei großem Guthaben'); eq(g.farbe, 'grün', 'Farbe bei großem Guthaben');
  });
  await S('0,00 steht neutral (weder rot noch grün, kein Vorzeichen)', async () => {
    const f = await feld('Quno');
    eq(f.text, '0,00', 'Anzeige bei Quno'); eq(f.farbe, 'grau', 'Farbe bei Quno');
  });
  await S('Alle Personen der Liste: Farbe und Vorzeichen passen zum Saldo in der Datenbank', async () => {
    const saldi = {}; (await db('ledger', 'person_id,amount_cents')).forEach(l => { saldi[l.person_id] = (saldi[l.person_id] || 0) + l.amount_cents; });
    const persons = await db('persons', 'id,vorname');
    const rows = await page.locator('#app .paper').first().locator('.it').evaluateAll(rs => rs.map(r => {
      const el = r.children[2]; const [R, G, B] = getComputedStyle(el).color.match(/\d+/g).map(Number);
      return { name: r.children[1].textContent.trim(), text: el.textContent.trim(), farbe: R > G + 40 && R > B + 40 ? 'rot' : G > R + 25 && G > B + 15 ? 'grün' : 'grau' };
    }));
    eq(rows.length, persons.length, 'Zeilen in der Liste');
    const bad = [];
    for (const r of rows) {
      const s = saldi[persons.find(p => p.vorname === r.name).id] || 0;
      const want = (s > 0 ? '−' : '') + (Math.abs(s) / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const farbe = s > 0 ? 'rot' : s < 0 ? 'grün' : 'grau';
      if (r.text !== want || r.farbe !== farbe) bad.push(`${r.name}: erwartet ${farbe} „${want}“, tatsächlich ${r.farbe} „${r.text}“`);
    }
    expect(bad.length === 0, bad.join(' · '));
  });
  await S('Knöpfe stehen in eigener Zeile unter Name und Betrag; „Auszahlung“ nur bei Guthaben', async () => {
    for (const n of ['Quirin', 'Qara', 'Quno', 'Quendolin-Maximilian']) {
      const m = await prow(page, n).evaluate(r => {
        const b = r.children[2].getBoundingClientRect(), a = [...r.querySelectorAll('button')].map(x => x.getBoundingClientRect());
        return { below: a.every(x => x.top >= b.bottom - 1), labels: [...r.querySelectorAll('button')].map(x => x.textContent.trim()).join('|'), minH: Math.min(...a.map(x => x.height)) };
      });
      expect(m.below, `${n}: Knöpfe stehen nicht unter dem Betrag`);
      eq(m.labels, n === 'Qara' || n === 'Quendolin-Maximilian' ? 'Einzahlung|Auszahlung|…' : 'Einzahlung|…', `Knöpfe bei ${n}`);
    }
  });
  for (const w of [390, 320]) {
    await S(`Bei ${w} px Breite ragt nichts über den Rand, Name und Betrag stehen in einer Zeile`, async () => {
      await page.setViewportSize({ width: w, height: 844 });
      await page.waitForTimeout(150);
      const m = await page.evaluate(() => {
        const paper = document.querySelector('#app .paper').getBoundingClientRect(), out = [];
        document.querySelectorAll('#app .paper:first-child .it').forEach(r => {
          const name = r.children[1].textContent.trim();
          [...r.querySelectorAll('button'), r.children[1], r.children[2]].forEach(e => { const q = e.getBoundingClientRect(); if (q.right > paper.right + 0.5 || q.left < paper.left - 0.5) out.push(name + ' (' + e.textContent.trim().slice(0, 12) + ')'); });
          const a = r.children[1].getBoundingClientRect(), b = r.children[2].getBoundingClientRect();
          if (Math.abs(a.top - b.top) > 14 && a.height < 30) out.push(name + ' (Betrag nicht neben dem Namen)');
          if (b.height > 30) out.push(name + ' (Betrag bricht um)');
        });
        return { out, scroll: document.documentElement.scrollWidth - window.innerWidth };
      });
      await page.setViewportSize({ width: 390, height: 844 });
      expect(m.out.length === 0, 'Über den Rand oder verrutscht: ' + m.out.join(', '));
      expect(m.scroll <= 0, `Seite lässt sich ${m.scroll} px seitlich schieben`);
    });
  }
  await S('Reihenfolge der Liste: höchste Schulden zuerst, höchstes Guthaben zuletzt', async () => {
    const vals = await page.locator('#app .paper').first().locator('.it').evaluateAll(rs => rs.map(r => { const t = r.children[2]; const n = Number(t.textContent.replace('−', '').replace(/\./g, '').replace(',', '.')); return t.className.includes('pos') ? -n : n; }));
    expect(vals.every((v, i) => i === 0 || vals[i - 1] >= v), 'Reihenfolge der Salden: ' + vals.join(', '));
  });
  /* ---------- eigene Seite des Kollegen (ab v24) ---------- */
  const kp = await newPage(browser);
  const K = (n, f) => step(n, f, kp);
  let code = null;
  const kLogin = async (name, pin) => {
    if (!code) code = (await db('settings', 'value', 'key', 'kiosk_code'))[0].value;
    await kp.goto(`${CFG.url}?k=${code}`);
    await kp.evaluate(() => { localStorage.removeItem('ktoken'); localStorage.removeItem('kfav'); });
    await kp.goto(`${CFG.url}?k=${code}`);
    await pickName(kp, name);
    await kp.fill('#pin', pin); await kp.locator('#kpin button.pri').click();
    await kp.waitForFunction(() => /Kurz vorab|Schuldschein von/.test(document.querySelector('#app').textContent));
    if (await kp.locator('[data-a="k-consent"]').count()) await kp.locator('[data-a="k-consent"]').click();
    await see(kp, 'Schuldschein von ' + name);
  };
  const kFeld = () => kp.locator('#app .ln.big').first().evaluate(l => {
    const v = l.children[1], inner = v.querySelector('span') || v;
    const [r, g, b] = getComputedStyle(inner).color.match(/\d+/g).map(Number);
    const [br, bg, bb] = getComputedStyle(l.children[0]).color.match(/\d+/g).map(Number);
    return { label: l.children[0].textContent.replace(/\s*i$/, '').trim(), text: v.textContent.trim(),
      farbe: r > g + 40 && r > b + 40 ? 'rot' : g > r + 25 && g > b + 15 ? 'grün' : (r === br && g === bg && b === bb ? 'neutral' : 'andere') };
  });
  await K('Kollege mit Schulden sieht „OFFEN“ rot mit Minus davor', async () => {
    await kLogin('Quirin', '5151');
    eq(JSON.stringify(await kFeld()), JSON.stringify({ label: 'OFFEN', text: '−4,50 €', farbe: 'rot' }), 'Anzeige');
  });
  await K('Kollegin mit Guthaben sieht „DEIN GUTHABEN“ grün ohne Vorzeichen', async () => {
    await kLogin('Qara', '5252');
    eq(JSON.stringify(await kFeld()), JSON.stringify({ label: 'DEIN GUTHABEN', text: '12,00 €', farbe: 'grün' }), 'Anzeige');
  });
  await K('Wechsel vom Guthaben ins Minus durch einen Kauf: Anzeige springt auf „OFFEN“, rot, mit Minus', async () => {
    const p = (await kp.evaluate(async () => (await SB.rpc('k_state', { p_token: K.token })).data.products.filter(x => x.cents >= 100 && x.stock >= 10)))[0];
    const stueck = Math.floor(1200 / p.cents) + 1;                     // so viele, dass das Guthaben von 12,00 gerade überschritten ist
    let rest = stueck;
    while (rest > 0) { const q = Math.min(5, rest); await idle(kp); await hideToast(kp);
      await kp.locator('button.it', { hasText: p.name }).first().click(); await fillModal(kp, p.name, { qty: q }); await toast(kp, /angeschrieben/); rest -= q; }
    await idle(kp);
    const offen = stueck * p.cents - 1200;
    eq(JSON.stringify(await kFeld()), JSON.stringify({ label: 'OFFEN', text: '−' + (offen / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }) + ' €', farbe: 'rot' }), `Anzeige nach ${stueck} × ${p.name}`);
    const f = await feldReload('Qara');
    eq(`${f.text}/${f.farbe}`, '−' + (offen / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }) + '/rot', 'Anzeige in der Verwalter-Liste');
  });
  await K('Genau 0,00: „OFFEN 0,00 €“ ohne Farbe und ohne Minus; Kiosk-Ansicht sonst unverändert', async () => {
    await kLogin('Quno', '5353');
    eq(JSON.stringify(await kFeld()), JSON.stringify({ label: 'OFFEN', text: '0,00 €', farbe: 'neutral' }), 'Anzeige');
    await see(kp, 'Bezahlen oder Guthaben aufladen');
    const real = kp.problems.filter(x => !/favicon/i.test(x));
    expect(real.length === 0, real.join(' · '));
    await kp.context().close();
  });
  await S('Nach einer Einzahlung über den offenen Betrag hinaus wechselt die Anzeige von rot/Minus auf grün', async () => {
    await hideToast(page);
    await prow(page, 'Quirin').locator('[data-a="a-pay"]').click();
    await fillModal(page, 'Einzahlung von Quirin', { c: '10' });
    await toast(page, /Quirin hat jetzt 5,50 € Guthaben/);
    await idle(page);
    const f = await feld('Quirin');
    eq(`${f.text}/${f.farbe}`, '5,50/grün', 'Anzeige bei Quirin');
    eq(await prow(page, 'Quirin').locator('[data-a="a-payout"]').count(), 1, 'Auszahlungs-Knopf bei Quirin');
  });
  await S('Erklärung zur Liste nennt die Farben; Schnelltaste auf der ersten Seite heißt „Einzahlung“', async () => {
    await page.locator('#app .ii[data-k="schuldscheine"]').click();
    await see(page, 'Rot mit Minus: Schulden. Grün: Guthaben.', '#modal');
    await page.locator('#modal button', { hasText: 'OK' }).click();
    await tab('bon');
    eq((await page.locator('#app [data-a="a-go"]').allInnerTexts()).join('|'), 'Zählen|Einkauf|Einzahlung', 'Schnelltasten');
  });

  /* ---------- Läuft als Nächstes ab ---------- */
  let prod = [];
  const setMhd = async list => {   // list: [[Produktname, Tage ab heute, Stück, erledigt?]]
    await page.evaluate(async ([items, pr]) => {
      let r = await SB.from('purchase_items').delete().is('purchase_id', null); if (r.error) throw new Error(r.error.message);
      r = await SB.from('purchase_items').update({ mhd_done: true }).eq('mhd_done', false).not('mhd', 'is', null); if (r.error) throw new Error(r.error.message);
      if (items.length) { r = await SB.from('purchase_items').insert(items.map(i => ({ purchase_id: null, product_id: pr[i[0]], qty: i[2], cents: 0, mhd: i[1], mhd_done: !!i[3] }))); if (r.error) throw new Error(r.error.message); }
    }, [list.map(i => [i[0], isoDay(i[1]), i[2], i[3]]), Object.fromEntries(prod.map(p => [p.name, p.id]))]);
    await reload();
    await see(page, 'KASSENSTAND');
  };
  const sektion = () => page.evaluate(() => {
    const h = [...document.querySelectorAll('#app h2')].find(x => x.textContent.includes('Läuft als Nächstes ab'));
    if (!h) return null;
    const rows = []; let e = h.nextElementSibling;
    while (e && e.classList.contains('it')) { rows.push({ lamp: e.querySelector('i').className.replace('lamp ', ''), text: [...e.children].slice(1).map(c => c.textContent.trim()).join('|') }); e = e.nextElementSibling; }
    const hs = [...document.querySelectorAll('#app .paper:first-child h2')].map(x => x.textContent.replace(/\s*i$/, '').trim());
    return { rows, vorher: hs[hs.findIndex(x => x.startsWith('Läuft als Nächstes ab')) - 1] || '' };
  });
  const datum = n => page.evaluate(d => { const [y, m, t] = d.split('-').map(Number); return new Date(y, m - 1, t).toLocaleDateString('de-DE'); }, isoDay(n));
  await S('Ohne Haltbarkeitsdaten gibt es den Abschnitt nicht', async () => {
    prod = (await db('products', 'id,name')).sort((a, b) => a.name < b.name ? -1 : 1);
    expect(prod.length >= 3, 'zu wenige Produkte');
    await setMhd([]);
    eq(await sektion(), null, 'Abschnitt „Läuft als Nächstes ab“');
  });
  await S('Nur abgelaufene Ware: kein Abschnitt, das Abgelaufene steht weiter in Rot', async () => {
    await setMhd([[prod[0].name, -2, 4]]);
    eq(await sektion(), null, 'Abschnitt „Läuft als Nächstes ab“');
    await see(page, 'Läuft in 14 Tagen ab (1)');
    await see(page, 'abgelaufen');
  });
  await S('Ein Eintrag, noch lange hin (400 Tage): wird mit vollem Datum gezeigt, grün, direkt unter „Nachbestellen“', async () => {
    await setMhd([[prod[0].name, 400, 6]]);
    const s = await sektion();
    expect(s, 'Abschnitt fehlt');
    eq(JSON.stringify(s.rows), JSON.stringify([{ lamp: 'g', text: `${prod[0].name}|6 St|${await datum(400)}` }]), 'Zeilen');
    expect(s.vorher.startsWith('Nachbestellen'), 'Überschrift davor: ' + s.vorher);
    expect(!(await page.locator('#app').innerText()).includes('Läuft in'), 'Zusätzliche Warnung bei 400 Tagen Rest');
  });
  await S('Zwei Einträge: beide, der frühere zuerst; ohne Stückzahl bleibt die Spalte leer', async () => {
    await setMhd([[prod[1].name, 90, 0], [prod[0].name, 45, 3]]);
    const s = await sektion();
    eq(JSON.stringify(s.rows.map(r => r.text)), JSON.stringify([`${prod[0].name}|3 St|${await datum(45)}`, `${prod[1].name}||${await datum(90)}`]), 'Zeilen');
  });
  await S('Fünf Einträge plus Abgelaufenes und Erledigtes: genau die drei nächsten, in Reihenfolge, Ampel rot/gelb/grün', async () => {
    await setMhd([[prod[2].name, 200, 1], [prod[0].name, 40, 2], [prod[1].name, 3, 5], [prod[2].name, 20, 8], [prod[0].name, 100, 9], [prod[1].name, -1, 7], [prod[2].name, 1, 4, true]]);
    const s = await sektion();
    eq(JSON.stringify(s.rows), JSON.stringify([
      { lamp: 'r', text: `${prod[1].name}|5 St|${await datum(3)}` },
      { lamp: 'y', text: `${prod[2].name}|8 St|${await datum(20)}` },
      { lamp: 'g', text: `${prod[0].name}|2 St|${await datum(40)}` }]), 'Zeilen');
  });
  await S('Grenzen der Ampel: heute und 13 Tage rot, 14 und 30 Tage gelb, 31 Tage grün', async () => {
    await setMhd([[prod[0].name, 0, 1], [prod[1].name, 13, 1], [prod[2].name, 14, 1]]);
    eq((await sektion()).rows.map(r => r.lamp).join(','), 'r,r,y', 'Ampel bei heute/13/14 Tagen');
    eq((await sektion()).rows[0].text, `${prod[0].name}|1 St|${await datum(0)}`, 'Eintrag mit heutigem Datum');
    await setMhd([[prod[0].name, 30, 1], [prod[1].name, 31, 1]]);
    eq((await sektion()).rows.map(r => r.lamp).join(','), 'y,g', 'Ampel bei 30/31 Tagen');
  });
  await S('Erledigt man den nächsten Eintrag unter Einkauf, rückt der folgende nach', async () => {
    await setMhd([[prod[0].name, 5, 2], [prod[1].name, 50, 2], [prod[2].name, 60, 2], [prod[0].name, 70, 2]]);
    await tab('einkauf'); await hideToast(page);
    await page.locator('#app .it', { hasText: prod[0].name + ' · 2 St' }).first().locator('[data-a="a-mhd"]').click();
    await fillModal(page, prod[0].name, { a: 'done', x: '' });
    await idle(page);
    await tab('bon');
    eq((await sektion()).rows.map(r => r.text.split('|')[2]).join(','), [await datum(50), await datum(60), await datum(70)].join(','), 'Daten nach dem Erledigen');
  });
  await S('Erklärung zum Abschnitt; Aufräumen; keine Fehler in der Browser-Konsole', async () => {
    await page.locator('#app .ii[data-k="next3"]').click();
    await see(page, 'egal wie weit es noch hin ist', '#modal');
    await page.locator('#modal button', { hasText: 'OK' }).click();
    await setMhd([]);
    const real = page.problems.filter(p => !/favicon/i.test(p));
    expect(real.length === 0, real.join(' · '));
  });
  await page.context().close();
};
