# Notizen für Claude

## Ware im Lager (bezahlt, noch nicht im Regal)

| Gekauft | Produkt | Menge | Einkaufspreis | MHD | Ausgabe gebucht |
|---|---|---|---|---|---|
| 25.11.2026 | Snickers | 15 Stück (3 × 5er à 1,79 €) | 0,36 €/Stück | Ende 2027 | ja, 5,37 € als Buchung von Hand am 25.11.2026 |

**Wenn Franco fragt, wie die Ware ins Regal kommt** (oder sagt „Snickers ins Regal“):
1. Admin → Regal → Snickers antippen.
2. Bestand um 15 erhöhen und das MHD vom Aufdruck eintragen, dann speichern.
3. **Nicht** als Einkauf erfassen: Die 5,37 € sind schon gebucht und würden sonst doppelt zählen.

Claude kann das auch selbst machen: `update products set stock = stock + 15 where name = 'Snickers'` plus MHD-Eintrag. Danach die Zeile hier aus der Tabelle löschen.
