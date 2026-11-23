# Kiosk

Web-App für einen Selbstkosten-Kiosk: Schuldschein per QR-Code und PIN, Bestand mit Ampel nach Reichweite,
Einkauf mit Haltbarkeitsdaten, Einnahmen und Ausgaben nach Woche, Monat und Jahr.

- `index.html`, `app.js`, `style.css`: die App (ohne Build-Schritt, läuft über GitHub Pages)
- `vendor/`: lokal abgelegte Bibliotheken (supabase-js 2.45.4, qrcode-generator 1.4.4)
- `db/schema.sql`: Tabellen, Zugriffsregeln und Funktionen für Supabase

Daten liegen ausschließlich in der Supabase-Datenbank, nicht in diesem Repository.

Nach jeder Änderung an `app.js` oder `style.css` die Versionsnummer `?v=` in `index.html` erhöhen, damit Handys die neue Fassung laden.
Änderungen an Datenbankfunktionen so vornehmen, dass die vorherige App-Fassung weiter funktioniert.
