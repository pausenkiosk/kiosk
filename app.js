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
  s = String(s ?? '').trim().replace(/[€\s]/g, '');
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
const K = { code: null, token: null, names: null, sel: null, st: null };

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
      app.innerHTML = `<div class="paper">${head('Schuldschein')}<h2>Wer bist du?</h2>` +
        (K.names.length ? `<div class="namegrid">${K.names.map(n => `<button class="btn" data-a="k-sel" data-id="${n.id}" data-n="${esc(n.vorname)}">${esc(n.vorname)}</button>`).join('')}</div>`
          : '<p>Es ist noch niemand eingetragen. Sprich den Betreiber an.</p>') +
        '<hr><p class="small mut">Du stehst nicht in der Liste? Dann zahlst du bar oder lässt dich vom Betreiber eintragen.</p></div>';
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
  s.products.forEach(p => { (cats[p.cat] = cats[p.cat] || []).push(p); });
  const prod = Object.keys(cats).map(c => `<h2>${esc(c)}</h2>` + cats[c].map(p =>
    `<button class="it" data-a="k-buy" data-id="${p.id}"><i class="lamp ${p.stock > 0 ? 'g' : 'o'}"></i><span>${esc(p.name)}${p.sale ? ' <b class="neg">Abverkauf</b>' : ''}</span>` +
    `<span>${p.sale ? `<s>${eur(p.normal)}</s>` : ''}</span><span>${eur(p.cents)} €</span></button>`).join('')).join('');
  app.innerHTML = `<div class="paper">${head('Schuldschein von ' + esc(s.vorname))}
      ${ln(s.saldo < 0 ? 'DEIN GUTHABEN' : 'OFFEN', eur(Math.abs(s.saldo)) + ' €', 'big')}
      <p class="small mut">Bezahlen: Betrag dem Betreiber geben, er trägt die Zahlung ein.</p></div>
    <div class="paper"><h2>Anschreiben</h2><p class="small mut">Produkt antippen. Leeres Kästchen: laut Bestand gerade aus.</p>${prod || '<p>Noch keine Produkte freigeschaltet.</p>'}</div>
    <div class="paper"><h2>Deine Buchungen</h2>${s.entries.length ? s.entries.map(e =>
      `<div class="it"><i></i><span>${dshort(e.day)} ${e.kind === 'zahlung' ? 'Zahlung' : e.kind === 'korrektur' ? 'Korrektur' : 'Kauf'}</span>` +
      `<span>${e.undo ? `<button class="btn sm" data-a="k-undo" data-id="${e.id}">Rückgängig</button>` : ''}</span><span>${e.cents > 0 ? '' : '−'}${eur(Math.abs(e.cents))}</span></div>`).join('')
      : '<p class="mut">Noch nichts gebucht.</p>'}</div>
    <div class="paper"><h2>Wunschliste</h2><p class="small mut">Was fehlt im Kiosk? Antippen zählt als Stimme.</p>${s.wishes.map(w =>
      `<button class="it" data-a="k-vote" data-id="${w.id}"><i class="lamp ${w.mine ? 'g' : 'o'}"></i><span>${esc(w.text)}</span><span></span><span>${w.votes}</span></button>`).join('')}
      <div class="row"><button class="btn" data-a="k-wish">Wunsch eintragen</button></div></div>
    <div class="paper"><div class="row"><button class="btn" data-a="k-pin">PIN ändern</button><button class="btn" data-a="k-logout">Abmelden</button></div></div>`;
}

