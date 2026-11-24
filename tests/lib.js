'use strict';
/* Gemeinsame Helfer für die Kiosk-Tests (Playwright ohne Test-Runner). */
const { chromium, request } = require('playwright');
const fs = require('fs');
const path = require('path');

const ECHT = 'kglxlmjhrzeaswqadfnn';
const env = k => { const v = process.env[k]; if (!v) throw new Error(`Umgebungsvariable ${k} fehlt (tests/run.sh benutzen)`); return v; };
const CFG = {
  ref: env('KIOSK_TEST_REF'), key: env('KIOSK_TEST_KEY'), url: env('KIOSK_TEST_URL'),
  email: env('KIOSK_TEST_ADMIN_EMAIL'), gast: env('KIOSK_TEST_GAST_EMAIL'), pw: env('KIOSK_TEST_ADMIN_PW'), code: env('KIOSK_TEST_CODE')
};
if (CFG.ref === ECHT) throw new Error('Tests laufen nie gegen das echte Projekt.');
CFG.api = `https://${CFG.ref}.supabase.co`;
const OUT = path.join(__dirname, 'output');
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;

const results = [];
let group = '';
const setGroup = g => { group = g; console.log(`\n== ${g} ==`); };

function expect(cond, msg) { if (!cond) throw new Error(msg); }
function eq(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: erwartet „${expected}“, tatsächlich „${actual}“`);
}

/* Ein Prüfschritt. Schlägt er fehl, wird er notiert (mit Bildschirmfoto) und der Lauf geht weiter. */
async function step(name, fn, page) {
  const t0 = Date.now();
  try {
    if (page) await idle(page);
    await fn();
    results.push({ group, name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    const msg = String(err && err.message || err).split('\n').slice(0, 6).join(' | ');
    let shot = null;
    if (page) {
      try {
        fs.mkdirSync(OUT, { recursive: true });
        shot = path.join(OUT, `${group}-${name}`.replace(/[^\wäöüÄÖÜß-]+/g, '_').slice(0, 90) + '.png');
        await page.screenshot({ path: shot, fullPage: true });
      } catch { shot = null; }
      try { await closeModal(page); } catch { /* egal */ }
    }
    results.push({ group, name, ok: false, error: msg, shot, ms: Date.now() - t0 });
    console.log(`  ✗ ${name}\n      ${msg}`);
  }
}

/* Die App übergeht Tipper, solange die vorige Aktion noch lädt (app.js: busy). Darauf warten. */
async function idle(page) { try { await page.waitForFunction(() => typeof busy === 'undefined' || !busy, null, { timeout: 8000 }); } catch { /* weiter */ } }

async function launch() { return chromium.launch({ proxy }); }

/* Neue Browser-Sitzung im Handy-Format, deutsch, Berliner Zeit. Seitenfehler werden mitgeschrieben. */
async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE', timezoneId: 'Europe/Berlin', ...opts });
  ctx.setDefaultTimeout(12000);
  const page = await ctx.newPage();
  page.problems = [];
  page.on('pageerror', e => page.problems.push('Seitenfehler: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') page.problems.push('Konsole: ' + m.text()); });
  page.on('request', r => { if (r.url().includes(ECHT)) page.problems.push('Aufruf ans echte Projekt: ' + r.url()); });
  await ctx.route(u => u.hostname.includes(ECHT), r => r.abort());
  return page;
}

/* Wartet, bis die Hinweis-Leiste unten einen passenden Text zeigt. */
async function toast(page, re, timeout = 12000) {
  try {
    await page.waitForFunction(src => {
      const t = document.querySelector('#toast');
      return t && !t.hidden && new RegExp(src).test(t.textContent);
    }, re.source, { timeout });
  } catch {
    const now = await page.evaluate(() => { const t = document.querySelector('#toast'); return t.hidden ? '(kein Hinweis sichtbar)' : t.textContent; });
    throw new Error(`Hinweis erwartet /${re.source}/, angezeigt: „${now}“${page.problems.length ? ' · ' + page.problems.slice(-2).join(' · ') : ''}`);
  }
}
async function hideToast(page) { await page.evaluate(() => { const t = document.querySelector('#toast'); t.hidden = true; t.textContent = ''; }); }

async function closeModal(page) {
  if (await page.locator('#modal:not([hidden])').count()) {
    await page.evaluate(() => { const b = document.querySelector('#modal [data-a="m-x"], #modal [data-a="m-close"], #modal [data-q="x"]'); if (b) b.click(); });
  }
}

/* Füllt den Eingabedialog (Felder nach Schlüssel k) und schickt ihn ab. */
async function fillModal(page, title, values, submit = true) {
  const m = page.locator('#modal:not([hidden])');
  await m.waitFor();
  if (title) await m.locator('h2', { hasText: title }).waitFor();
  for (const [k, v] of Object.entries(values)) {
    const f = m.locator('#f_' + k);
    if ((await f.evaluate(e => e.tagName)) === 'SELECT') await f.selectOption(String(v)); else await f.fill(String(v));
  }
  if (submit) await m.locator('button.pri').click();
}

/* Kollegen-Anmeldemaske in allen Fassungen: Namensliste, „Willkommen zurück“ (gemerkter Name) oder Suchfeld ab 13 Personen. */
async function loggedOut(page) { await page.waitForFunction(() => /Wer bist du\?|Willkommen zurück/.test(document.querySelector('#app').textContent)); }
async function pickName(page, name) {
  await loggedOut(page);
  const other = page.locator('#app [data-a="k-all"]');
  if (await other.count()) await other.click();
  const kq = page.locator('#kq');
  if (await kq.count()) await kq.fill(name);
  await page.locator('#app .namegrid button', { hasText: new RegExp('^' + name + '$') }).click();
}

/* Saldo einer Person aus der Verwalter-Liste in Cent (positiv = Schulden, negativ = Guthaben), egal in welcher Darstellung:
   alt „4,50“ / „Guthaben 19,90“, neu rot „−4,50“ / grün „19,90“. */
async function listSaldo(page, name) {
  const cell = prow(page, name).locator('span').nth(1);
  const [txt, cls] = [(await cell.innerText()).trim(), (await cell.getAttribute('class')) || ''];
  const n = Math.round(Number(txt.replace(/Guthaben|[−-]/g, '').trim().replace(/\./g, '').replace(',', '.')) * 100);
  return /Guthaben/.test(txt) || /\bpos\b/.test(cls) ? -n : n;
}

/* Anzahl beim Anschreiben wählen und bestätigen (ok = false: abbrechen). Bis v28 Auswahlliste, ab v29 fünf Knöpfe. */
async function anzahl(page, title, qty, ok = true) {
  const m = page.locator('#modal:not([hidden])');
  await m.locator('h2', { hasText: title }).first().waitFor();
  if (await m.locator('#f_qty').count()) return ok ? fillModal(page, title, { qty }) : m.locator('[data-a="m-x"]').click();
  if (!ok) return m.locator('[data-q="x"]').click();
  await m.locator(`[data-q="${qty}"]`).click();
  await m.locator('[data-q="ok"]').click();
}

/* Betrag „Zusammen“ im Anzahl-Dialog (ab v29) */
async function zusammen(page, expected) {
  try { await page.waitForFunction(ex => [...document.querySelectorAll('#modal .ln')].some(l => l.children[0].textContent.includes('Zusammen') && l.children[1].textContent.trim() === ex), expected); }
  catch { const now = await page.evaluate(() => { const l = [...document.querySelectorAll('#modal .ln')].find(x => x.textContent.includes('Zusammen')); return l ? l.children[1].textContent.trim() : '(fehlt)'; });
    throw new Error(`„Zusammen“ im Dialog: erwartet „${expected}“, tatsächlich „${now}“`); }
}

/* Bon-Zeile „Abgleich Ware/Kasse“ (ab v29) bzw. „Fehlbetrag letzte Zählung“ (bis v28).
   alt/neu: erwarteter Betrag in Cent (positiv = es fehlt etwas) oder null (nichts zu vergleichen). */
async function abgleich(page, alt, neu = alt) {
  const nl = await page.locator('#app .ln', { hasText: 'Abgleich Ware/Kasse' }).count();
  const e = c => (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (nl) return lnIs(page, 'Abgleich Ware/Kasse', neu === null ? 'vor dem Kassensturz zählen' : neu > 0 ? 'fehlen ' + e(neu) : neu < 0 ? 'mehr in der Kasse ' + e(-neu) : 'stimmt');
  return lnIs(page, 'Fehlbetrag letzte Zählung', alt === null ? '–' : e(alt));
}

/* Wartet, bis irgendwo in der App ein Text steht. */
async function see(page, text, sel = '#app') {
  try { await page.locator(sel, { hasText: text }).first().waitFor(); }
  catch {
    throw new Error(`Text erwartet: „${text}“ in ${sel}, nicht gefunden${page.problems.length ? ' · ' + page.problems.slice(-2).join(' · ') : ''}`);
  }
}
/* Zeile (.it) mit einem Text; liefert ihren gesamten Text. */
const row = (page, text) => page.locator('#app .it', { hasText: text });
/* Zeile einer Person: der Name muss genau passen (Anna ist nicht Hanna). */
const prow = (page, name) => page.locator('#app .it').filter({ has: page.locator('span', { hasText: new RegExp('^' + name + '$') }) });
async function rowText(page, text) {
  const r = row(page, text).first();
  try { await r.waitFor(); } catch { throw new Error(`Zeile mit „${text}“ nicht gefunden`); }
  return (await r.innerText()).replace(/\s+/g, ' ').trim();
}
/* Wartet, bis die Zeile mit `text` zusätzlich `re` enthält. */
async function rowHas(page, text, re) {
  try {
    await page.waitForFunction(([t, src]) => [...document.querySelectorAll('#app .it')]
      .some(e => e.textContent.includes(t) && new RegExp(src).test(e.textContent.replace(/\s+/g, ' '))), [text, re.source]);
  } catch {
    let now; try { now = await rowText(page, text); } catch { now = '(Zeile fehlt)'; }
    throw new Error(`Zeile „${text}“: erwartet /${re.source}/, tatsächlich „${now}“${page.problems.length ? ' · ' + page.problems.slice(-2).join(' · ') : ''}`);
  }
}
/* Wert einer Bon-Zeile (.ln) wie KASSENSTAND. */
async function lnValue(page, label) {
  const l = page.locator('#app .ln', { hasText: label }).first();
  try { await l.waitFor(); } catch { throw new Error(`Zeile „${label}“ nicht gefunden`); }
  return (await l.locator('span').nth(1).innerText()).trim();
}
async function lnIs(page, label, expected) {
  try {
    await page.waitForFunction(([lb, ex]) => [...document.querySelectorAll('#app .ln')]
      .some(e => e.children[0].textContent.includes(lb) && (e.children[1].textContent.trim() === ex ||
        (lb === 'OFFEN' && e.children[1].textContent.trim() === '−' + ex))), [label, expected]);   // ab v24 stehen Schulden beim Kollegen mit Minus
  } catch {
    let now; try { now = await lnValue(page, label); } catch { now = '(fehlt)'; }
    throw new Error(`„${label}“: erwartet „${expected}“, tatsächlich „${now}“`);
  }
}

/* Direkter Aufruf der Datenbank-Schnittstelle ohne Anmeldung (nur öffentlicher Schlüssel). */
async function anonApi() {
  return request.newContext({ baseURL: CFG.api, proxy, extraHTTPHeaders: { apikey: CFG.key, Authorization: 'Bearer ' + CFG.key, 'Content-Type': 'application/json' } });
}

/* SQL direkt im Testprojekt (Verwaltungs-API). Nur für Dinge, die die App selbst nicht kann, z. B. Fotos künstlich altern lassen. */
async function sql(query) {
  const ctx = await request.newContext({ proxy });
  try {
    let r;
    for (let i = 0; i < 4; i++) {   // die Verwaltungs-API antwortet vereinzelt mit 502/503: kurz warten und wiederholen
      r = await ctx.post(`https://api.supabase.com/v1/projects/${CFG.ref}/database/query`, {
        headers: { Authorization: 'Bearer ' + (process.env.SUPABASE_ACCESS_TOKEN || 'proxy-injected'), 'Content-Type': 'application/json' }, data: { query } });
      if (r.status() < 500) break;
      await new Promise(f => setTimeout(f, 3000));
    }
    if (!r.ok()) throw new Error(`SQL fehlgeschlagen (${r.status()}): ${(await r.text()).slice(0, 300)}`);
    return r.json();
  } finally { await ctx.dispose(); }
}

const isoDay = (offset = 0) => {
  const d = new Date(Date.now() + offset * 864e5);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(d);
};

function summary() {
  const bad = results.filter(r => !r.ok);
  console.log(`\n${results.length - bad.length} von ${results.length} Prüfschritten bestanden.`);
  bad.forEach(r => console.log(`  ✗ [${r.group}] ${r.name}: ${r.error}`));
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'ergebnis.json'), JSON.stringify(results, null, 1));
  return bad.length;
}

module.exports = { CFG, ECHT, step, setGroup, expect, eq, launch, idle, newPage, toast, hideToast, closeModal, fillModal, loggedOut, pickName, listSaldo, anzahl, zusammen, abgleich, see, row, prow, rowText, rowHas, lnValue, lnIs, anonApi, sql, isoDay, summary, results };
