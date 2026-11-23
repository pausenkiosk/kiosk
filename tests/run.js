'use strict';
/* Startet die Testteile nacheinander. Reihenfolge ist wichtig:
   Der Verwalter-Teil baut auf dem auf, was der Kollegen-Teil hinterlässt (Sperre, Buchung).
   „grenzen“ legt viele Buchungen an und läuft deshalb zuletzt. */
const lib = require('./lib');
const parts = { sperren: require('./sperren.test'), kollege: require('./kollege.test'), verwalter: require('./verwalter.test'), grenzen: require('./grenzen.test') };

(async () => {
  const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(parts);
  const browser = await lib.launch();
  try {
    for (const p of want) {
      if (!parts[p]) throw new Error(`Unbekannter Testteil: ${p} (möglich: ${Object.keys(parts).join(', ')})`);
      await parts[p](browser);
    }
  } finally { await browser.close(); }
  process.exit(lib.summary() ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