async function kLogin(e) {
  e.preventDefault();
  const r = await rpc('k_login', { p_code: K.code, p_person: K.sel.id, p_pin: $('#pin').value });
  if (r.ok) { K.token = r.token; LS.set('ktoken', r.token); K.sel = null; return kBoot(); }
  if (r.err === 'pin') toast(`Falsche PIN. Noch ${r.rest} Versuch${r.rest === 1 ? '' : 'e'}.`);
  else if (r.err === 'gesperrt') toast('Gesperrt bis ' + new Date(r.bis).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr.');
  else toast('Anmeldung nicht möglich.');
  $('#pin').value = '';
}
const kReload = async () => { K.st = await rpc('k_state', { p_token: K.token }); if (!K.st) { LS.del('ktoken'); K.token = null; return kBoot(); } kRender(); };

const kActs = {
  'k-sel': el => { K.sel = { id: el.dataset.id, n: el.dataset.n }; kRender(); },
  'k-back': () => { K.sel = null; kRender(); },
  'k-consent': async () => { await rpc('k_consent', { p_token: K.token }); await kReload(); },
  'k-logout': async () => { await rpc('k_logout', { p_token: K.token }); LS.del('ktoken'); K.token = null; K.st = null; await kBoot(); },
  'k-buy': async el => {
    const p = K.st.products.find(x => x.id === el.dataset.id);
    const v = await ask(p.name, [{ k: 'qty', label: `Anzahl (je ${eur(p.cents)} €)`, type: 'select', options: [1, 2, 3, 4, 5].map(n => [n, `${n} × = ${eur(n * p.cents)} €`]) }], 'Anschreiben');
    if (!v) return;
    const r = await rpc('k_buy', { p_token: K.token, p_product: p.id, p_qty: Number(v.qty) });
    toast(r.ok ? `${p.name} angeschrieben. 5 Minuten lang rückgängig möglich.` : 'Buchung nicht möglich.');
    await kReload();
  },
  'k-undo': async el => { const r = await rpc('k_undo', { p_token: K.token, p_entry: el.dataset.id }); toast(r.ok ? 'Buchung zurückgenommen.' : 'Zu spät, bitte den Betreiber ansprechen.'); await kReload(); },
  'k-vote': async el => { await rpc('k_vote', { p_token: K.token, p_wish: el.dataset.id }); await kReload(); },
  'k-wish': async () => { const v = await ask('Wunsch eintragen', [{ k: 't', label: 'Welches Produkt fehlt dir?', max: 60 }], 'Eintragen'); if (v && v.t.trim()) { await rpc('k_wish', { p_token: K.token, p_text: v.t }); await kReload(); } },
  'k-pin': async () => {
    const v = await ask('PIN ändern', [{ k: 'o', label: 'Alte PIN', type: 'password', mode: 'numeric', max: 4 }, { k: 'n', label: 'Neue PIN (4 Ziffern)', type: 'password', mode: 'numeric', max: 4 }]);
    if (!v) return;
    toast(await rpc('k_pin', { p_token: K.token, p_old: v.o, p_new: v.n }) ? 'PIN geändert.' : 'Nicht geändert: alte PIN falsch oder neue PIN keine 4 Ziffern.');
  }
};

/* ---------------- Verwalter ---------------- */
const A = { tab: 'bon', d: null, counting: false, span: 'month', job: null };
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
  await aLoad(); aRender();
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

async function aLoad() {
  const since = new Date(Date.now() - 90 * 864e5).toISOString();
  const r = await Promise.all([
    SB.from('products').select('*').order('category').order('name'),
    SB.from('sales').select('product_id,qty,cents,kind,at').gte('at', since),
    SB.from('journal').select('day,text,in_cents,out_cents').order('day', { ascending: false }),
    SB.from('ledger').select('person_id,amount_cents,kind,day'),
    SB.from('persons').select('id,vorname,consent_at,locked_until,active').order('vorname'),
    SB.from('purchase_items').select('id,qty,mhd,product_id').eq('mhd_done', false).not('mhd', 'is', null).order('mhd'),
    SB.from('alerts').select('id,at,text').eq('seen', false).order('at', { ascending: false }),
    SB.from('cash_counts').select('day,cents').order('day', { ascending: false }).limit(2),
    SB.from('wishes').select('id,text,wish_votes(count)').eq('done', false),
    SB.from('settings').select('key,value'),
    SB.from('requests').select('id,at,text,status,answer').order('at', { ascending: false }).limit(6),
    SB.from('photo_jobs').select('id,at,paths,status,result,note').neq('status', 'fertig').order('at', { ascending: false })
  ]).then(a => a.map(ok));
  const set = Object.fromEntries(r[9].map(x => [x.key, x.value]));
  A.d = { products: r[0], sales: r[1], journal: r[2], ledger: r[3], persons: r[4], mhd: r[5], alerts: r[6], cash: r[7], wishes: r[8], set, requests: r[10], jobs: r[11],
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
  const offen = d.ledger.reduce((a, l) => a + l.amount_cents, 0);
  let fehl = '–';
  if (d.cash.length) {
    const to = pd(d.cash[0].day).getTime() + 864e5, from = d.cash[1] ? pd(d.cash[1].day).getTime() + 864e5 : 0;
    const ware = d.sales.filter(s => s.kind === 'zaehlung' && new Date(s.at) < to && new Date(s.at) >= from).reduce((a, s) => a + s.cents, 0);
    fehl = eur(ware - d.cash[0].cents);
  }
  const act = d.products.filter(p => p.active);
  const list = (ps, f) => ps.map(p => `<div class="it"><i class="lamp ${p.lamp}"></i><span>${esc(p.name)}</span><span>${p.stock} St</span><span>${f(p)}</span></div>`).join('');
  const red = act.filter(p => p.lamp === 'r'), yel = act.filter(p => p.lamp === 'y');
  const soon = d.mhd.filter(m => (pd(m.mhd) - t) / 864e5 < 14);
  const cheap = act.filter(p => p.cost_cents && p.price_cents < p.cost_cents);
  const wk = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][t.getDay()];
  return `<div class="paper">${head(`${wk} ${t.toLocaleDateString('de-DE')} · KW ${isoWeek(t)[1]}`)}
    ${ln('KASSENSTAND', eur(stand), 'big' + (stand < 0 ? ' neg' : ''))}
    ${ln('Einnahmen Monat', eur(sum(j => j.day.startsWith(ym), 'in_cents')))}
    ${ln('Ausgaben Monat', eur(sum(j => j.day.startsWith(ym), 'out_cents')))}
    ${ln('Offene Schuldscheine', eur(offen))}
    ${ln('Fehlbetrag letzte Zählung', fehl)}
    ${d.alerts.length ? '<hr><h2 class="neg">Hinweise</h2>' + d.alerts.map(a => `<div class="it"><i class="lamp r"></i><span>${esc(a.text)} <span class="mut">(${new Date(a.at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })})</span></span><span></span><span><button class="btn sm" data-a="a-seen" data-id="${a.id}">OK</button></span></div>`).join('') : ''}
    <hr><h2>Nachbestellen (${red.length})</h2>${list(red, p => p.reachTxt) || '<p class="mut">Nichts.</p>'}
    ${yel.length ? `<hr><h2>Wird knapp (${yel.length})</h2>${list(yel, p => p.reachTxt)}` : ''}
    ${soon.length ? `<hr><h2>Läuft ab (${soon.length})</h2>` + soon.map(m => `<div class="it"><i class="lamp ${pd(m.mhd) < t ? 'r' : 'y'}"></i><span>${esc(pname(m.product_id))}</span><span>${m.qty} St</span><span>${dshort(m.mhd)}</span></div>`).join('') : ''}
    ${cheap.length ? `<hr><h2>Unter Einkaufspreis (${cheap.length})</h2>` + cheap.map(p => `<div class="it"><i class="lamp y"></i><span>${esc(p.name)}</span><span>VK ${eur(p.price_cents)}</span><span>EK ${eur(p.cost_cents)}</span></div>`).join('') : ''}
    <hr>${ln('Im grünen Bereich', act.filter(p => p.lamp === 'g').length + ' Artikel')}
    ${act.length ? '' : '<p class="small mut">Noch kein Produkt ist aktiv. Trage unter Regal Preise ein und schalte Produkte frei.</p>'}
    </div>
    <div class="paper"><div class="row"><button class="btn pri" data-a="a-go" data-t="regal">Zählen</button><button class="btn" data-a="a-go" data-t="einkauf">Einkauf</button><button class="btn" data-a="a-go" data-t="leute">Zahlung</button></div></div>
    <div class="paper"><h2>An Claude</h2><p class="small mut">Verbesserung, Fehler oder Auftrag eintippen oder über das Mikrofon der Tastatur diktieren. Claude liest das beim nächsten Durchlauf.</p>
      ${d.requests.map(q => `<div class="it"><i class="lamp ${q.status === 'neu' ? 'y' : q.status === 'erledigt' ? 'g' : 'r'}"></i><span>${esc(q.text)}${q.answer ? `<br><span class="mut">Claude: ${esc(q.answer)}</span>` : ''}</span><span></span><span class="mut">${dshort(q.at.slice(0, 10))}</span></div>`).join('')}
      <div class="row"><button class="btn pri" data-a="a-req">Nachricht an Claude</button></div></div>`;
}

