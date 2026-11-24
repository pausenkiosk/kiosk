'use strict';
/* Produktbilder für die Kachel-Ansicht: einfache Zeichnungen (Dose, Flasche, Riegel, Tafel, Tüte, Becher, Waffel),
   eingefärbt nach Produkt. Bewusst ohne Markenlogos, nur Form und Farbe. */
(function () {
  const RULES = [
    // [Stichwort im Namen, Form, Hauptfarbe, Akzent]
    ['cola zero', 'can', '#1b1b1b', '#e41e2b'], ['cola light', 'can', '#c9ccd1', '#e41e2b'], ['vita cola', 'can', '#f2a900', '#c8102e'],
    ['cola', 'can', '#e41e2b', '#ffffff'], ['red bull', 'can', '#2b4c9b', '#c9ccd1'], ['monster energy zero', 'can', '#e6e6e6', '#79c143'],
    ['monster', 'can', '#151515', '#79c143'], ['effect', 'can', '#222222', '#8e44ad'], ['m-150', 'bottle', '#c0392b', '#f1c40f'],
    ['lipton ice tea zero', 'can', '#f6d600', '#1d6fb8'], ['lipton', 'can', '#f6d600', '#e3001b'], ['vitaminwasser', 'bottle', '#c2185b', '#f8bbd0'],
    ['apfelschorle', 'bottle', '#7cb342', '#dcedc8'], ['spezi', 'bottle', '#f39200', '#5d4037'], ['fassbrause', 'bottle', '#ffb300', '#6d4c41'],
    ['jarritos', 'bottle', '#ff7043', '#ffe0b2'], ['protein shake', 'bottle', '#455a64', '#cfd8dc'],
    ['twix', 'bar', '#c8102e', '#d4a017'], ['snickers', 'bar', '#5b3a29', '#1d4f9c'], ['mars', 'bar', '#111111', '#c8102e'],
    ['corny big chocolate banane', 'bar', '#f7d117', '#5b3a29'], ['corny big karamell', 'bar', '#c68a3e', '#f3e3c3'],
    ['corny big schoko', 'bar', '#5b3a29', '#f7d117'], ['corny', 'bar', '#e4003a', '#f8d7da'], ['golden bridge', 'bar', '#d9c7a3', '#7a5c2e'],
    ['protein', 'bar', '#222222', '#f39200'], ['mr. tom', 'bar', '#f6c343', '#8d5524'],
    ['knoppers himbeer', 'waffle', '#ffffff', '#e85a8b'], ['knoppers joghurt', 'waffle', '#ffffff', '#7fb6e0'], ['knoppers', 'waffle', '#ffffff', '#1d4f9c'],
    ['choceur', 'choc', '#6b2e1f', '#d9b38c'], ['kinder', 'choc', '#ffffff', '#e30613'],
    ['haribo', 'bag', '#f2c200', '#e30613'], ['m&m', 'bag', '#5b3a29', '#f2c200'], ['beef jerky', 'bag', '#ece8e1', '#5a3a22'],
    ['ültje', 'bag', '#1d6fb8', '#f2b134'], ['alesto', 'bag', '#2e7d32', '#ffcc80'], ['nüsse', 'bag', '#8d6e63', '#ffcc80'],
    ['algen', 'bag', '#2e7d32', '#a5d6a7'], ['nudel', 'cup', '#d71920', '#fff3e0']
  ];
  const BY_CAT = { 'Getränke': ['can', '#607d8b', '#eceff1'], 'Energy': ['can', '#263238', '#c0ca33'], 'Süßes': ['bar', '#8d6e63', '#ffe0b2'], 'Herzhaft': ['bag', '#795548', '#ffe0b2'] };

  function look(p) {
    // Stichwort muss am Wortanfang stehen, sonst passt z. B. „cola“ auf „Chocolate“
    const n = ' ' + (p.name || '').toLowerCase().replace(/[-_/]/g, ' ');
    for (const [k, shape, a, b] of RULES) if (n.includes(' ' + k)) return [shape, a, b];
    return BY_CAT[p.cat] || ['bag', '#78909c', '#eceff1'];
  }
  const ln = '#1b1b1b';
  const SHAPES = {
    can: (a, b) => `<ellipse cx="50" cy="86" rx="20" ry="5" fill="#000" opacity=".12"/>
      <rect x="30" y="18" width="40" height="66" rx="7" fill="${a}" stroke="${ln}" stroke-width="2.5"/>
      <rect x="30" y="40" width="40" height="18" fill="${b}" stroke="${ln}" stroke-width="2.5"/>
      <ellipse cx="50" cy="18" rx="20" ry="5" fill="#d7d9dc" stroke="${ln}" stroke-width="2.5"/>
      <rect x="37" y="23" width="5" height="54" rx="2.5" fill="#fff" opacity=".35"/>`,
    bottle: (a, b) => `<ellipse cx="50" cy="88" rx="17" ry="4" fill="#000" opacity=".12"/>
      <path d="M44 12h12v12c0 4 10 8 10 18v40a6 6 0 0 1-6 6H40a6 6 0 0 1-6-6V42c0-10 10-14 10-18z" fill="${a}" stroke="${ln}" stroke-width="2.5"/>
      <rect x="42" y="8" width="16" height="7" rx="2" fill="${b}" stroke="${ln}" stroke-width="2.5"/>
      <rect x="34" y="50" width="32" height="18" fill="${b}" stroke="${ln}" stroke-width="2.5"/>
      <rect x="39" y="30" width="5" height="50" rx="2.5" fill="#fff" opacity=".3"/>`,
    bar: (a, b) => `<ellipse cx="50" cy="74" rx="36" ry="5" fill="#000" opacity=".12"/>
      <g transform="rotate(-14 50 50)">
        <path d="M14 38l4 4-4 4 4 4-4 4 4 4-4 4h72l-4-4 4-4-4-4 4-4-4-4 4-4-4-4z" fill="${a}" stroke="${ln}" stroke-width="2.5" stroke-linejoin="round"/>
        <rect x="32" y="42" width="36" height="20" rx="3" fill="${b}" stroke="${ln}" stroke-width="2"/>
        <rect x="20" y="40" width="60" height="4" fill="#fff" opacity=".3"/></g>`,
    choc: (a, b) => `<ellipse cx="50" cy="86" rx="26" ry="4" fill="#000" opacity=".12"/>
      <rect x="24" y="14" width="52" height="70" rx="4" fill="${a}" stroke="${ln}" stroke-width="2.5"/>
      <path d="M24 30h52M24 46h52M24 62h52M41 14v70M59 14v70" stroke="${b}" stroke-width="2" opacity=".7"/>
      <rect x="24" y="64" width="52" height="20" rx="2" fill="${b}" stroke="${ln}" stroke-width="2.5"/>`,
    waffle: (a, b) => `<ellipse cx="50" cy="80" rx="32" ry="4" fill="#000" opacity=".12"/>
      <rect x="18" y="26" width="64" height="50" rx="6" fill="${a}" stroke="${ln}" stroke-width="2.5"/>
      <rect x="18" y="26" width="64" height="16" rx="6" fill="${b}" stroke="${ln}" stroke-width="2.5"/>
      <path d="M30 52h40M30 62h40M38 46v26M50 46v26M62 46v26" stroke="#d8b27a" stroke-width="3" stroke-linecap="round"/>`,
    bag: (a, b) => `<ellipse cx="50" cy="88" rx="26" ry="4" fill="#000" opacity=".12"/>
      <path d="M26 16h48l-3 8 5 56a6 6 0 0 1-6 7H30a6 6 0 0 1-6-7l5-56z" fill="${a}" stroke="${ln}" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M26 16l3 8h42l3-8" fill="${b}" stroke="${ln}" stroke-width="2.5" stroke-linejoin="round"/>
      <circle cx="50" cy="54" r="14" fill="${b}" stroke="${ln}" stroke-width="2.5"/>`,
    cup: (a, b) => `<ellipse cx="50" cy="88" rx="22" ry="4" fill="#000" opacity=".12"/>
      <path d="M38 22c-2-6 4-8 2-14M50 22c-2-6 4-8 2-14M62 22c-2-6 4-8 2-14" stroke="#9e9e9e" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <path d="M22 32h56l-8 52a5 5 0 0 1-5 4H35a5 5 0 0 1-5-4z" fill="${a}" stroke="${ln}" stroke-width="2.5" stroke-linejoin="round"/>
      <rect x="20" y="26" width="60" height="9" rx="3" fill="${b}" stroke="${ln}" stroke-width="2.5"/>
      <path d="M30 52h40" stroke="${b}" stroke-width="5"/>`
  };
  window.productIcon = function (p) {
    const img = (window.PRODUCT_IMAGES || {})[p.name];
    if (img) return `<img src="img/${encodeURI(img)}" alt="" loading="lazy" decoding="async">`;
    const [shape, a, b] = look(p);
    return `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">${SHAPES[shape](a, b)}</svg>`;
  };
})();
