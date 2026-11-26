// Prüft db/stufe9.sql in einer Postgres-Instanz im Speicher (keine echte Datenbank).
// Start: in einem Ordner mit @electric-sql/pglite 0.2.17: node tests/lager-sql.mjs db/stufe9.sql
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const db = new PGlite();
const q = async (s) => (await db.query(s)).rows;
await db.exec(`
create role anon; create role authenticated;
create function is_admin() returns boolean language sql as 'select true';
create table products (id uuid primary key default gen_random_uuid(), name text unique, category text default 'x', price_cents int default 0, sale_cents int, cost_cents int, stock int not null default 0, active boolean default true);
create table purchases (id uuid primary key default gen_random_uuid(), day date not null, store text not null default '');
create table purchase_items (id uuid primary key default gen_random_uuid(), purchase_id uuid references purchases(id) on delete cascade, product_id uuid not null references products(id) on delete cascade, qty int not null, cents int not null, mhd date, mhd_done boolean not null default false);
create table journal (id uuid primary key default gen_random_uuid(), day date not null, text text not null, in_cents int not null default 0, out_cents int not null default 0, source text not null default 'app', kind text, ref uuid, at timestamptz default now());
create table sales (id uuid primary key default gen_random_uuid(), product_id uuid, qty int, cents int, kind text, at timestamptz default now());
create table cash_counts (id uuid primary key default gen_random_uuid(), day date, cents int, at timestamptz default now());
insert into products(name, price_cents, cost_cents, stock) values ('Jack', 300, null, 0), ('Cola', 100, 60, 5);
insert into purchase_items(product_id, qty, cents) select id, 3, 180 from products where name = 'Cola';
`);
await db.exec(fs.readFileSync(process.argv[2], 'utf8'));
let fail = 0;
const check = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++; console.log(ok ? 'ok  ' : 'FAIL', n, ok ? '' : JSON.stringify(got) + ' statt ' + JSON.stringify(want)); };
const id = async n => (await q(`select id from products where name = '${n}'`))[0].id;
const jack = await id('Jack'), cola = await id('Cola');
const st = async n => (await q(`select stock, cost_cents from products where name = '${n}'`))[0];

check('alte Zeilen sind nicht im Lager', (await q(`select lager from purchase_items`)).map(r => r.lager), [false]);
// alte App-Fassung: ohne "lager"
await q(`select a_purchase('2026-11-26', 'Rewe', '[{"id":"${cola}","qty":4,"cents":240}]')`);
check('ohne lager: Bestand +4', await st('Cola'), { stock: 9, cost_cents: 60 });
// neu: ins Lager
await q(`select a_purchase('2026-11-26', 'Amazon', '[{"id":"${jack}","qty":12,"cents":2664,"mhd":"2028-03-07","lager":true},{"id":"${cola}","qty":2,"cents":120}]')`);
check('mit lager: Bestand Jack bleibt 0, EK gesetzt', await st('Jack'), { stock: 0, cost_cents: 222 });
check('gemischter Einkauf: Cola trotzdem ins Regal', (await st('Cola')).stock, 11);
check('Ausgabe gebucht', (await q(`select out_cents from journal where text = 'Einkauf Amazon'`))[0].out_cents, 2784);
const li = (await q(`select id from purchase_items where lager`))[0].id;
// teilweise ins Regal
await q(`select a_shelve('${li}', 5)`);
check('5 ins Regal', (await st('Jack')).stock, 5);
check('Lager-Rest 7, Wert anteilig', (await q(`select qty, cents, mhd::text from purchase_items where lager`)), [{ qty: 7, cents: 1554, mhd: '2028-03-07' }]);
check('abgespaltene Zeile im Regal mit MHD', (await q(`select qty, cents, mhd::text from purchase_items where product_id = '${jack}' and not lager`)), [{ qty: 5, cents: 1110, mhd: '2028-03-07' }]);
check('keine neue Ausgabe', (await q(`select count(*)::int n from journal`))[0].n, 2);
// zu viel / zu wenig wird begrenzt
await q(`select a_shelve('${li}', 0)`);
check('0 zählt als 1', (await st('Jack')).stock, 6);
// Entsorgen aus dem Lager
await q(`select a_lager_waste('${li}', 2)`);
check('Entsorgen: Regal unverändert', (await st('Jack')).stock, 6);
check('Entsorgen: Lager 4', (await q(`select qty from purchase_items where lager`))[0].qty, 4);
check('Entsorgen: Verlust zum EK', (await q(`select qty, cents, kind from sales`)), [{ qty: 2, cents: 444, kind: 'verlust' }]);
// Rest komplett
await q(`select a_shelve('${li}', 99)`);
check('Rest komplett ins Regal', (await st('Jack')).stock, 10);
check('Lager leer', (await q(`select count(*)::int n from purchase_items where lager`))[0].n, 0);
await q(`select a_shelve('${li}', 1)`);
check('doppelt drücken ändert nichts', (await st('Jack')).stock, 10);
// Storno eines Einkaufs mit Lagerware: nur Regalware zurücknehmen
await q(`select a_purchase('2026-11-26', 'Lidl', '[{"id":"${jack}","qty":8,"cents":2014,"lager":true},{"id":"${cola}","qty":1,"cents":60}]')`);
const j = (await q(`select id from journal where text = 'Einkauf Lidl'`))[0].id;
check('Storno ok', (await q(`select a_storno('${j}') r`))[0].r, 'ok');
check('Storno: Jack bleibt 10', (await st('Jack')).stock, 10);
check('Storno: Cola zurück auf 11', (await st('Cola')).stock, 11);
check('Storno: Lagerposten weg', (await q(`select count(*)::int n from purchase_items where lager`))[0].n, 0);
console.log(fail ? fail + ' Fehler' : 'alles ok'); process.exit(fail ? 1 : 0);
