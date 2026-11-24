'use strict';
/* Kiosk-App. Zwei Ansichten in einer Seite:
   Kollegen kommen über den QR-Code (?k=CODE) und buchen per PIN-Sitzung über k_*-Funktionen.
   Der Verwalter meldet sich mit E-Mail und Passwort an und arbeitet direkt auf den Tabellen (RLS: is_admin). */
const SB = supabase.createClient('https://kglxlmjhrzeaswqadfnn.supabase.co', 'sb_publishable_Zj28xObvtK0zHlTFL2HpMA_cEVmW5b1');
const $ = s => document.querySelector(s);
const app = $('#app'), nav = $('#nav'), modal = $('#modal'), toastEl = $('#toast');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = c => (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cents = s => {
  s = String(s ?? '').trim().replace(/[€\s]/g, '').replace(/[−–]/g, '-');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
const pad = n => String(n).padStart(2, '0');
const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dshort = s => { const d = pd(s); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`; };
const LS = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ohne Speicher weiter */ } },
  del: k => { try { localStorage.removeItem(k); } catch { /* egal */ } }
};
const ln = (a, b, cls = '') => `<div class="ln ${cls}"><span>${a}</span><span>${b}</span></div>`;
const head = sub => `<p class="ctr"><span class="logo">KIOSK</span><span class="sub">${sub}</span></p><hr>`;
const rpc = async (fn, args) => { const { data, error } = await SB.rpc(fn, args); if (error) throw error; return data; };
const ok = r => { if (r.error) throw r.error; return r.data; };

const INFO = {"k_saldo": "Dein Schuldschein ist wie ein kleines Konto. Was du anschreibst, kommt dazu. Gibst du dem Betreiber Geld, wird es abgezogen. Gibst du mehr, als offen ist, hast du Guthaben, von dem deine nächsten Einkäufe abgehen.", "k_buy": "Produkt antippen und Anzahl wählen. Der Betrag landet auf deinem Schuldschein. Angezeigt wird, was laut App im Regal liegt. Fehlt etwas, das du vor dir siehst, sag dem Betreiber Bescheid oder zahle bar.", "k_entries": "Hier stehen deine letzten 30 Buchungen mit Datum. Einen Kauf kannst du 5 Minuten lang zurücknehmen, falls du dich vertippt hast. Danach hilft der Betreiber.", "k_wish": "Dein Wunsch geht ohne deinen Namen an den Betreiber. Wünschen mehrere dasselbe, wird es zusammengezählt.", "kasse": "Kassenstand: alle Einnahmen minus alle Ausgaben seit Beginn, auch die Einkäufe, die du aus eigener Tasche bezahlt hast. Ein Minus heißt: Der Kiosk schuldet dir noch Geld.", "fehl": "Abgleich Ware/Kasse: Was laut Zählung ohne Buchung aus dem Regal verschwunden ist, hätte bar bezahlt werden müssen. Die App vergleicht diesen Warenwert mit den Barverkäufen des letzten Kassensturzes. „fehlen“ heißt: weniger Geld als Ware, „mehr in der Kasse“: mehr Geld als Ware. Das geht nur, wenn du zwischen zwei Kassenstürzen unter Regal gezählt hast, am besten direkt vor dem Kassensturz.", "ampel": "Die Ampel richtet sich danach, wie lange der Bestand noch reicht: Bestand geteilt durch den Verkauf pro Woche der letzten 4 Wochen. Ein Ladenhüter mit 4 Stück kann grün sein, ein Renner mit 10 Stück rot.", "mhd": "Haltbarkeit: Gelb ab 30 Tagen vor Ablauf, damit noch Zeit für einen Abverkaufspreis bleibt. Rot bei weniger als 14 Tagen und wenn es abgelaufen ist.", "claude": "Was du hier schreibst, liest Claude werktags um 10:13 und 14:13 Uhr. Daten und Fragen erledigt Claude direkt, Änderungen an der App gehen an die Programmierung. Schuldscheine, Löschen und Sicherheit nur nach Rückfrage.", "backup": "Lädt alle Kiosk-Daten als Datei auf dein Gerät: Produkte, Buchungen, Schuldscheine, Zählungen, Wünsche und offene Aufträge, ohne PINs, ohne QR-Code und ohne Fotos. Zusätzlich legt Claude jeden Freitag eine Sicherung in dein Google Drive.", "zaehlen": "Trag ein, was wirklich im Regal liegt. Was seit der letzten Zählung ohne Buchung fehlt, zählt als Barverkauf oder Schwund und fließt in den Fehlbetrag. Am besten direkt vor einem Kassensturz zählen.", "fotos": "Fotos vom Regal oder von einzelnen Produkten mit Haltbarkeitsdatum, bis zu 60 auf einmal. Claude zählt bzw. liest die Daten und legt einen Vorschlag ab, den du mit „Prüfen“ bestätigst.", "wuensche": "Wünsche der Kollegen, ohne Namen. Die Zahl zeigt, wie viele dasselbe wollen. „Erledigt“ nimmt den Wunsch aus der Liste.", "einkauf": "Kassenbon fotografieren, Screenshot einer Bestellung hochladen oder einfach ansagen, was du wo gekauft hast. Claude macht daraus einen Vorschlag; gebucht wird erst, wenn du ihn prüfst und speicherst.", "kassensturz": "Kassensturz geht, wann immer du willst, ohne festen Rhythmus: Kasse leeren, Geld zählen, Betrag eintragen. Einzahlungen und Auszahlungen seit dem letzten Kassensturz rechnet die App heraus, der Rest zählt als Barverkauf.", "storno": "Storno nimmt eine eigene Eingabe zurück: Buchung von Hand, Einkauf (samt Bestand) oder den letzten Kassensturz. Einzahlungen korrigierst du unter Leute.", "schuldscheine": "Rot mit Minus: Schulden. Grün: Guthaben. Einzahlung: Geld, das du bekommen hast; über den offenen Betrag hinaus wird es Guthaben. Auszahlung: Guthaben bar zurückgeben. Lampe grün: hat zugestimmt, leer: noch nicht angemeldet oder nicht zugestimmt, rot: gerade gesperrt.", "rangliste": "Umsatz pro Person aus Käufen per Schuldschein, ohne Einzahlungen. Welche Produkte jemand kauft, wird nicht gespeichert.", "qr": "Über diesen Code melden sich Kollegen an. Ein neuer Code macht den alten sofort ungültig; wer angemeldet ist, bleibt es. Ab 30 Tagen erinnert die Startseite.", "next3": "Die drei Produkte, deren Haltbarkeitsdatum als Nächstes erreicht wird, egal wie weit es noch hin ist. Bereits Abgelaufenes steht weiter oben in Rot."};
const ii = k => `<button type="button" class="ii noprint" data-a="info" data-k="${k}" aria-label="Erklärung">i</button>`;
let toastT;
function toast(msg) {
  toastEl.textContent = msg; toastEl.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { toastEl.hidden = true; }, 3200);
}

/* Eingabedialog: liefert ein Objekt mit den Feldwerten oder null bei Abbruch. */
let modalDone = null;
function ask(title, fields, okLabel = 'Speichern', intro = '') {
  modal.innerHTML = `<form class="paper" id="mform"><h2>${esc(title)}</h2>${intro}` + fields.map(f => {
    const id = 'f_' + f.k;
    if (f.type === 'select') return `<label for="${id}">${esc(f.label)}</label><select id="${id}">` +
      f.options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(f.value ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('') + '</select>';
    if (f.type === 'area') return `<label for="${id}">${esc(f.label)}</label><textarea id="${id}" rows="6">${esc(f.value ?? '')}</textarea>`;
    return `<label for="${id}">${esc(f.label)}</label><input id="${id}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}"` +
      `${f.mode ? ` inputmode="${f.mode}"` : ''}${f.max ? ` maxlength="${f.max}"` : ''}${f.ac ? ` autocomplete="${f.ac}"` : ' autocomplete="off"'}>`;
  }).join('') + `<div class="row"><button type="button" class="btn" data-a="m-x">Abbrechen</button><button class="btn pri">${esc(okLabel)}</button></div></form>`;
  modal.hidden = false;
  const first = modal.querySelector('input,select,textarea'); if (first) first.focus();
  return new Promise(res => {
    modalDone = v => { modal.hidden = true; modal.innerHTML = ''; modalDone = null; res(v); };
    $('#mform').addEventListener('submit', e => {
      e.preventDefault();
      const out = {}; fields.forEach(f => { out[f.k] = $('#f_' + f.k).value; });
      modalDone(out);
    });
  });
}

/* ---------------- Kollegen ---------------- */
const K = { code: null, token: null, names: null, sel: null, st: null, all: false, q: '' };
const favGet = () => { try { const f = JSON.parse(LS.get('kfav') || 'null'); return f && f.id ? f : null; } catch { return null; } };

const CONSENT_SHORT = 'Mit dem Schuldschein schreibst du im Kiosk an, statt Kleingeld zu suchen, und siehst jederzeit, was noch offen ist. ' +
  'Gespeichert werden nur dein Vorname sowie Betrag und Tag deiner Buchungen, nicht was du kaufst. ' +
  'Mitmachen ist freiwillig, bar bezahlen geht weiterhin.';
const CONSENT_LONG = `<details><summary>Genau nachlesen</summary>
<p><b>Was gespeichert wird</b></p><ul><li>dein Vorname</li><li>deine PIN, verschlüsselt und für niemanden lesbar</li>
<li>pro Buchung der Betrag und der Tag</li><li>deine Zahlungen und dein offener Betrag</li></ul>
<p><b>Was nicht gespeichert wird</b></p><p>Welche Produkte du kaufst und zu welcher Uhrzeit. Verkäufe werden für die Nachbestellung gezählt, aber ohne Bezug zu dir.</p>
<p><b>Wer es sieht</b></p><p>Du siehst deinen eigenen Schuldschein. Der Betreiber des Kiosks sieht deinen Vornamen, deinen offenen Betrag und wie viel du insgesamt anschreibst. Andere Kollegen und der Arbeitgeber sehen nichts.</p>
<p><b>Wo es liegt</b></p><p>Auf Servern des Dienstleisters Supabase in Frankfurt.</p>
<p><b>Deine Rechte</b></p><p>Du kannst jederzeit Auskunft verlangen und deine Zustimmung zurücknehmen. Sobald dein Schuldschein ausgeglichen ist, werden deine Daten auf Wunsch gelöscht. Sprich dazu den Betreiber an.</p></details>`;

async function kBoot() {
  nav.hidden = true;
  K.token = LS.get('ktoken');
  if (K.token) {
    K.st = await rpc('k_state', { p_token: K.token });
    if (!K.st) { K.token = null; LS.del('ktoken'); }
  }
  if (!K.token) {
    K.names = await rpc('k_names', { p_code: K.code });
    if (K.names === null) { LS.del('kcode'); return landing('Dieser QR-Code ist nicht mehr gültig. Bitte den aktuellen Code am Kiosk scannen.'); }
  }
  kRender();
}

function kRender() {
  if (!K.token) {
    if (!K.sel) {
      const fav = favGet(), favOk = fav && K.names.some(n => n.id === fav.id);
      if (fav && !favOk) LS.del('kfav');
      const btn = n => `<button class="btn" data-a="k-sel" data-id="${n.id}" data-n="${esc(n.vorname)}">${esc(n.vorname)}</button>`;
      if (favOk && !K.all) {
        app.innerHTML = `<div class="paper">${head('Schuldschein')}<h2>Willkommen zurück</h2>
          <div class="stack"><button class="btn pri" data-a="k-sel" data-id="${fav.id}" data-n="${esc(fav.n)}">Weiter als ${esc(fav.n)}</button></div>
          <hr><div class="row"><button class="btn sm" data-a="k-all">Andere Person</button></div></div>`;
        return;
      }
      const q = K.q.trim().toLowerCase(), many = K.names.length > 12;
      const hits = K.names.filter(n => !q || n.vorname.toLowerCase().startsWith(q));
      app.innerHTML = `<div class="paper">${head('Schuldschein')}<h2>Wer bist du?</h2>` +
        (K.names.length ? (many ? `<label for="kq">Vorname eintippen</label><input id="kq" autocomplete="off" autocapitalize="words" value="${esc(K.q)}">` : '') +
          `<div class="namegrid" id="kgrid">${many && !q ? '' : hits.map(btn).join('') || '<p class="mut">Kein Treffer.</p>'}</div>`
          : '<p>Es ist noch niemand eingetragen. Sprich den Betreiber an.</p>') +
        (favOk ? '<div class="row"><button class="btn sm" data-a="k-fav">Zurück zu meinem Namen</button></div>' : '') +
        '<hr><p class="small mut">Du stehst nicht in der Liste? Dann zahlst du bar oder lässt dich vom Betreiber eintragen. Nach der Anmeldung merkt sich dein Handy deinen Namen.</p></div>';
      const kq = $('#kq');
      if (kq) {
        kq.addEventListener('input', () => {
          K.q = kq.value; const v = K.q.trim().toLowerCase();
          $('#kgrid').innerHTML = v ? (K.names.filter(n => n.vorname.toLowerCase().startsWith(v)).map(btn).join('') || '<p class="mut">Kein Treffer.</p>') : '';
        });
        if (!favOk) kq.focus();
      }
    } else {
      app.innerHTML = `<div class="paper">${head('Schuldschein')}<h2>Hallo ${esc(K.sel.n)}</h2>
        <form id="kpin"><label for="pin">Deine 4-stellige PIN</label>
        <input id="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off">
        <div class="row"><button type="button" class="btn" data-a="k-back">Zurück</button><button class="btn pri">Anmelden</button></div></form>
        <p class="small mut">Nach 3 falschen Versuchen ist die Anmeldung 1 Stunde gesperrt.</p></div>`;
      $('#pin').focus();
      $('#kpin').addEventListener('submit', kLogin);
    }
    return;
  }
  const s = K.st;
  if (!s.consent) {
    app.innerHTML = `<div class="paper">${head('Schuldschein')}<h2>Kurz vorab, ${esc(s.vorname)}</h2><p>${CONSENT_SHORT}</p>${CONSENT_LONG}
      <div class="stack"><button class="btn pri" data-a="k-consent">Einverstanden, Schuldschein nutzen</button>
      <button class="btn" data-a="k-logout">Lieber nicht</button></div></div>`;
    return;
  }
  const cats = {};
  s.products.filter(p => p.stock > 0).forEach(p => { (cats[p.cat] = cats[p.cat] || []).push(p); });
  const prod = Object.keys(cats).map(c => `<h2>${esc(c)}</h2>` + cats[c].map(p =>
    `<button class="it" data-a="k-buy" data-id="${p.id}"><i class="lamp ${p.stock > 0 ? 'g' : 'o'}"></i><span>${esc(p.name)}${p.sale ? ' <b class="neg">Abverkauf</b>' : ''}</span>` +
    `<span class="mut">${p.stock > 0 ? p.stock + ' St' : 'aus'}</span><span>${p.sale ? `<s>${eur(p.normal)}</s> ` : ''}${eur(p.cents)} €</span></button>`).join('')).join('');
  app.innerHTML = `<div class="paper">${head('Schuldschein von ' + esc(s.vorname))}
      ${ln((s.saldo < 0 ? 'DEIN GUTHABEN' : 'OFFEN') + ' ' + ii('k_saldo'), `<span class="${s.saldo > 0 ? 'neg' : s.saldo < 0 ? 'pos' : ''}">${s.saldo > 0 ? '−' : ''}${eur(Math.abs(s.saldo))} €</span>`, 'big')}
      <p class="small mut">${s.saldo < 0 ? 'Einkäufe werden von deinem Guthaben abgezogen. Ist es aufgebraucht, schreibst du wie gewohnt an.' : 'Bezahlen oder Guthaben aufladen: Betrag dem Betreiber geben, er trägt ihn ein.'}</p></div>
    <div class="paper"><h2>Bestand und Anschreiben ${ii('k_buy')}</h2><p class="small mut">Zum Anschreiben das Produkt antippen.</p>${prod || '<p>Gerade ist nichts im Regal eingetragen.</p>'}</div>
    <div class="paper"><h2>Deine Buchungen ${ii('k_entries')}</h2>${s.entries.length ? s.entries.map(e =>
      `<div class="it"><i></i><span>${dshort(e.day)} ${e.kind === 'zahlung' ? 'Einzahlung' : e.kind === 'auszahlung' ? 'Auszahlung' : e.kind === 'korrektur' ? (e.cents > 0 ? 'Übertrag Schulden' : 'Übertrag Guthaben') : 'Kauf'}</span>` +
      `<span>${e.undo ? `<button class="btn sm" data-a="k-undo" data-id="${e.id}">Rückgängig</button>` : ''}</span><span class="${e.cents < 0 ? 'pos' : ''}">${eur(Math.abs(e.cents))}</span></div>`).join('')
      : '<p class="mut">Noch nichts gebucht.</p>'}</div>
    <div class="paper"><h2>Wunsch ${ii('k_wish')}</h2><p class="small mut">Was fehlt dir im Kiosk? Dein Wunsch geht ohne Namen an den Betreiber.</p>
      <div class="row"><button class="btn" data-a="k-wish">Wunsch abgeben</button></div></div>
    <div class="paper"><div class="row"><button class="btn" data-a="k-pin">PIN ändern</button><button class="btn" data-a="k-logout">Abmelden</button></div>
      <p class="small mut">${favGet() ? 'Dein Handy merkt sich deinen Namen für die nächste Anmeldung. <button class="linkbtn" data-a="k-forget">Vergessen</button>' : 'Dein Handy merkt sich deinen Namen nicht. Bei der nächsten Anmeldung wird er wieder gemerkt.'}</p>
      <details class="small"><summary>Als App auf den Startbildschirm</summary>
<p><b>iPhone:</b> Diese Seite in Safari öffnen, unten auf Teilen tippen (Quadrat mit Pfeil nach oben), „Zum Home-Bildschirm“ wählen und bestätigen. Beim ersten Öffnen des neuen Symbols einmal neu anmelden.</p>
<p><b>Android:</b> Diese Seite in Chrome öffnen, oben rechts auf die drei Punkte tippen, „Zum Startbildschirm hinzufügen“ oder „App installieren“ wählen und bestätigen.</p>
<p class="mut">Das Symbol öffnet den Kiosk wie eine App. Installiert wird nichts.</p></details></div>`;
}

async function kLogin(e) {
  e.preventDefault();
  const r = await rpc('k_login', { p_code: K.code, p_person: K.sel.id, p_pin: $('#pin').value });
  if (r.ok) { K.token = r.token; LS.set('ktoken', r.token); LS.set('kfav', JSON.stringify({ id: K.sel.id, n: K.sel.n })); K.sel = null; K.all = false; K.q = ''; return kBoot(); }
  if (r.err === 'pin') toast(`Falsche PIN. Noch ${r.rest} Versuch${r.rest === 1 ? '' : 'e'}.`);
  else if (r.err === 'gesperrt') toast('Gesperrt bis ' + new Date(r.bis).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr.');
  else toast('Anmeldung nicht möglich.');
  $('#pin').value = '';
}
const kReload = async () => { K.st = await rpc('k_state', { p_token: K.token }); if (!K.st) { LS.del('ktoken'); K.token = null; return kBoot(); } kRender(); };

const kActs = {
  'k-sel': el => { K.sel = { id: el.dataset.id, n: el.dataset.n }; kRender(); },
  'k-back': () => { K.sel = null; kRender(); },
  'k-all': () => { K.all = true; K.q = ''; kRender(); },
  'k-fav': () => { K.all = false; kRender(); },
  'k-forget': () => { LS.del('kfav'); toast('Dein Handy hat deinen Namen vergessen.'); kRender(); },
  'k-consent': async () => { await rpc('k_consent', { p_token: K.token }); await kReload(); },
  'k-logout': async () => { await rpc('k_logout', { p_token: K.token }); LS.del('ktoken'); K.token = null; K.st = null; await kBoot(); },
  'k-buy': async el => {
    const p = K.st.products.find(x => x.id === el.dataset.id);
    const qty = await new Promise(res => {
      let n = 1;
      const draw = () => {
        modal.innerHTML = `<div class="paper"><h2>${esc(p.name)}</h2><p class="small mut">Wie viele? Je ${eur(p.cents)} €</p>
          <div class="qty">${[1, 2, 3, 4, 5].map(i => `<button type="button" class="btn${i === n ? ' pri' : ''}" data-q="${i}" aria-pressed="${i === n}">${i}</button>`).join('')}</div>
          ${ln('Zusammen', eur(n * p.cents) + ' €', 'big')}
          <div class="row"><button type="button" class="btn" data-q="x">Abbrechen</button><button type="button" class="btn pri" data-q="ok">Anschreiben</button></div></div>`;
      };
      draw(); modal.hidden = false;
      modal.onclick = e => {
        const b = e.target.closest('[data-q]'); if (!b) return;
        e.stopPropagation();
        const q = b.dataset.q;
        if (q === 'x' || q === 'ok') { modal.onclick = null; modal.hidden = true; modal.innerHTML = ''; res(q === 'ok' ? n : 0); }
        else { n = Number(q); draw(); }
      };
    });
    if (!qty) return;
    const r = await rpc('k_buy', { p_token: K.token, p_product: p.id, p_qty: qty });
    toast(r.ok ? `${p.name} angeschrieben. 5 Minuten lang rückgängig möglich.` : 'Buchung nicht möglich.');
    await kReload();
  },
  'k-undo': async el => { const r = await rpc('k_undo', { p_token: K.token, p_entry: el.dataset.id }); toast(r.ok ? 'Buchung zurückgenommen.' : 'Zu spät, bitte den Betreiber ansprechen.'); await kReload(); },
  'k-wish': async () => {
    const v = await ask('Wunsch abgeben', [{ k: 't', label: 'Welches Produkt soll es im Kiosk geben?', max: 60 }], 'Abschicken');
    if (!v || v.t.trim().length < 2) return;
    await rpc('k_wish', { p_token: K.token, p_text: v.t.trim() }); toast('Danke, dein Wunsch ist angekommen.');
  },
  'k-pin': async () => {
    const v = await ask('PIN ändern', [{ k: 'o', label: 'Alte PIN', type: 'password', mode: 'numeric', max: 4 }, { k: 'n', label: 'Neue PIN (4 Ziffern)', type: 'password', mode: 'numeric', max: 4 },
      { k: 'w', label: 'Neue PIN wiederholen', type: 'password', mode: 'numeric', max: 4 }]);
    if (!v) return;
    if (v.n !== v.w) return toast('Nicht geändert: Die beiden neuen PINs sind nicht gleich.');
    toast(await rpc('k_pin', { p_token: K.token, p_old: v.o, p_new: v.n }) ? 'PIN geändert.' : 'Nicht geändert: alte PIN falsch oder neue PIN keine 4 Ziffern.');
  }
};

/* ---------------- Verwalter ---------------- */
const A = { tab: 'bon', d: null, counting: false, span: 'month', job: null, draft: null };
const TABS = [['bon', 'Bon'], ['regal', 'Regal'], ['einkauf', 'Einkauf'], ['kasse', 'Kasse'], ['leute', 'Leute']];

async function aBoot(session) {
  if (!session) return aLoginScreen();
  if (!(await rpc('is_admin'))) {
    app.innerHTML = `<div class="paper">${head('Verwaltung einrichten')}<p>Du bist angemeldet, aber noch nicht als Verwalter eingetragen. Gib einmalig den Einrichtungscode ein.</p>
      <form id="claim"><label for="sc">Einrichtungscode</label><input id="sc" autocomplete="off"><div class="row"><button type="button" class="btn" data-a="a-out">Abmelden</button><button class="btn pri">Freischalten</button></div></form></div>`;
    $('#claim').addEventListener('submit', async e => {
      e.preventDefault();
      if (await rpc('a_claim', { p_code: $('#sc').value.trim() })) { toast('Verwaltung freigeschaltet.'); aBoot(session); } else toast('Code falsch oder Verwaltung bereits vergeben.');
    });
    return;
  }
  await aLoad(); aRender(); sweepPhotos();
}

function aLoginScreen() {
  nav.hidden = true;
  app.innerHTML = `<div class="paper">${head('Verwaltung')}<form id="alog"><label for="em">E-Mail</label><input id="em" type="email" autocomplete="username">
    <label for="pw">Passwort (mindestens 10 Zeichen)</label><input id="pw" type="password" autocomplete="current-password">
    <div class="stack"><button class="btn pri">Anmelden</button><button type="button" class="btn" data-a="a-signup">Erstes Mal: Konto anlegen</button></div></form></div>`;
  $('#alog').addEventListener('submit', async e => {
    e.preventDefault();
    const { data, error } = await SB.auth.signInWithPassword({ email: $('#em').value.trim(), password: $('#pw').value });
    if (error) return toast(error.message === 'Email not confirmed' ? 'Bitte zuerst den Link in der Bestätigungs-Mail öffnen.' : 'Anmeldung fehlgeschlagen.');
    aBoot(data.session);
  });
}

/* Die Schnittstelle liefert höchstens 1000 Zeilen je Abfrage: seitenweise nachladen, sonst stimmen Summen nicht. */
async function pages(mk) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = ok(await mk().range(from, from + 999));
    out.push(...rows);
    if (rows.length < 1000) return { data: out };
  }
}
async function aLoad() {
  try { await rpc('a_cleanup'); } catch (e) { console.warn(e); }
  const since = new Date(Date.now() - 90 * 864e5).toISOString();
  const r = await Promise.all([
    SB.from('products').select('*').order('category').order('name'),
    pages(() => SB.from('sales').select('product_id,qty,cents,kind,at').gte('at', since).order('at').order('id')),
    pages(() => SB.from('journal').select('id,day,text,in_cents,out_cents,kind,ref,source').order('at', { ascending: false }).order('id')),
    pages(() => SB.from('ledger').select('person_id,amount_cents,kind,day').order('id')),
    SB.from('persons').select('id,vorname,consent_at,locked_until,active').order('vorname'),
    SB.from('purchase_items').select('id,qty,mhd,product_id').eq('mhd_done', false).not('mhd', 'is', null).order('mhd'),
    SB.from('alerts').select('id,at,text').eq('seen', false).order('at', { ascending: false }),
    SB.from('cash_counts').select('day,cents,bar_cents,at').order('at', { ascending: false }).limit(2),
    SB.from('wishes').select('id,text,created_at,wish_votes(count)').eq('done', false),
    SB.from('settings').select('key,value'),
    SB.from('requests').select('id,at,text,status,answer').order('at', { ascending: false }).limit(6),
    SB.from('photo_jobs').select('id,at,paths,status,result,note,kind,text').neq('status', 'fertig').order('at', { ascending: false })
  ]).then(a => a.map(ok));
  const set = Object.fromEntries(r[9].map(x => [x.key, x.value]));
  A.d = { products: r[0], sales: r[1], journal: r[2], ledger: r[3], persons: r[4], mhd: r[5], alerts: r[6], cash: r[7], wishes: r[8], set, requests: r[10], jobs: r[11].filter(j => j.kind !== 'einkauf'), drafts: r[11].filter(j => j.kind === 'einkauf'),
    rot: Number(set.rot || 1), gelb: Number(set.gelb || 2) };
  const now = Date.now(), d28 = now - 28 * 864e5;
  A.d.products.forEach(p => {
    const units = A.d.sales.filter(s => s.product_id === p.id && s.kind !== 'verlust' && new Date(s.at) >= d28).reduce((a, s) => a + s.qty, 0);
    const weeks = Math.min(4, Math.max(1, (now - new Date(p.created_at)) / (7 * 864e5)));
    p.perWeek = units / weeks;
    p.reach = p.perWeek > 0 ? p.stock / p.perWeek : Infinity;
    p.lamp = p.stock <= 0 ? 'r' : p.reach < A.d.rot ? 'r' : p.reach < A.d.gelb ? 'y' : 'g';
    p.reachTxt = p.stock <= 0 ? 'leer' : p.reach === Infinity ? 'kein Verkauf' : p.reach < 1 ? `${Math.max(1, Math.round(p.reach * 7))} Tage` : `${p.reach.toFixed(1).replace('.', ',')} Wo.`;
  });
}
async function sweepPhotos() {
  try {
    const used = new Set((ok(await SB.from('photo_jobs').select('paths'))).flatMap(j => j.paths || [])), old = Date.now() - 36e5, gone = [];
    for (const dir of ['foto', 'einkauf', 'regal']) {
      const { data } = await SB.storage.from('fotos').list(dir, { limit: 1000 });
      (data || []).forEach(f => { const path = dir + '/' + f.name; if (f.created_at && new Date(f.created_at) < old && !used.has(path)) gone.push(path); });
    }
    if (gone.length) await SB.storage.from('fotos').remove(gone);
  } catch (e) { console.warn(e); }
}
const pname = id => (A.d.products.find(p => p.id === id) || {}).name || '?';

function aRender() {
  nav.hidden = false;
  nav.innerHTML = TABS.map(([k, l]) => `<button data-a="a-tab" data-t="${k}" class="${A.tab === k ? 'on' : ''}">${l}</button>`).join('');
  app.innerHTML = ({ bon: vBon, regal: vRegal, einkauf: vEinkauf, kasse: vKasse, leute: vLeute })[A.tab]();
  window.scrollTo(0, 0);
}

function vBon() {
  const d = A.d, t = new Date(), ym = iso(t).slice(0, 7);
  const sum = (f, k) => d.journal.filter(f).reduce((a, j) => a + j[k], 0);
  const stand = sum(() => true, 'in_cents') - sum(() => true, 'out_cents');
  const saldi = {}; d.ledger.forEach(l => { saldi[l.person_id] = (saldi[l.person_id] || 0) + l.amount_cents; });
  const offen = Object.values(saldi).filter(v => v > 0).reduce((a, v) => a + v, 0);
  const guthaben = -Object.values(saldi).filter(v => v < 0).reduce((a, v) => a + v, 0);
  let fehl = '<span class="mut">vor dem Kassensturz zählen</span>';
  if (d.cash.length >= 2) { // erst ab dem zweiten Kassensturz gibt es einen Anfangspunkt
    const to = new Date(d.cash[0].at).getTime(), from = new Date(d.cash[1].at).getTime();
    const z = d.sales.filter(s => s.kind === 'zaehlung' && new Date(s.at) < to && new Date(s.at) >= from);
    if (z.length) {
      const diff = z.reduce((a, s) => a + s.cents, 0) - (d.cash[0].bar_cents ?? d.cash[0].cents);
      fehl = diff > 0 ? `<span class="neg">fehlen ${eur(diff)}</span>` : diff < 0 ? `mehr in der Kasse ${eur(-diff)}` : 'stimmt';
    }
  }
  const act = d.products.filter(p => p.active);
  const list = (ps, f) => ps.map(p => `<div class="it"><i class="lamp ${p.lamp}"></i><span>${esc(p.name)}</span><span>${p.stock} St</span><span>${f(p)}</span></div>`).join('');
  const red = act.filter(p => p.lamp === 'r'), yel = act.filter(p => p.lamp === 'y');
  const left = m => Math.ceil((pd(m.mhd) - t) / 864e5);
  const urgent = d.mhd.filter(m => left(m) < 14), soon = d.mhd.filter(m => left(m) >= 14 && left(m) <= 30);
  const mrow = (m, c) => `<div class="it"><i class="lamp ${c}"></i><span>${esc(pname(m.product_id))}</span><span>${m.qty ? m.qty + ' St' : ''}</span><span>${dshort(m.mhd)} · ${left(m) < 0 ? 'abgelaufen' : left(m) + ' T'}</span></div>`;
  const cheap = act.filter(p => p.cost_cents && p.price_cents < p.cost_cents);
  const wk = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][t.getDay()];
  return `<div class="paper">${head(`${wk} ${t.toLocaleDateString('de-DE')} · KW ${isoWeek(t)[1]}`)}
    ${ln('KASSENSTAND ' + ii('kasse'), eur(stand), 'big' + (stand < 0 ? ' neg' : ''))}
    ${ln('Einnahmen Monat', eur(sum(j => j.day.startsWith(ym), 'in_cents')))}
    ${ln('Ausgaben Monat', eur(sum(j => j.day.startsWith(ym), 'out_cents')))}
    ${ln('Offene Schuldscheine', eur(offen))}
    ${guthaben ? ln('Guthaben der Kollegen', eur(guthaben)) : ''}
    ${ln('Abgleich Ware/Kasse ' + ii('fehl'), fehl)}
    ${d.alerts.length ? '<hr><h2 class="neg">Hinweise</h2>' + d.alerts.map(a => `<div class="it"><i class="lamp r"></i><span>${esc(a.text)} <span class="mut">(${new Date(a.at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })})</span></span><span></span><span><button class="btn sm" data-a="a-seen" data-id="${a.id}">OK</button></span></div>`).join('') : ''}
    ${(() => { const a = d.set.kiosk_code_at ? Math.floor((t - pd(d.set.kiosk_code_at)) / 864e5) : 0;
      return a >= 30 ? `<hr><h2>QR-Code erneuern</h2><p class="small">Der QR-Code am Kiosk ist ${a} Tage alt. Unter Leute einen neuen erzeugen und den Aushang neu drucken.</p><div class="row"><button class="btn sm" data-a="a-tab" data-t="leute">Zu Leute</button></div>` : ''; })()}
    <hr><h2>Nachbestellen (${red.length}) ${ii('ampel')}</h2>${list(red, p => p.reachTxt) || '<p class="mut">Nichts.</p>'}
    ${(() => { const next3 = d.mhd.filter(m => left(m) >= 0).slice(0, 3);
      return next3.length ? `<hr><h2>Läuft als Nächstes ab ${ii('next3')}</h2>` + next3.map(m => `<div class="it"><i class="lamp ${left(m) < 14 ? 'r' : left(m) <= 30 ? 'y' : 'g'}"></i><span>${esc(pname(m.product_id))}</span><span>${m.qty ? m.qty + ' St' : ''}</span><span>${pd(m.mhd).toLocaleDateString('de-DE')}</span></div>`).join('') : ''; })()}
    ${yel.length ? `<hr><h2>Wird knapp (${yel.length})</h2>${list(yel, p => p.reachTxt)}` : ''}
    ${urgent.length ? `<hr><h2 class="neg">Läuft in 14 Tagen ab (${urgent.length}) ${ii('mhd')}</h2>` + urgent.map(m => mrow(m, 'r')).join('') : ''}
    ${soon.length ? `<hr><h2>Läuft in 30 Tagen ab (${soon.length}) ${ii('mhd')}</h2><p class="small mut">Zeit für einen Abverkaufspreis, falls noch viel da ist.</p>` + soon.map(m => mrow(m, 'y')).join('') : ''}
    ${cheap.length ? `<hr><h2>Unter Einkaufspreis (${cheap.length})</h2>` + cheap.map(p => `<div class="it"><i class="lamp y"></i><span>${esc(p.name)}</span><span>VK ${eur(p.price_cents)}</span><span>EK ${eur(p.cost_cents)}</span></div>`).join('') : ''}
    <hr>${ln('Im grünen Bereich', act.filter(p => p.lamp === 'g').length + ' Artikel')}
    ${act.length ? '' : '<p class="small mut">Noch kein Produkt ist aktiv. Trage unter Regal Preise ein und schalte Produkte frei.</p>'}
    </div>
    <div class="paper"><div class="row"><button class="btn pri" data-a="a-go" data-t="regal">Zählen</button><button class="btn" data-a="a-go" data-t="einkauf">Einkauf</button><button class="btn" data-a="a-go" data-t="leute">Einzahlung</button></div></div>
    <div class="paper"><h2>An Claude ${ii('claude')}</h2><p class="small mut">Verbesserung, Fehler oder Auftrag eintippen oder über das Mikrofon der Tastatur diktieren. Claude liest das beim nächsten Durchlauf.</p>
      ${d.requests.map(q => `<div class="it"><i class="lamp ${q.status === 'erledigt' ? 'g' : q.status === 'rueckfrage' ? 'r' : 'y'}"></i><span>${esc(q.text)}${q.answer ? `<br><span class="mut">Claude: ${esc(q.answer)}</span>` : ''}</span><span></span><span class="mut">${dshort(q.at.slice(0, 10))}</span></div>`).join('')}
      <div class="row"><button class="btn pri" data-a="a-req">Nachricht an Claude</button></div></div>
    <div class="paper"><h2>Sicherung ${ii('backup')}</h2>${(() => { const b = d.set.backup_at, age = b ? Math.floor((t - pd(b)) / 864e5) : null;
      return `<p class="small ${age === null || age > 14 ? 'neg' : 'mut'}">${age === null ? 'Du hast noch keine Sicherung heruntergeladen.' : `Letzte heruntergeladene Sicherung: ${dshort(b)} (${age === 0 ? 'heute' : age === 1 ? 'gestern' : 'vor ' + age + ' Tagen'}).`}${age === null || age > 14 ? ' Bitte jetzt sichern.' : ''}</p>`; })()}
      <p class="small mut">Speichert alle Kiosk-Daten als Datei auf dein Gerät, ohne PINs und ohne Kiosk-Code. Die Datei enthält Vornamen und Schuldenstände, also nicht weitergeben.</p>
      <div class="row"><button class="btn" data-a="a-backup">Sicherung herunterladen</button></div></div>`;
}

function vRegal() {
  const d = A.d, prop = A.job && A.job.result ? Object.fromEntries(A.job.result.map(x => [x.id, x.qty])) : {};
  const rows = d.products.filter(p => A.counting ? p.active : true).map(p => A.counting
    ? `<div class="it"><i class="lamp ${p.lamp}"></i><span>${esc(p.name)}</span><span class="mut">soll ${p.stock}${p.id in prop ? ' · Foto ' + prop[p.id] : ''}</span><span><input class="cnt" type="number" inputmode="numeric" min="0" data-cnt="${p.id}" value="${p.id in prop ? prop[p.id] : p.stock}" aria-label="Gezählt ${esc(p.name)}"></span></div>`
    : `<button class="it" data-a="a-prod" data-id="${p.id}"><i class="lamp ${p.active ? p.lamp : 'o'}"></i><span>${esc(p.name)}${p.active ? '' : ' <span class="mut">(aus)</span>'}${p.sale_cents != null ? ' <b class="neg">%</b>' : ''}</span><span>${p.stock} St · ${p.reachTxt}</span><span>${eur(p.price_cents)}</span></button>`).join('');
  return `<div class="paper"><h2>${A.counting ? 'Bestand zählen ' + ii('zaehlen') : 'Regal ' + ii('fotos')}</h2>
    <p class="small mut">${A.counting ? 'Trage ein, was wirklich im Regal steht. Die Differenz zum Soll zählt als Barverkauf oder Schwund.' + (A.job ? ' Die Felder sind mit dem Vorschlag aus dem Foto gefüllt' + (A.job.note ? ': ' + esc(A.job.note) : '.') : '') : 'Antippen zum Bearbeiten. Reichweite = Bestand ÷ Wochenverkauf der letzten 4 Wochen.'}</p>
    ${rows}
    <div class="row">${A.counting ? '<button class="btn" data-a="a-cnt-x">Abbrechen</button><button class="btn pri" data-a="a-cnt-ok">Zählung speichern</button>'
      : '<button class="btn pri" data-a="a-cnt">Zählen</button><button class="btn" data-a="a-foto">Fotos</button><button class="btn" data-a="a-prod" data-id="">Neues Produkt</button><button class="btn" data-a="a-print">Preisliste drucken</button>'}</div>
    ${A.counting ? '' : '<input type="file" id="foto" accept="image/*" multiple hidden>' + d.jobs.map(j => `<div class="it"><i class="lamp ${j.status === 'vorschlag' ? 'g' : 'y'}"></i><span>Foto vom ${dshort(j.at.slice(0, 10))}: ${j.status === 'vorschlag' ? 'Vorschlag liegt vor' : 'wartet auf Auswertung'}</span><span></span><span>${j.status === 'vorschlag' ? `<button class="btn sm" data-a="a-job" data-id="${j.id}">Prüfen</button>` : `<button class="btn sm" data-a="a-jobdel" data-id="${j.id}">Löschen</button>`}</span></div>`).join('')}</div>
    ${A.counting ? '' : `<div class="paper sheet printonly">${head('Preisliste · Stand ' + new Date().toLocaleDateString('de-DE'))}${(() => { const g = {}; d.products.filter(p => p.active).forEach(p => { (g[p.category] = g[p.category] || []).push(p); });
      return Object.keys(g).map(c => `<h2>${esc(c)}</h2>` + g[c].map(p => ln(esc(p.name), (p.sale_cents != null ? `<s>${eur(p.price_cents)}</s> ` : '') + eur(p.sale_cents ?? p.price_cents) + ' €')).join('')).join(''); })()}<hr><p class="small">Anschreiben per QR-Code oder bar in die Kasse.</p></div>
    <div class="paper"><h2>Wünsche der Kollegen ${ii('wuensche')}</h2>${d.wishes.length ? d.wishes.map(w => ({ ...w, n: (w.wish_votes[0] || {}).count || 0 })).sort((a, b) => b.n - a.n).map(w =>
      `<div class="it"><i></i><span>${esc(w.text)}</span><span class="mut">${w.n}×</span><span><button class="btn sm" data-a="a-wish" data-id="${w.id}">Erledigt</button></span></div>`).join('') : '<p class="mut">Noch keine Wünsche.</p>'}
      <p class="small mut">Gleiche Wünsche werden zusammengezählt. Namen werden nicht angezeigt.</p></div>
    <div class="paper"><h2>Ampel ${ii('ampel')}</h2>${ln('Rot unter', String(d.rot).replace('.', ',') + ' Wochen')}${ln('Gelb unter', String(d.gelb).replace('.', ',') + ' Wochen')}
      <div class="row"><button class="btn" data-a="a-amp">Schwellen ändern</button></div></div>`}`;
}

const prodOpts = () => A.d.products.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
const cartRow = (it = {}) => `<div class="cart"><select aria-label="Produkt"><option value="">Produkt …</option>${A.d.products.map(p => `<option value="${p.id}"${p.id === it.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
  <input type="number" inputmode="numeric" min="1" placeholder="Stk" aria-label="Stück" value="${it.qty || ''}"><input inputmode="decimal" placeholder="€ ges." aria-label="Preis gesamt in Euro" value="${it.cents != null ? eur(it.cents) : ''}">
  <input type="date" aria-label="Mindesthaltbarkeit" value="${esc(it.mhd || '')}"></div>`;

function vEinkauf() {
  const d = A.d, t = new Date(), dr = A.draft && A.draft.result ? A.draft.result : null;
  return `<div class="paper"><h2>Einkauf per Foto oder Ansage ${ii('einkauf')}</h2>
    <p class="small mut">Kassenbon fotografieren, Screenshot einer Bestellung hochladen oder einfach ansagen, was du wo gekauft hast. Claude macht daraus einen Vorschlag, den du hier nur noch prüfst.</p>
    <input type="file" id="bonfoto" accept="image/*" multiple hidden>
    <div class="row"><button class="btn pri" data-a="a-bon">Bon oder Screenshot</button><button class="btn pri" data-a="a-say">Einkauf ansagen</button></div>
    ${d.drafts.map(j => `<div class="it"><i class="lamp ${j.status === 'vorschlag' ? 'g' : 'y'}"></i><span>${dshort(j.at.slice(0, 10))} ${j.paths.length ? j.paths.length + ' Foto' + (j.paths.length === 1 ? '' : 's') : 'Ansage'}: ${j.status === 'vorschlag' ? 'Vorschlag liegt vor' : 'wartet auf Auswertung'}</span><span></span><span>${j.status === 'vorschlag' ? `<button class="btn sm" data-a="a-draft" data-id="${j.id}">Prüfen</button>` : `<button class="btn sm" data-a="a-draftdel" data-id="${j.id}">Löschen</button>`}</span></div>`).join('')}</div>
    <div class="paper"><h2>${dr ? 'Vorschlag prüfen' : 'Einkauf von Hand'}</h2>
    ${dr ? `<p class="small">Bitte Produkte, Stückzahlen und Preise prüfen und das Haltbarkeitsdatum ergänzen.${A.draft.note ? ' Hinweis von Claude: ' + esc(A.draft.note) : ''}</p>` : ''}
    <label for="eday">Datum</label><input id="eday" type="date" value="${esc(dr && dr.day ? dr.day : iso(t))}">
    <label for="estore">Laden</label><input id="estore" placeholder="z. B. Rewe" autocomplete="off" value="${esc(dr && dr.store ? dr.store : '')}">
    <p class="small mut">Je Zeile: Produkt, Stückzahl, Gesamtpreis, darunter das Haltbarkeitsdatum (optional).</p>
    <div id="cart">${dr && dr.items && dr.items.length ? dr.items.map(cartRow).join('') : cartRow() + cartRow()}</div>
    <div class="row"><button class="btn" data-a="a-cart">Zeile dazu</button><button class="btn pri" data-a="a-buy">Einkauf speichern</button></div></div>
    <div class="paper"><h2>Haltbarkeit ${ii('mhd')}</h2>${d.mhd.length ? d.mhd.map(m => { const days = Math.ceil((pd(m.mhd) - t) / 864e5); return `<div class="it"><i class="lamp ${days < 14 ? 'r' : days <= 30 ? 'y' : 'g'}"></i><span>${esc(pname(m.product_id))}${m.qty ? ' · ' + m.qty + ' St' : ''}</span><span>${dshort(m.mhd)} (${days < 0 ? 'abgelaufen' : days + ' T'})</span>
      <span><button class="btn sm" data-a="a-mhd" data-id="${m.id}" data-p="${m.product_id}" data-q="${m.qty}">…</button></span></div>`; }).join('') : '<p class="mut">Keine offenen Haltbarkeitsdaten.</p>'}</div>`;
}

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())), dn = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dn);
  const y = t.getUTCFullYear();
  return [y, Math.ceil(((t - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7)];
}
function buckets(span) {
  const m = new Map(), MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  A.d.journal.forEach(j => {
    const dt = pd(j.day); let key, label;
    if (span === 'week') { const [y, w] = isoWeek(dt); key = `${y}-${pad(w)}`; label = 'KW' + w; }
    else if (span === 'month') { key = j.day.slice(0, 7); label = MON[dt.getMonth()]; }
    else { key = j.day.slice(0, 4); label = key; }
    const b = m.get(key) || { key, label, i: 0, o: 0 };
    b.i += j.in_cents; b.o += j.out_cents; m.set(key, b);
  });
  return [...m.values()].sort((a, b) => a.key < b.key ? -1 : 1).slice(-12);
}
function chart(bs) {
  if (!bs.length) return '<p class="mut">Noch keine Buchungen.</p>';
  const W = 300, base = 96, top = 12, max = Math.max(...bs.map(b => Math.max(b.i, b.o)), 1), bw = W / bs.length, w = Math.min(11, bw * .36);
  const hh = v => (base - top) * v / max;
  return `<svg class="chart" viewBox="0 0 ${W} 112" role="img" aria-label="Einnahmen und Ausgaben"><text x="0" y="8">max ${eur(max)} €</text>
    <line x1="0" x2="${W}" y1="${base}" y2="${base}"/>${bs.map((b, n) => { const x = n * bw + bw / 2; return `<rect class="in" x="${(x - w - .5).toFixed(1)}" y="${(base - hh(b.i)).toFixed(1)}" width="${w.toFixed(1)}" height="${hh(b.i).toFixed(1)}"/>` +
      `<rect class="out" x="${(x + .5).toFixed(1)}" y="${(base - hh(b.o)).toFixed(1)}" width="${w.toFixed(1)}" height="${hh(b.o).toFixed(1)}"/><text x="${x.toFixed(1)}" y="108" text-anchor="middle">${esc(b.label)}</text>`; }).join('')}</svg>`;
}

function vKasse() {
  const d = A.d, bs = buckets(A.span);
  const sales = d.products.map(p => ({ n: p.name, u: d.sales.filter(s => s.product_id === p.id && s.kind !== 'verlust' && new Date(s.at) >= Date.now() - 28 * 864e5).reduce((a, s) => a + s.qty, 0) })).filter(x => x.u > 0).sort((a, b) => b.u - a.u);
  return `<div class="paper"><h2>Einnahmen und Ausgaben ${ii('kassensturz')}</h2>
    <div class="seg">${[['week', 'Woche'], ['month', 'Monat'], ['year', 'Jahr']].map(([k, l]) => `<button data-a="a-span" data-s="${k}" class="${A.span === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${chart(bs)}<p class="small mut">Schwarz: Einnahmen · Rot: Ausgaben</p>
    <table><tr><th>Zeitraum</th><th>Ein</th><th>Aus</th><th>Saldo</th></tr>${bs.slice().reverse().map(b => `<tr><td>${esc(A.span === 'year' ? b.label : b.label + ' ' + b.key.slice(2, 4))}</td><td>${eur(b.i)}</td><td>${eur(b.o)}</td><td class="${b.i - b.o < 0 ? 'neg' : ''}">${eur(b.i - b.o)}</td></tr>`).join('')}</table>
    <div class="row"><button class="btn pri" data-a="a-cash">Kassensturz</button><button class="btn" data-a="a-jour">Buchung von Hand</button></div></div>
    <div class="paper"><h2>Verkauf letzte 4 Wochen</h2>${sales.length ? sales.map(x => ln(esc(x.n), x.u + ' St')).join('') : '<p class="mut">Noch keine Verkaufsdaten. Sie entstehen durch QR-Buchungen und Zählungen.</p>'}</div>
    <div class="paper"><h2>Letzte Buchungen ${ii('storno')}</h2>${d.journal.slice(0, 25).map(j => `<div class="it"><i></i><span>${dshort(j.day)} ${esc(j.text)}</span><span>${(j.kind || j.source) === 'hand' || ((j.kind === 'bar' || j.kind === 'einkauf') && j.ref) ? `<button class="btn sm" data-a="a-storno" data-id="${j.id}">Storno</button>` : ''}</span><span class="${j.out_cents ? 'neg' : ''}">${j.out_cents ? '−' + eur(j.out_cents) : eur(j.in_cents)}</span></div>`).join('')}</div>`;
}

function vLeute() {
  const d = A.d, d30 = iso(new Date(Date.now() - 30 * 864e5));
  const ps = d.persons.map(p => {
    const l = d.ledger.filter(x => x.person_id === p.id);
    return { ...p, saldo: l.reduce((a, x) => a + x.amount_cents, 0), u30: l.filter(x => x.kind === 'kauf' && x.day >= d30).reduce((a, x) => a + x.amount_cents, 0), all: l.filter(x => x.kind === 'kauf').reduce((a, x) => a + x.amount_cents, 0) };
  });
  const url = location.origin + location.pathname + '?k=' + (d.set.kiosk_code || '');
  let qr = '';
  try { const q = qrcode(0, 'M'); q.addData(url); q.make(); qr = `<img src="${q.createDataURL(12, 4)}" alt="QR-Code für den Kiosk">`; } catch { qr = ''; }
  return `<div class="paper"><h2>Schuldscheine ${ii('schuldscheine')}</h2>${ps.length ? ps.slice().sort((a, b) => b.saldo - a.saldo).map(p =>
    `<div class="it pers"><i class="lamp ${p.locked_until && new Date(p.locked_until) > new Date() ? 'r' : p.consent_at ? 'g' : 'o'}"></i><span>${esc(p.vorname)}</span><span class="${p.saldo > 0 ? 'neg' : p.saldo < 0 ? 'pos' : 'mut'}">${p.saldo > 0 ? '−' : ''}${eur(Math.abs(p.saldo))}</span>
     <span class="acts"><button class="btn sm" data-a="a-pay" data-id="${p.id}">Einzahlung</button>${p.saldo < 0 ? ` <button class="btn sm" data-a="a-payout" data-id="${p.id}">Auszahlung</button>` : ''} <button class="btn sm" data-a="a-more" data-id="${p.id}">…</button></span></div>`).join('') : '<p class="mut">Noch niemand eingetragen.</p>'}
    <p class="small mut">Grün: hat zugestimmt · leer: noch nicht angemeldet · rot: gerade gesperrt</p>
    <div class="row"><button class="btn pri" data-a="a-person">Person eintragen</button><button class="btn" data-a="a-persons">Mehrere als Liste</button></div></div>
    <div class="paper"><h2>Rangliste Umsatz ${ii('rangliste')}</h2><table><tr><th>Vorname</th><th>30 Tage</th><th>Gesamt</th></tr>${ps.slice().sort((a, b) => b.u30 - a.u30 || b.all - a.all).map(p => `<tr><td>${esc(p.vorname)}</td><td>${eur(p.u30)}</td><td>${eur(p.all)}</td></tr>`).join('')}</table></div>
    <div class="paper poster sheet"><h2 class="noprint">QR-Code für den Kiosk ${ii('qr')}</h2><p class="small mut noprint">Aushängen oder auf einen NFC-Chip schreiben. Nur wer diesen Code hat, sieht die Namensliste. Zum Speichern lange auf den Code drücken und „In Fotos sichern“ wählen.</p>
      <div class="printonly"><p class="ctr"><span class="logo">KIOSK</span></p><p class="ctr">Anschreiben mit dem Handy</p></div>
      <div class="qr">${qr}</div>
      <div class="printonly"><p>1. Code mit der Kamera scannen</p><p>2. Vornamen antippen, PIN eingeben</p><p>3. Produkt antippen und anschreiben</p><p>Bar bezahlen geht weiterhin. Mitmachen ist freiwillig.</p></div>
      <p class="small brk noprint">${esc(url)}</p><details class="small noprint"><summary>Als App auf den Startbildschirm</summary> <p><b>iPhone:</b> Den Kiosk-Link oben in Safari öffnen (oder den QR-Code mit der Kamera scannen), unten auf Teilen tippen (Quadrat mit Pfeil nach oben), „Zum Home-Bildschirm“ wählen und bestätigen. Beim ersten Öffnen des neuen Symbols einmal neu anmelden.</p> <p><b>Android:</b> Den Kiosk-Link in Chrome öffnen, oben rechts auf die drei Punkte tippen, „Zum Startbildschirm hinzufügen“ oder „App installieren“ wählen und bestätigen.</p> <p class="mut">Das Symbol öffnet den Kiosk wie eine App. Installiert wird nichts.</p></details><div class="row noprint"><button class="btn pri" data-a="a-print">Aushang drucken</button><button class="btn" data-a="a-newcode">Neuen QR-Code erzeugen</button><button class="btn" data-a="a-copy" data-u="${esc(url)}">Link kopieren</button><button class="btn" data-a="a-out">Abmelden</button></div></div>`;
}

const reload = async () => { await aLoad(); aRender(); };
const aActs = {
  'a-tab': el => { A.tab = el.dataset.t; A.counting = false; A.job = null; A.draft = null; aRender(); },
  'a-req': async () => {
    const v = await ask('Nachricht an Claude', [{ k: 't', label: 'Was soll besser werden oder erledigt werden?', type: 'area' }], 'Abschicken');
    if (!v || !v.t.trim()) return;
    ok(await SB.from('requests').insert({ text: v.t.trim().slice(0, 2000) })); toast('Gespeichert. Claude liest es beim nächsten Durchlauf.'); await reload();
  },
  'a-foto': () => { $('#foto').click(); },
  'a-job': el => { A.job = A.d.jobs.find(j => j.id === el.dataset.id); A.counting = true; aRender(); },
  'a-jobdel': async el => { const j = A.d.jobs.find(x => x.id === el.dataset.id); await SB.storage.from('fotos').remove(j.paths); ok(await SB.from('photo_jobs').delete().eq('id', j.id)); await reload(); },
  'a-persons': async () => {
    const v = await ask('Mehrere Personen eintragen', [{ k: 't', label: 'Vornamen, getrennt durch Komma, „und“ oder neue Zeile. Diktieren geht über das Mikrofon der Tastatur.', type: 'area' }], 'Anlegen');
    if (!v) return;
    const names = [...new Set(v.t.split(/[,;.\n]+|\s+und\s+|\s+/i).map(x => x.trim()).filter(x => x.length > 1).map(x => x[0].toUpperCase() + x.slice(1)))];
    if (!names.length) return;
    const made = await rpc('a_persons', { p_names: names });
    await reload();
    if (!made.length) return toast('Niemand angelegt: Alle Namen gibt es schon.');
    modal.innerHTML = `<div class="paper"><h2>${made.length} angelegt</h2><p class="small">Die Start-PINs stehen nur jetzt hier. Notiere sie und gib sie persönlich weiter. Jeder kann seine PIN danach selbst ändern.</p>${made.map(m => ln(esc(m.vorname), esc(m.pin), 'big')).join('')}<div class="row"><button class="btn pri" data-a="m-close">Notiert, schließen</button></div></div>`;
    modal.hidden = false;
  },
  'a-go': el => { A.tab = el.dataset.t; A.counting = el.dataset.t === 'regal'; aRender(); },
  'a-span': el => { A.span = el.dataset.s; aRender(); },
  'a-out': async () => { await SB.auth.signOut(); location.hash = '#verwaltung'; location.reload(); },
  'a-signup': async () => {
    const email = $('#em').value.trim(), password = $('#pw').value;
    if (!email || password.length < 10) return toast('E-Mail eintragen und ein Passwort mit mindestens 10 Zeichen wählen.');
    const { data, error } = await SB.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname + '#verwaltung' } });
    if (error) return toast('Konto konnte nicht angelegt werden: ' + error.message);
    if (data.session) return aBoot(data.session);
    toast('Konto angelegt. Öffne den Link in der Bestätigungs-Mail und melde dich dann hier an.');
  },
  'a-seen': async el => { ok(await SB.from('alerts').update({ seen: true }).eq('id', el.dataset.id)); await reload(); },
  'a-cnt': () => { A.counting = true; aRender(); },
  'a-cnt-x': () => { A.counting = false; A.job = null; aRender(); },
  'a-cnt-ok': async () => {
    const items = [...document.querySelectorAll('[data-cnt]')].map(i => ({ id: i.dataset.cnt, qty: Math.max(0, parseInt(i.value, 10) || 0) }));
    await rpc('a_count', { p_items: items });
    if (A.job) { await SB.storage.from('fotos').remove(A.job.paths); ok(await SB.from('photo_jobs').update({ status: 'fertig', paths: [] }).eq('id', A.job.id)); A.job = null; }
    A.counting = false; toast('Zählung gespeichert.'); await reload();
  },
  'a-prod': async el => {
    const p = A.d.products.find(x => x.id === el.dataset.id) || { name: '', category: 'Sonstiges', price_cents: 0, sale_cents: null, active: true };
    const v = await ask(p.id ? 'Produkt bearbeiten' : 'Neues Produkt', [
      { k: 'name', label: 'Name', value: p.name }, { k: 'cat', label: 'Gruppe', value: p.category },
      { k: 'price', label: 'Verkaufspreis €', value: p.price_cents ? eur(p.price_cents) : '', mode: 'decimal' },
      { k: 'sale', label: 'Abverkaufspreis € (leer = keiner)', value: p.sale_cents != null ? eur(p.sale_cents) : '', mode: 'decimal' },
      { k: 'active', label: 'Im Kiosk sichtbar', type: 'select', value: p.active ? '1' : '0', options: p.id ? [['1', 'Ja'], ['0', 'Nein'], ['del', 'Endgültig löschen …']] : [['1', 'Ja'], ['0', 'Nein']] }],
      'Speichern', p.cost_cents ? `<p class="small mut">Letzter Einkaufspreis: ${eur(p.cost_cents)} € je Stück</p>` : '');
    if (!v) return;
    if (v.active === 'del') {
      const sure = await ask(p.name + ' endgültig löschen?', [], 'Endgültig löschen',
        '<p>Das Produkt verschwindet samt Bestand, Verkaufszahlen, Zählungen und Haltbarkeitsdaten. Das lässt sich nicht rückgängig machen. Einnahmen und Ausgaben unter Kasse und die Schuldscheine bleiben unverändert.</p>');
      if (!sure) return;
      ok(await SB.from('products').delete().eq('id', p.id)); toast(p.name + ' gelöscht.'); return reload();
    }
    if (!v.name.trim()) return;
    const price = cents(v.price) || 0;
    if (v.active === '1' && price <= 0) return toast('Sichtbare Produkte brauchen einen Verkaufspreis.');
    const row = { name: v.name.trim(), category: v.cat.trim() || 'Sonstiges', price_cents: price, sale_cents: cents(v.sale), active: v.active === '1' };
    ok(p.id ? await SB.from('products').update(row).eq('id', p.id) : await SB.from('products').insert(row));
    await reload();
  },
  'a-wish': async el => { ok(await SB.from('wishes').update({ done: true }).eq('id', el.dataset.id)); await reload(); },
  'a-amp': async () => {
    const v = await ask('Ampel-Schwellen', [{ k: 'r', label: 'Rot, wenn der Bestand weniger als … Wochen reicht', value: A.d.rot, mode: 'decimal' }, { k: 'g', label: 'Gelb, wenn weniger als … Wochen', value: A.d.gelb, mode: 'decimal' }]);
    if (!v) return;
    const r = Number(String(v.r).replace(',', '.')), g = Number(String(v.g).replace(',', '.'));
    if (!(r > 0 && g > r)) return toast('Gelb muss größer als Rot sein.');
    ok(await SB.from('settings').upsert([{ key: 'rot', value: String(r) }, { key: 'gelb', value: String(g) }])); await reload();
  },
  'a-bon': () => { $('#bonfoto').click(); },
  'a-say': async () => {
    const v = await ask('Einkauf ansagen', [{ k: 't', label: 'Was hast du wo gekauft? Zum Beispiel: „Heute bei Rewe 12 Cola für 9,48, 6 Twix für 3,90, haltbar bis April.“ Diktieren geht über das Mikrofon der Tastatur.', type: 'area' }], 'Abschicken');
    if (!v || !v.t.trim()) return;
    ok(await SB.from('photo_jobs').insert({ paths: [], kind: 'einkauf', text: v.t.trim().slice(0, 2000) })); toast('Gespeichert. Der Vorschlag erscheint hier nach der Auswertung.'); await reload();
  },
  'a-draft': el => { A.draft = A.d.drafts.find(j => j.id === el.dataset.id); aRender(); },
  'a-draftdel': async el => { const j = A.d.drafts.find(x => x.id === el.dataset.id); if (j.paths.length) await SB.storage.from('fotos').remove(j.paths); ok(await SB.from('photo_jobs').delete().eq('id', j.id)); await reload(); },
  'a-cart': () => { $('#cart').insertAdjacentHTML('beforeend', cartRow()); },
  'a-buy': async () => {
    const items = [];
    for (const row of document.querySelectorAll('#cart .cart')) {
      const [sel, q, e, m] = row.querySelectorAll('select,input');
      if (!sel.value) { if (q.value || e.value) return toast('In einer Zeile mit Stückzahl oder Preis fehlt das Produkt. Bitte auswählen oder die Zeile leeren.'); continue; }
      const qty = parseInt(q.value, 10), c = cents(e.value);
      if (!(qty > 0) || c === null) return toast('Bitte Stückzahl und Gesamtpreis für jede Zeile eintragen.');
      items.push({ id: sel.value, qty, cents: c, mhd: m.value || '' });
    }
    if (!items.length) return toast('Mindestens ein Produkt auswählen.');
    await rpc('a_purchase', { p_day: $('#eday').value, p_store: $('#estore').value.trim(), p_items: items });
    if (A.draft) { if (A.draft.paths.length) await SB.storage.from('fotos').remove(A.draft.paths); ok(await SB.from('photo_jobs').update({ status: 'fertig', paths: [] }).eq('id', A.draft.id)); A.draft = null; }
    toast('Einkauf gespeichert.'); await reload();
  },
  'a-mhd': async el => {
    const v = await ask(pname(el.dataset.p), [{ k: 'a', label: 'Was ist passiert?', type: 'select', options: [['sale', 'Reduziert anbieten'], ['done', 'Verkauft, Hinweis erledigt'], ['waste', 'Entsorgt (als Verlust buchen)']] },
      { k: 'x', label: 'Abverkaufspreis € bzw. entsorgte Stückzahl', value: '', mode: 'decimal' }], 'Übernehmen');
    if (!v) return;
    if (v.a === 'sale') { const c = cents(v.x); if (!(c > 0)) return toast('Bitte einen Abverkaufspreis eintragen.'); ok(await SB.from('products').update({ sale_cents: c }).eq('id', el.dataset.p)); }
    else {
      if (v.a === 'waste') { const n = parseInt(v.x, 10) || Number(el.dataset.q); if (!(n > 0)) return toast('Bitte die entsorgte Stückzahl eintragen.'); await rpc('a_waste', { p_product: el.dataset.p, p_qty: n }); }
      ok(await SB.from('purchase_items').update({ mhd_done: true }).eq('id', el.dataset.id));
      ok(await SB.from('products').update({ sale_cents: null }).eq('id', el.dataset.p));
    }
    await reload();
  },
  'a-cash': async () => {
    const v = await ask('Kassensturz', [{ k: 'c', label: 'Wie viel Geld war in der Kasse? (€)', mode: 'decimal' }], 'Buchen',
      '<p class="small mut">Kasse leeren, alles zählen und den Betrag eintragen. Einzahlungen und Auszahlungen seit dem letzten Kassensturz rechnet die App heraus; der Rest zählt als Barverkauf. Wie oft du das machst, ist egal.</p>');
    const c = v ? cents(v.c) : null; if (c === null || c < 0) return;
    const r = await rpc('a_cash_box', { p_cents: c }) || { paid: 0, bar: c };
    await reload();
    if (r.bar < 0) await ask('Achtung: Es fehlt Geld', [], 'Verstanden', `<p>In der Kasse waren ${eur(c)} €. Seit dem letzten Kassensturz sind aber ${eur(r.paid)} € aus Einzahlungen (abzüglich Auszahlungen) in die Kasse gekommen.</p><p class="big neg">Es fehlen ${eur(-r.bar)} €.</p><p class="small mut">Als Barverkauf wurden 0,00 € gebucht. Prüfe, ob eine Zahlung nicht in die Kasse gelegt oder doppelt gebucht wurde.</p>`);
    else toast(`Gebucht: ${eur(r.bar)} € Barverkäufe` + (r.paid > 0 ? `, ${eur(r.paid)} € stammen aus Einzahlungen.` : r.paid < 0 ? `, ${eur(-r.paid)} € Auszahlungen sind eingerechnet.` : '.'));
  },
  'a-storno': async el => {
    const j = A.d.journal.find(x => x.id === el.dataset.id);
    const sure = await ask('Buchung stornieren?', [], 'Stornieren', `<p>${dshort(j.day)} ${esc(j.text)}: ${j.out_cents ? '−' + eur(j.out_cents) : eur(j.in_cents)} €</p><p class="small mut">${j.kind === 'einkauf' ? 'Der Einkauf wird entfernt und der Bestand um die gekauften Stücke verringert.' : j.kind === 'bar' ? 'Der Kassensturz wird entfernt. Danach kannst du ihn neu buchen.' : 'Die Buchung wird entfernt.'}</p>`);
    if (!sure) return;
    const r = await rpc('a_storno', { p_journal: j.id });
    toast(r === 'ok' ? 'Storniert.' : r === 'nicht_letzter' ? 'Nur der letzte Kassensturz lässt sich stornieren.' : 'Diese Buchung lässt sich nicht stornieren.');
    await reload();
  },
  'a-jour': async () => {
    const v = await ask('Buchung von Hand', [{ k: 'd', label: 'Datum', type: 'date', value: iso(new Date()) }, { k: 't', label: 'Text' }, { k: 'i', label: 'Einnahme €', mode: 'decimal' }, { k: 'o', label: 'Ausgabe €', mode: 'decimal' }]);
    if (!v || !v.t.trim()) return;
    ok(await SB.from('journal').insert({ day: v.d, text: v.t.trim(), in_cents: cents(v.i) || 0, out_cents: cents(v.o) || 0, source: 'hand', kind: 'hand' })); await reload();
  },
  'a-person': async () => {
    const v = await ask('Person eintragen', [{ k: 'n', label: 'Vorname (nur Vorname)' }, { k: 'p', label: 'Start-PIN (4 Ziffern, persönlich übergeben)', mode: 'numeric', max: 4 }]);
    if (!v || !v.n.trim()) return;
    if (!/^\d{4}$/.test(v.p)) return toast('Die PIN braucht genau 4 Ziffern.');
    await rpc('a_person', { p_vorname: v.n.trim().split(/\s+/)[0], p_pin: v.p }); await reload();
  },
  'a-pay': async el => {
    const p = A.d.persons.find(x => x.id === el.dataset.id);
    const saldoNow = async () => (await pages(() => SB.from('ledger').select('amount_cents').eq('person_id', p.id).order('id'))).data.reduce((a, l) => a + l.amount_cents, 0);
    const saldo = await saldoNow();
    const v = await ask('Einzahlung von ' + p.vorname, [{ k: 'c', label: 'Erhaltener Betrag €', mode: 'decimal' }], 'Einzahlung buchen',
      `<p class="small">${saldo > 0 ? `Offen: ${eur(saldo)} €. Alles darüber wird Guthaben.` : saldo < 0 ? `Vorhandenes Guthaben: ${eur(-saldo)} €. Der Betrag kommt dazu.` : 'Nichts offen. Der Betrag wird Guthaben.'}</p>`);
    const c = v && cents(v.c); if (!c || c <= 0) return;
    await rpc('a_pay', { p_person: p.id, p_cents: c });
    const neu = await saldoNow();
    toast(neu < 0 ? `Gebucht. ${p.vorname} hat jetzt ${eur(-neu)} € Guthaben.` : neu > 0 ? `Gebucht. Noch offen: ${eur(neu)} €.` : 'Gebucht. Schuldschein ist ausgeglichen.');
    await reload();
  },
  'a-payout': async el => {
    const p = A.d.persons.find(x => x.id === el.dataset.id);
    const saldo = (await pages(() => SB.from('ledger').select('amount_cents').eq('person_id', p.id).order('id'))).data.reduce((a, l) => a + l.amount_cents, 0);
    if (saldo >= 0) { toast(p.vorname + ' hat kein Guthaben.'); return reload(); }
    const v = await ask('Auszahlung an ' + p.vorname, [{ k: 'c', label: 'Ausgezahlter Betrag €', mode: 'decimal', value: eur(-saldo) }], 'Auszahlung buchen',
      `<p class="small">Guthaben: ${eur(-saldo)} €. Mehr lässt sich nicht auszahlen. Das Geld kommt aus der Kioskkasse.</p>`);
    const c = v && cents(v.c); if (!c || c <= 0) return;
    const r = await rpc('a_payout', { p_person: p.id, p_cents: c });
    toast(r === 'ok' ? `Ausgezahlt: ${eur(c)} €.` : r === 'zu_viel' ? 'Nicht gebucht: Der Betrag ist höher als das Guthaben.' : 'Nicht gebucht.');
    await reload();
  },
  'a-more': async el => {
    const p = A.d.persons.find(x => x.id === el.dataset.id);
    const v = await ask(p.vorname, [{ k: 'a', label: 'Aktion', type: 'select', options: [['', 'Bitte wählen …'],
        ['schuld', 'Schulden übertragen (z. B. vom Papier-Schuldschein)'], ['guthaben', 'Guthaben übertragen (schon früher bezahlt)'],
        ['pin', 'Neue PIN setzen (hebt Sperre auf)'], ['del', 'Person löschen (nur bei 0,00 €)']] },
      { k: 'x', label: 'Betrag in € (ohne Vorzeichen) bzw. neue PIN', mode: 'decimal' }], 'Ausführen',
      '<p class="small mut">Übertragen ändert nur den Schuldschein, nicht die Kasse. Gibt dir jemand jetzt Geld, nimm stattdessen „Einzahlung“.</p>');
    if (!v) return;
    if (!v.a) return toast('Bitte zuerst eine Aktion wählen.');
    if (v.a === 'pin') { if (!/^\d{4}$/.test(v.x)) return toast('Die PIN braucht genau 4 Ziffern.'); await rpc('a_pin', { p_person: p.id, p_pin: v.x }); toast('Neue PIN gesetzt.'); }
    else if (v.a === 'schuld' || v.a === 'guthaben') {
      const c = Math.abs(cents(v.x) || 0); if (!c) return toast('Bitte einen Betrag eintragen, z. B. 7,50.');
      if (c >= 2000 && !(await ask(`${eur(c)} € ${v.a === 'schuld' ? 'Schulden' : 'Guthaben'} für ${p.vorname}?`, [], 'Ja, eintragen', '<p>Das ist ein ungewöhnlich hoher Betrag. Bitte prüfen, ob du dich nicht vertippt hast.</p>'))) return;
      await rpc('a_fix', { p_person: p.id, p_cents: v.a === 'schuld' ? c : -c });
      toast(v.a === 'schuld' ? `${eur(c)} € Schulden für ${p.vorname} eingetragen.` : `${eur(c)} € Guthaben für ${p.vorname} eingetragen.`);
    }
    else toast(await rpc('a_person_delete', { p_person: p.id }) ? 'Person gelöscht.' : 'Nicht gelöscht: Der Schuldschein ist nicht ausgeglichen.');
    await reload();
  },
  'a-print': () => { window.print(); },
  'a-newcode': async () => {
    const sure = await ask('Neuen QR-Code erzeugen?', [], 'Neuen Code erzeugen', '<p>Der bisherige QR-Code und sein Link werden sofort ungültig. Wer schon angemeldet ist, bleibt angemeldet. Für neue Anmeldungen musst du den Aushang neu drucken.</p>');
    if (!sure) return;
    const code = [...crypto.getRandomValues(new Uint8Array(8))].map(x => x.toString(16).padStart(2, '0')).join('');
    ok(await SB.from('settings').upsert([{ key: 'kiosk_code', value: code }, { key: 'kiosk_code_at', value: iso(new Date()) }]));
    toast('Neuer QR-Code erzeugt. Bitte den Aushang neu drucken.'); await reload();
  },
  'a-backup': async () => {
    toast('Sicherung wird erstellt …');
    const all = async (table, cols = '*') => {
      const out = [];
      for (let from = 0; ; from += 1000) {
        let q = SB.from(table).select(cols);
        q = table === 'settings' ? q.order('key') : table === 'wish_votes' ? q.order('wish_id').order('person_id') : q.order('id');
        const rows = ok(await q.range(from, from + 999));
        out.push(...rows); if (rows.length < 1000) return out;
      }
    };
    const data = { erstellt: new Date().toISOString() };
    for (const tb of ['products', 'sales', 'ledger', 'journal', 'purchases', 'purchase_items', 'counts', 'cash_counts', 'alerts', 'requests', 'wishes', 'wish_votes', 'photo_jobs']) data[tb] = await all(tb);
    data.persons = await all('persons', 'id,vorname,consent_at,active,created_at');
    data.settings = (await all('settings')).filter(x => x.key !== 'kiosk_code' && x.key !== 'setup_code');
    const name = `kiosk-sicherung-${iso(new Date())}.json`;
    const file = new File([JSON.stringify(data, null, 1)], name, { type: 'application/json' });
    let saved = false;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); saved = true; } catch (e) { if (e.name === 'AbortError') return toast('Sicherung abgebrochen.'); }
    }
    if (!saved) {
      const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    }
    ok(await SB.from('settings').upsert({ key: 'backup_at', value: iso(new Date()) }));
    toast('Sicherung erstellt. Auf dem iPhone „In Dateien sichern“ wählen.'); await reload();
  },
  'a-copy': async el => { try { await navigator.clipboard.writeText(el.dataset.u); toast('Link kopiert.'); } catch { toast('Kopieren nicht möglich, bitte den Link markieren.'); } }
};

/* ---------------- Start ---------------- */
function landing(msg) {
  nav.hidden = true;
  app.innerHTML = `<div class="paper">${head('Selbstbedienung')}<p>${esc(msg || 'Bitte den QR-Code am Kiosk scannen, um anzuschreiben.')}</p>
    <hr><div class="row"><button class="btn sm" data-a="go-admin">Verwaltung</button></div></div>`;
}
let busy = false;
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-a]'); if (!el) return;
  const a = el.dataset.a;
  if (a === 'm-x') return modalDone && modalDone(null);
  if (a === 'm-close') { modal.hidden = true; modal.innerHTML = ''; return; }
  if (a === 'info') { modal.innerHTML = `<div class="paper"><p>${esc(INFO[el.dataset.k] || '')}</p><div class="row"><button class="btn pri" data-a="m-close">OK</button></div></div>`; modal.hidden = false; return; }
  if (a === 'go-admin') { location.hash = '#verwaltung'; return aLoginScreen(); }
  const fn = kActs[a] || aActs[a]; if (!fn) return;
  if (['a-tab', 'a-go', 'a-span'].includes(a)) return fn(el); // Wechsel zwischen Bereichen geht immer sofort
  if (busy) return toast('Einen Moment, die letzte Eingabe wird noch gespeichert …');
  busy = true;
  try { await fn(el); } catch (err) { console.error(err); toast(err.code === '23505' ? 'Diesen Namen gibt es schon.' : 'Das hat nicht geklappt: ' + (err.message || 'Fehler')); }
  busy = false;
});
async function shrink(file) {
  const bmp = await createImageBitmap(file), k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
}
document.addEventListener('change', async e => {
  if (!['foto', 'bonfoto'].includes(e.target.id) || !e.target.files.length) return;
  const kind = e.target.id === 'bonfoto' ? 'einkauf' : 'foto';
  try {
    toast('Fotos werden hochgeladen …');
    const paths = [];
    const files = [...e.target.files].slice(0, 60);
    for (const f of files) {
      toast(`Foto ${paths.length + 1} von ${files.length} wird hochgeladen …`);
      const path = `${kind}/${crypto.randomUUID()}.jpg`;
      ok(await SB.storage.from('fotos').upload(path, await shrink(f), { contentType: 'image/jpeg' }));
      paths.push(path);
    }
    ok(await SB.from('photo_jobs').insert({ paths, kind }));
    const total = e.target.files.length;
    toast(total > paths.length ? `${paths.length} von ${total} Fotos gespeichert, mehr als 60 auf einmal gehen nicht. Den Rest bitte danach hochladen.` : `${paths.length} Foto${paths.length === 1 ? '' : 's'} gespeichert. Der Vorschlag erscheint hier nach der Auswertung.`);
    await reload();
  } catch (err) { console.error(err); toast('Hochladen hat nicht geklappt: ' + (err.message || 'Fehler')); }
});
(async function boot() {
  try {
    const u = new URL(location.href), k = u.searchParams.get('k');
    if (k) LS.set('kcode', k);
    const { data: { session } } = await SB.auth.getSession();
    if (!k && (session || /verwaltung|access_token/.test(location.hash))) return await aBoot(session);
    K.code = LS.get('kcode');
    if (!K.code) return landing();
    await kBoot();
  } catch (err) { console.error(err); landing('Die App erreicht die Datenbank gerade nicht. Bitte später erneut versuchen.'); }
})();
window.addEventListener('hashchange', () => { if (/verwaltung/.test(location.hash) && nav.hidden && !$('#alog')) location.reload(); });
