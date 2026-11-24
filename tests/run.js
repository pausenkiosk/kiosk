'use strict';
/* Startet die Testteile nacheinander. Reihenfolge ist wichtig:
   Der Verwalter-Teil baut auf dem auf, was der Kollegen-Teil hinterlässt (Sperre, Buchung).
   „kasse“ räumt Kassenstürze und Zahlungen ab und rechnet neu; „grenzen“ legt viele Buchungen an und läuft zuletzt. */
const lib = require('./lib');
const parts = { sperren: require('./sperren.test'), kollege: require('./kollege.test'), verwalter: require('./verwalter.test'), kasse: require('./kasse.test'), guthaben: require('./guthaben.test'), wunsch: require('./wunsch.test'), auszahlung: require('./auszahlung.test'), info: require('./info.test'), uebertrag: require('./uebertrag.test'), anmeldung: require('./anmeldung.test'), liste: require('./liste.test'), sichtbar: require('./sichtbar.test'), grenzen: require('./grenzen.test') };
/* Nur auf ausdrücklichen Wunsch: alte App-Fassung gegen neue Datenbank (tests/run.sh uebergang mit KIOSK_APP_REF). */
const extra = { uebergang: require('./uebergang.test') };

(async () => {
  const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(parts);
  const browser = await lib.launch();
  try {
    for (const p of want) {
      if (extra[p]) { await extra[p](browser); continue; }
      if (!parts[p]) throw new Error(`Unbekannter Testteil: ${p} (möglich: ${Object.keys(parts).join(', ')})`);
      await parts[p](browser);
    }
  } finally { await browser.close(); }
  process.exit(lib.summary() ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