function vRegal() {
  const d = A.d, prop = A.job && A.job.result ? Object.fromEntries(A.job.result.map(x => [x.id, x.qty])) : {};
  const rows = d.products.filter(p => A.counting ? p.active : true).map(p => A.counting
    ? `<div class="it"><i class="lamp ${p.lamp}"></i><span>${esc(p.name)}</span><span class="mut">soll ${p.stock}${p.id in prop ? ' · Foto ' + prop[p.id] : ''}</span><span><input class="cnt" type="number" inputmode="numeric" min="0" data-cnt="${p.id}" value="${p.id in prop ? prop[p.id] : p.stock}" aria-label="Gezählt ${esc(p.name)}"></span></div>`
    : `<button class="it" data-a="a-prod" data-id="${p.id}"><i class="lamp ${p.active ? p.lamp : 'o'}"></i><span>${esc(p.name)}${p.active ? '' : ' <span class="mut">(aus)</span>'}${p.sale_cents != null ? ' <b class="neg">%</b>' : ''}</span><span>${p.stock} St · ${p.reachTxt}</span><span>${eur(p.price_cents)}</span></button>`).join('');
  return `<div class="paper"><h2>${A.counting ? 'Bestand zählen' : 'Regal'}</h2>
    <p class="small mut">${A.counting ? 'Trage ein, was wirklich im Regal steht. Die Differenz zum Soll zählt als Barverkauf oder Schwund.' + (A.job ? ' Die Felder sind mit dem Vorschlag aus dem Foto gefüllt' + (A.job.note ? ': ' + esc(A.job.note) : '.') : '') : 'Antippen zum Bearbeiten. Reichweite = Bestand ÷ Wochenverkauf der letzten 4 Wochen.'}</p>
    ${rows}
    <div class="row">${A.counting ? '<button class="btn" data-a="a-cnt-x">Abbrechen</button><button class="btn pri" data-a="a-cnt-ok">Zählung speichern</button>'
      : '<button class="btn pri" data-a="a-cnt">Zählen</button><button class="btn" data-a="a-foto">Regalfoto</button><button class="btn" data-a="a-prod" data-id="">Neues Produkt</button>'}</div>
    ${A.counting ? '' : '<input type="file" id="foto" accept="image/*" multiple hidden>' + d.jobs.map(j => `<div class="it"><i class="lamp ${j.status === 'vorschlag' ? 'g' : 'y'}"></i><span>Foto vom ${dshort(j.at.slice(0, 10))}: ${j.status === 'vorschlag' ? 'Vorschlag liegt vor' : 'wartet auf Auswertung'}</span><span></span><span>${j.status === 'vorschlag' ? `<button class="btn sm" data-a="a-job" data-id="${j.id}">Prüfen</button>` : `<button class="btn sm" data-a="a-jobdel" data-id="${j.id}">Löschen</button>`}</span></div>`).join('')}</div>
    ${A.counting ? '' : `<div class="paper"><h2>Wunschliste</h2>${d.wishes.length ? d.wishes.map(w => ({ ...w, n: (w.wish_votes[0] || {}).count || 0 })).sort((a, b) => b.n - a.n).map(w =>
      `<div class="it"><i></i><span>${esc(w.text)}</span><span>${w.n} Stimmen</span><span><button class="btn sm" data-a="a-wish" data-id="${w.id}">Erledigt</button></span></div>`).join('') : '<p class="mut">Keine Wünsche.</p>'}</div>
    <div class="paper"><h2>Ampel</h2>${ln('Rot unter', String(d.rot).replace('.', ',') + ' Wochen')}${ln('Gelb unter', String(d.gelb).replace('.', ',') + ' Wochen')}
      <div class="row"><button class="btn" data-a="a-amp">Schwellen ändern</button></div></div>`}`;
}

