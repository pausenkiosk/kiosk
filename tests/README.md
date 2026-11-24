# Tests für die Kiosk-App

Die Tests laufen **nur gegen das Supabase-Testprojekt**, nie gegen das echte Projekt
(`run.sh` und `lib.js` brechen ab, wenn die echte Kennung angegeben wird, und der Test-Browser blockiert Aufrufe dorthin).

## Starten

```bash
export KIOSK_TEST_REF=…        # Kennung des Testprojekts
export KIOSK_TEST_KEY=…        # öffentlicher Schlüssel des Testprojekts
export KIOSK_TEST_ADMIN_PW=…   # frei gewähltes Passwort für den Test-Verwalter
tests/run.sh                   # alles
tests/run.sh kollege           # nur ein Teil: sperren | kollege | verwalter | kasse | grenzen
KIOSK_APP_REF=origin/next tests/run.sh            # App aus einem anderen Git-Stand testen (Tests bleiben die aus dem Arbeitsordner)
KIOSK_APP_REF=origin/main tests/run.sh uebergang  # bisherige App gegen die schon umgestellte Datenbank
```

`run.sh` macht vier Dinge:

1. spielt `seed.sql` ein (erfundene Produkte, Personen, Test-Verwalter) – dafür braucht es einen Verwaltungs-Token
   für das Testprojekt (`SUPABASE_ACCESS_TOKEN`, in der Cloud-Sitzung setzt ihn der Proxy ein),
2. kopiert die App in einen temporären Ordner und stellt dort Adresse und Schlüssel auf das Testprojekt um
   (die Dateien im Repository bleiben unverändert),
3. liefert die Kopie lokal aus,
4. startet die Tests mit Playwright.

Vorher muss `db/schema.sql` einmal ins Testprojekt eingespielt sein – in der Fassung, zu der die getestete App gehört
(die Tests ab Runde 3 setzen „Ausbaustufe 3“ voraus).

## Teile

| Datei | Inhalt |
|---|---|
| `sperren.test.js` | direkte Aufrufe ohne Anmeldung: Tabellen, `a_*`-Funktionen, Fotospeicher sind gesperrt |
| `kollege.test.js` | QR-Link, Anmeldung, falsche PIN, Sperre nach 3 Versuchen, Einwilligung, Anschreiben, Rückgängig, PIN ändern |
| `verwalter.test.js` | Anmeldung, Bon, Nachricht an Claude, Regal (inkl. Produkt löschen), Fotos (bis 60), Einkauf von Hand / per Ansage / per Bon-Foto, Haltbarkeit (auch ohne Einkauf), Kasse, Leute, QR-Code, Sicherung, Konto ohne Rechte |
| `kasse.test.js` | Kassensturz nach Kasseninhalt (mit/ohne Zahlungen, mehrere Tage, Kasse kleiner als Zahlungen), Storno (Handbuchung, Kassensturz, Einkauf) |
| `guthaben.test.js` | Guthaben aufladen, vom Guthaben anschreiben, Rückgängig, zweite Aufladung, Anzeige bei Verwalter und Kollege, Kassenbuch, Kassensturz, Abschottung zwischen Kollegen |
| `wunsch.test.js` | Wunsch abgeben (Kollege), Zusammenzählen gleicher Wünsche, Grenzen, Liste und „Erledigt“ beim Verwalter |
| `uebergang.test.js` | (nur auf Wunsch, für den Wechsel von v14 auf Ausbaustufe 3) bisherige App-Fassung gegen die neue Datenbank: Buchung von Hand, Einkauf, Zahlung, Kassensturz |
| `grenzen.test.js` | Summen und Sicherung bei mehr als 1000 Buchungen |
| `verwaltung-mock.js` | (nicht von `run.sh` gestartet) Bildschirmfotos der Verwalter-Ansichten mit erfundenen Daten ohne Datenbank |

Die Reihenfolge ist fest: Der Verwalter-Teil baut auf dem Kollegen-Teil auf.
Ergebnis und Bildschirmfotos fehlgeschlagener Schritte liegen danach in `tests/output/` (nicht im Repository).
