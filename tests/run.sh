#!/usr/bin/env bash
# Testlauf der Kiosk-App gegen das Supabase-TESTprojekt.
#
# Benötigte Umgebungsvariablen (stehen bewusst nicht im Repository):
#   KIOSK_TEST_REF        Kennung des Testprojekts (der Teil vor .supabase.co)
#   KIOSK_TEST_KEY        öffentlicher Schlüssel (publishable/anon) des Testprojekts
#   KIOSK_TEST_ADMIN_PW   Passwort für den Test-Verwalter (frei wählbar, mind. 10 Zeichen)
# Optional:
#   KIOSK_TEST_ADMIN_EMAIL  Standard: verwalter@kiosk-test.invalid
#   KIOSK_TEST_GAST_EMAIL   Standard: gast@kiosk-test.invalid (Konto ohne Verwalter-Rechte)
#   KIOSK_TEST_CODE         Kiosk-Code für den QR-Link, Standard: TESTKIOSK2468
#   SUPABASE_ACCESS_TOKEN   Verwaltungs-Token fürs Einspielen der Testdaten
#                           (in der Cloud-Sitzung setzt der Proxy ihn ein, dann weglassen)
#   KIOSK_APP_REF           Git-Stand, dessen App getestet wird (z. B. origin/next). Ohne Angabe: Dateien im Arbeitsordner.
#   KIOSK_SKIP_SEED=1       Testdaten nicht neu einspielen
#   KIOSK_TEST_PORT         Standard: 8765
#
# Aufruf: tests/run.sh [sperren|kollege|verwalter|kasse|guthaben|wunsch|auszahlung|info|grenzen|uebergang ...]   (ohne Angabe: alles)
set -euo pipefail
cd "$(dirname "$0")/.."

ECHT="kglxlmjhrzeaswqadfnn"   # echtes Projekt: wird nie angesprochen
: "${KIOSK_TEST_REF:?KIOSK_TEST_REF fehlt}"
: "${KIOSK_TEST_KEY:?KIOSK_TEST_KEY fehlt}"
: "${KIOSK_TEST_ADMIN_PW:?KIOSK_TEST_ADMIN_PW fehlt}"
export KIOSK_TEST_ADMIN_EMAIL="${KIOSK_TEST_ADMIN_EMAIL:-verwalter@kiosk-test.invalid}"
export KIOSK_TEST_GAST_EMAIL="${KIOSK_TEST_GAST_EMAIL:-gast@kiosk-test.invalid}"   # Konto ohne Verwalter-Rechte
export KIOSK_TEST_CODE="${KIOSK_TEST_CODE:-TESTKIOSK2468}"
PORT="${KIOSK_TEST_PORT:-8765}"

if [ "$KIOSK_TEST_REF" = "$ECHT" ]; then
  echo "ABBRUCH: KIOSK_TEST_REF ist das echte Projekt. Tests laufen nur gegen das Testprojekt." >&2; exit 2
fi
if ! [[ "$KIOSK_TEST_REF" =~ ^[a-z0-9]{20}$ ]]; then echo "ABBRUCH: KIOSK_TEST_REF sieht nicht wie eine Projektkennung aus." >&2; exit 2; fi
for v in KIOSK_TEST_ADMIN_EMAIL KIOSK_TEST_GAST_EMAIL KIOSK_TEST_ADMIN_PW KIOSK_TEST_CODE; do
  if [[ "${!v}" == *"'"* || "${!v}" == *"\\"* ]]; then echo "ABBRUCH: $v darf kein ' und kein \\ enthalten." >&2; exit 2; fi
done

# 1) Testdaten einspielen (Verwaltungs-API, nur Testprojekt)
if [ "${KIOSK_SKIP_SEED:-}" != "1" ]; then
  echo "Spiele Testdaten in $KIOSK_TEST_REF ein …"
  python3 - "$KIOSK_TEST_REF" <<'PY' | curl -sS --fail-with-body -X POST \
      "https://api.supabase.com/v1/projects/$KIOSK_TEST_REF/database/query" \
      -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-proxy-injected}" \
      -H 'Content-Type: application/json' --data-binary @- >/dev/null
import json, os
sql = open('tests/seed.sql', encoding='utf-8').read()
for k, v in (('__ADMIN_EMAIL__', 'KIOSK_TEST_ADMIN_EMAIL'), ('__GAST_EMAIL__', 'KIOSK_TEST_GAST_EMAIL'), ('__ADMIN_PW__', 'KIOSK_TEST_ADMIN_PW'), ('__KIOSK_CODE__', 'KIOSK_TEST_CODE')):
    sql = sql.replace(k, os.environ[v])
print(json.dumps({'query': sql}))
PY
fi

# 2) Kopie der App erzeugen, die auf das Testprojekt zeigt (Repository-Dateien bleiben unverändert)
TMP="$(mktemp -d)"
SRV=""
cleanup() { [ -n "$SRV" ] && kill "$SRV" 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT
if [ -n "${KIOSK_APP_REF:-}" ]; then
  echo "App-Fassung: $KIOSK_APP_REF ($(git rev-parse --short "$KIOSK_APP_REF"))"
  git archive "$KIOSK_APP_REF" index.html app.js style.css vendor icon-180.png icon-512.png | tar -x -C "$TMP"
else
  cp -r index.html app.js style.css vendor icon-180.png icon-512.png "$TMP/"
fi
echo "Getestet wird $(grep -o 'app.js?v=[0-9]*' "$TMP/index.html")"
python3 - "$TMP" "$ECHT" <<'PY'
import os, re, sys
tmp, echt = sys.argv[1], sys.argv[2]
ref, key = os.environ['KIOSK_TEST_REF'], os.environ['KIOSK_TEST_KEY']
p = os.path.join(tmp, 'app.js'); s = open(p, encoding='utf-8').read()
s, n = re.subn(r"supabase\.createClient\('https://[a-z0-9]+\.supabase\.co',\s*'[^']+'\)",
               lambda m: "supabase.createClient('https://%s.supabase.co', '%s')" % (ref, key), s)
assert n == 1, 'createClient-Zeile in app.js nicht gefunden'
open(p, 'w', encoding='utf-8').write(s)
p = os.path.join(tmp, 'index.html'); h = open(p, encoding='utf-8').read()
assert echt in h, 'Projektadresse in index.html nicht gefunden'
open(p, 'w', encoding='utf-8').write(h.replace(echt, ref))
for f in ('app.js', 'index.html'):
    assert echt not in open(os.path.join(tmp, f), encoding='utf-8').read(), 'echtes Projekt noch in ' + f
PY

# 3) Lokal ausliefern
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$TMP" >/dev/null 2>&1 &
SRV=$!
for _ in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT/index.html" && break; sleep 0.1; done

# 4) Tests starten
export KIOSK_TEST_URL="http://127.0.0.1:$PORT/index.html"
NODE_PATH="${NODE_PATH:-$(npm root -g 2>/dev/null || true)}" node tests/run.js "$@"