const prodOpts = () => A.d.products.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
const cartRow = () => `<div class="cart"><select aria-label="Produkt"><option value="">Produkt …</option>${prodOpts()}</select>
  <input type="number" inputmode="numeric" min="1" placeholder="Stk" aria-label="Stück"><input inputmode="decimal" placeholder="€ ges." aria-label="Preis gesamt in Euro">
  <input type="date" aria-label="Mindesthaltbarkeit"></div>`;

function vEinkauf() {
  const d = A.d, t = new Date();
  return `<div class="paper"><h2>Einkauf erfassen</h2>
    <label for="eday">Datum</label><input id="eday" type="date" value="${iso(t)}">
    <label for="estore">Laden</label><input id="estore" placeholder="z. B. Rewe" autocomplete="off">
    <p class="small mut">Je Zeile: Produkt, Stückzahl, Gesamtpreis, darunter das Haltbarkeitsdatum (optional).</p>
    <div id="cart">${cartRow()}${cartRow()}</div>
    <div class="row"><button class="btn" data-a="a-cart">Zeile dazu</button><button class="btn pri" data-a="a-buy">Einkauf speichern</button></div></div>
    <div class="paper"><h2>Haltbarkeit</h2>${d.mhd.length ? d.mhd.map(m => { const days = Math.ceil((pd(m.mhd) - t) / 864e5); return `<div class="it"><i class="lamp ${days < 0 ? 'r' : days < 14 ? 'y' : 'g'}"></i><span>${esc(pname(m.product_id))} · ${m.qty} St</span><span>${dshort(m.mhd)} (${days < 0 ? 'abgelaufen' : days + ' T'})</span>
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
  return `<div class="paper"><h2>Einnahmen und Ausgaben</h2>
    <div class="seg">${[['week', 'Woche'], ['month', 'Monat'], ['year', 'Jahr']].map(([k, l]) => `<button data-a="a-span" data-s="${k}" class="${A.span === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${chart(bs)}<p class="small mut">Schwarz: Einnahmen · Rot: Ausgaben</p>
    <table><tr><th>Zeitraum</th><th>Ein</th><th>Aus</th><th>Saldo</th></tr>${bs.slice().reverse().map(b => `<tr><td>${esc(A.span === 'year' ? b.label : b.label + ' ' + b.key.slice(2, 4))}</td><td>${eur(b.i)}</td><td>${eur(b.o)}</td><td class="${b.i - b.o < 0 ? 'neg' : ''}">${eur(b.i - b.o)}</td></tr>`).join('')}</table>
    <div class="row"><button class="btn pri" data-a="a-cash">Kassensturz</button><button class="btn" data-a="a-jour">Buchung von Hand</button></div></div>
    <div class="paper"><h2>Verkauf letzte 4 Wochen</h2>${sales.length ? sales.map(x => ln(esc(x.n), x.u + ' St')).join('') : '<p class="mut">Noch keine Verkaufsdaten. Sie entstehen durch QR-Buchungen und Zählungen.</p>'}</div>
    <div class="paper"><h2>Letzte Buchungen</h2>${d.journal.slice(0, 25).map(j => `<div class="it"><i></i><span>${dshort(j.day)} ${esc(j.text)}</span><span></span><span class="${j.out_cents ? 'neg' : ''}">${j.out_cents ? '−' + eur(j.out_cents) : eur(j.in_cents)}</span></div>`).join('')}</div>`;
}

function vLeute() {
  const d = A.d, d30 = iso(new Date(Date.now() - 30 * 864e5));
  const ps = d.persons.map(p => {
    const l = d.ledger.filter(x => x.person_id === p.id);
    return { ...p, saldo: l.reduce((a, x) => a + x.amount_cents, 0), u30: l.filter(x => x.kind === 'kauf' && x.day >= d30).reduce((a, x) => a + x.amount_cents, 0), all: l.filter(x => x.kind === 'kauf').reduce((a, x) => a + x.amount_cents, 0) };
  });
  const url = location.origin + location.pathname + '?k=' + (d.set.kiosk_code || '');
  let qr = '';
  try { const q = qrcode(0, 'M'); q.addData(url); q.make(); qr = q.createSvgTag({ cellSize: 5, margin: 2 }); } catch { qr = ''; }
  return `<div class="paper"><h2>Schuldscheine</h2>${ps.length ? ps.slice().sort((a, b) => b.saldo - a.saldo).map(p =>
    `<div class="it"><i class="lamp ${p.locked_until && new Date(p.locked_until) > new Date() ? 'r' : p.consent_at ? 'g' : 'o'}"></i><span>${esc(p.vorname)}</span><span class="${p.saldo > 0 ? '' : 'mut'}">${eur(p.saldo)}</span>
     <span><button class="btn sm" data-a="a-pay" data-id="${p.id}">Zahlung</button> <button class="btn sm" data-a="a-more" data-id="${p.id}">…</button></span></div>`).join('') : '<p class="mut">Noch niemand eingetragen.</p>'}
    <p class="small mut">Grün: hat zugestimmt · leer: noch nicht angemeldet · rot: gerade gesperrt</p>
    <div class="row"><button class="btn pri" data-a="a-person">Person eintragen</button><button class="btn" data-a="a-persons">Mehrere als Liste</button></div></div>
    <div class="paper"><h2>Rangliste Umsatz</h2><table><tr><th>Vorname</th><th>30 Tage</th><th>Gesamt</th></tr>${ps.slice().sort((a, b) => b.u30 - a.u30 || b.all - a.all).map(p => `<tr><td>${esc(p.vorname)}</td><td>${eur(p.u30)}</td><td>${eur(p.all)}</td></tr>`).join('')}</table></div>
    <div class="paper"><h2>QR-Code für den Kiosk</h2><p class="small mut">Aushängen oder auf einen NFC-Chip schreiben. Nur wer diesen Code hat, sieht die Namensliste.</p><div class="qr">${qr}</div>
      <p class="small brk">${esc(url)}</p><div class="row"><button class="btn" data-a="a-copy" data-u="${esc(url)}">Link kopieren</button><button class="btn" data-a="a-out">Abmelden</button></div></div>`;
}

const reload = async () => { await aLoad(); aRender(); };
const aActs = {
  'a-tab': el => { A.tab = el.dataset.t; A.counting = false; A.job = null; aRender(); },
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
      { k: 'active', label: 'Im Kiosk sichtbar', type: 'select', value: p.active ? '1' : '0', options: [['1', 'Ja'], ['0', 'Nein']] }],
      'Speichern', p.cost_cents ? `<p class="small mut">Letzter Einkaufspreis: ${eur(p.cost_cents)} € je Stück</p>` : '');
    if (!v || !v.name.trim()) return;
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
  'a-cart': () => { $('#cart').insertAdjacentHTML('beforeend', cartRow()); },
  'a-buy': async () => {
    const items = [];
    for (const row of document.querySelectorAll('#cart .cart')) {
      const [sel, q, e, m] = row.querySelectorAll('select,input');
      if (!sel.value) continue;
      const qty = parseInt(q.value, 10), c = cents(e.value);
      if (!(qty > 0) || c === null) return toast('Bitte Stückzahl und Gesamtpreis für jede Zeile eintragen.');
      items.push({ id: sel.value, qty, cents: c, mhd: m.value || '' });
    }
    if (!items.length) return toast('Mindestens ein Produkt auswählen.');
    await rpc('a_purchase', { p_day: $('#eday').value, p_store: $('#estore').value.trim(), p_items: items });
    toast('Einkauf gespeichert.'); await reload();
  },
  'a-mhd': async el => {
    const v = await ask(pname(el.dataset.p), [{ k: 'a', label: 'Was ist passiert?', type: 'select', options: [['sale', 'Reduziert anbieten'], ['done', 'Verkauft, Hinweis erledigt'], ['waste', 'Entsorgt (als Verlust buchen)']] },
      { k: 'x', label: 'Abverkaufspreis € bzw. entsorgte Stückzahl', value: '', mode: 'decimal' }], 'Übernehmen');
    if (!v) return;
    if (v.a === 'sale') { const c = cents(v.x); if (!(c > 0)) return toast('Bitte einen Abverkaufspreis eintragen.'); ok(await SB.from('products').update({ sale_cents: c }).eq('id', el.dataset.p)); }
    else {
      if (v.a === 'waste') await rpc('a_waste', { p_product: el.dataset.p, p_qty: parseInt(v.x, 10) || Number(el.dataset.q) });
      ok(await SB.from('purchase_items').update({ mhd_done: true }).eq('id', el.dataset.id));
      ok(await SB.from('products').update({ sale_cents: null }).eq('id', el.dataset.p));
    }
    await reload();
  },
  'a-cash': async () => {
    const v = await ask('Kassensturz', [{ k: 'c', label: 'Bargeld, das seit der letzten Zählung in die Kasse kam (€)', mode: 'decimal' }], 'Buchen',
      '<p class="small mut">Am besten direkt nach dem Zählen des Regals. Die App vergleicht den Betrag mit der Ware, die laut Zählung ohne Buchung fehlt.</p>');
    const c = v && cents(v.c); if (c === null || c === false || c < 0) return;
    await rpc('a_cash', { p_cents: c }); toast('Kassensturz gebucht.'); await reload();
  },
  'a-jour': async () => {
    const v = await ask('Buchung von Hand', [{ k: 'd', label: 'Datum', type: 'date', value: iso(new Date()) }, { k: 't', label: 'Text' }, { k: 'i', label: 'Einnahme €', mode: 'decimal' }, { k: 'o', label: 'Ausgabe €', mode: 'decimal' }]);
    if (!v || !v.t.trim()) return;
    ok(await SB.from('journal').insert({ day: v.d, text: v.t.trim(), in_cents: cents(v.i) || 0, out_cents: cents(v.o) || 0, source: 'hand' })); await reload();
  },
  'a-person': async () => {
    const v = await ask('Person eintragen', [{ k: 'n', label: 'Vorname (nur Vorname)' }, { k: 'p', label: 'Start-PIN (4 Ziffern, persönlich übergeben)', mode: 'numeric', max: 4 }]);
    if (!v || !v.n.trim()) return;
    if (!/^\d{4}$/.test(v.p)) return toast('Die PIN braucht genau 4 Ziffern.');
    await rpc('a_person', { p_vorname: v.n.trim().split(/\s+/)[0], p_pin: v.p }); await reload();
  },
  'a-pay': async el => {
    const p = A.d.persons.find(x => x.id === el.dataset.id);
    const v = await ask('Zahlung von ' + p.vorname, [{ k: 'c', label: 'Erhaltener Betrag €', mode: 'decimal' }], 'Zahlung buchen');
    const c = v && cents(v.c); if (!c || c <= 0) return;
    await rpc('a_pay', { p_person: p.id, p_cents: c }); toast('Zahlung gebucht.'); await reload();
  },
  'a-more': async el => {
    const p = A.d.persons.find(x => x.id === el.dataset.id);
    const v = await ask(p.vorname, [{ k: 'a', label: 'Aktion', type: 'select', options: [['pin', 'Neue PIN setzen (hebt Sperre auf)'], ['fix', 'Schuldschein korrigieren (+ / −)'], ['del', 'Person löschen (nur bei 0,00 €)']] },
      { k: 'x', label: 'Neue PIN bzw. Korrekturbetrag €', mode: 'decimal' }], 'Ausführen');
    if (!v) return;
    if (v.a === 'pin') { if (!/^\d{4}$/.test(v.x)) return toast('Die PIN braucht genau 4 Ziffern.'); await rpc('a_pin', { p_person: p.id, p_pin: v.x }); toast('Neue PIN gesetzt.'); }
    else if (v.a === 'fix') { const c = cents(v.x); if (!c) return toast('Bitte einen Betrag eintragen, z. B. −1,50.'); await rpc('a_fix', { p_person: p.id, p_cents: c }); }
    else toast(await rpc('a_person_delete', { p_person: p.id }) ? 'Person gelöscht.' : 'Nicht gelöscht: Der Schuldschein ist nicht ausgeglichen.');
    await reload();
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
  if (a === 'go-admin') { location.hash = '#verwaltung'; return aLoginScreen(); }
  const fn = kActs[a] || aActs[a]; if (!fn || busy) return;
  busy = true;
  try { await fn(el); } catch (err) { console.error(err); toast('Das hat nicht geklappt: ' + (err.message || 'Fehler')); }
  busy = false;
});
async function shrink(file) {
  const bmp = await createImageBitmap(file), k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
}
document.addEventListener('change', async e => {
  if (e.target.id !== 'foto' || !e.target.files.length) return;
  try {
    toast('Fotos werden hochgeladen …');
    const paths = [];
    for (const f of [...e.target.files].slice(0, 8)) {
      const path = `regal/${crypto.randomUUID()}.jpg`;
      ok(await SB.storage.from('fotos').upload(path, await shrink(f), { contentType: 'image/jpeg' }));
      paths.push(path);
    }
    ok(await SB.from('photo_jobs').insert({ paths }));
    toast(`${paths.length} Foto${paths.length === 1 ? '' : 's'} gespeichert. Der Vorschlag erscheint hier nach der Auswertung.`);
    await reload();
  } catch (err) { console.error(err); toast('Hochladen hat nicht geklappt: ' + (err.message || 'Fehler')); }
});
(async function boot() {
  try {
    const u = new URL(location.href), k = u.searchParams.get('k');
    if (k) { LS.set('kcode', k); history.replaceState(null, '', u.pathname); }
    const { data: { session } } = await SB.auth.getSession();
    if (!k && (session || /verwaltung|access_token/.test(location.hash))) return await aBoot(session);
    K.code = LS.get('kcode');
    if (!K.code) return landing();
    await kBoot();
  } catch (err) { console.error(err); landing('Die App erreicht die Datenbank gerade nicht. Bitte später erneut versuchen.'); }
})();
window.addEventListener('hashchange', () => { if (/verwaltung/.test(location.hash) && nav.hidden && !$('#alog')) location.reload(); });
