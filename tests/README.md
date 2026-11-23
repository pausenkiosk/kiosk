# Tests für die Kiosk-App

Die Tests laufen **nur gegen das Supabase-Testprojekt**, nie gegen das echte Projekt
(`run.sh` und `lib.js` brechen ab, wenn die echte Kennung angegeben wird, und der Test-Browser blockiert Aufrufe dorthin).

## Starten

```bash
export KIOSK_TEST_REF=…        # Kennung des Testprojekts
export KIOSK_TEST_KEY=…        # öffentlicher Schlüssel des Testprojekts
export KIOSK_TEST_ADMIN_PW=…   # frei gewähltes Passwort für den Test-Verwalter
tests/run.sh                   # alles
tests/run.sh kollege           # nur ein Teil: sperren | kollege | verwalter | grenzen
```

`run.sh` macht vier Dinge:

1. spielt `seed.sql` ein (erfundene Produkte, Personen, Test-Verwalter) – dafür braucht es einen Verwaltungs-Token
   für das Testprojekt (`SUPABASE_ACCESS_TOKEN`, in der Cloud-Sitzung setzt ihn der Proxy ein),
2. kopiert die App in einen temporären Ordner und stellt dort Adresse und Schlüssel auf das Testprojekt um
   (die Dateien im Repository bleiben unverändert),
3. liefert die Kopie lokal aus,
4. startet die Tests mit Playwright.

Vorher muss `db/schema.sql` einmal ins Testprojekt eingespielt sein.

## Teile

| Datei | Inhalt |
|---|---|
| `sperren.test.js` | direkte Aufrufe ohne Anmeldung: Tabellen, `a_*`-Funktionen, Fotospeicher sind gesperrt |
| `kollege.test.js` | QR-Link, Anmeldung, falsche PIN, Sperre nach 3 Versuchen, Einwilligung, Anschreiben, Rückgängig, PIN ändern |
| `verwalter.test.js` | Anmeldung, Bon, Nachricht an Claude, Regal, Regalfoto, Einkauf, Haltbarkeit, Kasse, Leute, QR-Code, Konto ohne Rechte |
| `grenzen.test.js` | Summen bei mehr als 1000 Buchungen |

Die Reihenfolge ist fest: Der Verwalter-Teil baut auf dem Kollegen-Teil auf.
Ergebnis und Bildschirmfotos fehlgeschlagener Schritte liegen danach in `tests/output/` (nicht im Repository).
