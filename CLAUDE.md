# Notizen für Claude

## Ware im Lager (bezahlt, noch nicht im Regal)

| Gekauft | Produkt | Menge | Einkaufspreis | MHD | Ausgabe gebucht |
|---|---|---|---|---|---|
| 25.11.2026 | Snickers | 15 Stück (3 × 5er à 1,79 €) | 0,36 €/Stück | 03.10.2027 | ja, 5,37 € als Buchung von Hand am 25.11.2026 |
| 25.11.2026 | Beef Jerky (Viking Bites) | 8 Stück | 2,52 €/Stück | 29.07.2027 | ja, im „Einkauf Amazon“ 46,78 € (purchase_items vorhanden) |
| 25.11.2026 | Jack Link's Beef Jerky | 12 Stück | 2,22 €/Stück, VK 3,00 € | 07.03.2028 | ja, im „Einkauf Amazon“ 46,78 € (purchase_items vorhanden) |

Kollegen sehen nur Produkte mit Bestand > 0. Deshalb ist der Bestand dieser Ware noch **nicht** erhöht.

**Wenn Franco sagt, die Ware steht im Regal** (oder fragt, wie sie ins Regal kommt):
1. Admin → Regal → Produkt antippen.
2. Bestand um die Menge erhöhen und das MHD eintragen, dann speichern.
3. **Nicht** als Einkauf erfassen: Die Ausgaben sind schon gebucht und würden sonst doppelt zählen.

Claude kann das auch selbst machen: `update products set stock = stock + <Menge> where name = '<Produkt>'`, bei den Amazon-Posten das MHD in der passenden Zeile von purchase_items setzen, bei Snickers (kein Einkaufsbeleg) einen purchase_items-Eintrag mit qty 15, cents 0 und dem MHD anlegen. Danach die Zeile hier aus der Tabelle löschen.
