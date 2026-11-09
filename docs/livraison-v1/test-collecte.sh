#!/usr/bin/env bash
# Test de collecte comparatif KORA (livraison V1).
# À lancer pendant que l'application tourne en LOCAL, en mode démonstration :
#   SUPABASE_URL= bun run dev --port 5199
# Usage, depuis la racine du dépôt : bash ~/kora-tests/test-collecte.sh [port]   (port par défaut : 5199)
# Un seul lancement par démarrage du serveur : arrêter et relancer le serveur avant de recommencer.
# Résultat écrit dans ~/kora-tests/, jamais dans le dépôt.
# Le script refuse de s'exécuter si l'application n'est pas en mode démonstration :
# il ne peut donc pas écrire dans la base de production.
set -euo pipefail

PORT="${1:-5199}"
API="http://localhost:${PORT}/api"
JAR="$(mktemp)"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo inconnue)"
COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo inconnu)"
mkdir -p "$HOME/kora-tests"
OUT="$HOME/kora-tests/collecte-${BRANCH//\//_}-${COMMIT}-$(date +%Y%m%d-%H%M).txt"

call() { # méthode chemin [corps JSON]
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -s -m 120 -X "$method" -H 'content-type: application/json' -H 'x-kora-request: 1' \
      -c "$JAR" -b "$JAR" "${API}${path}" -d "$body"
  else
    curl -s -m 120 -X "$method" -H 'x-kora-request: 1' -c "$JAR" -b "$JAR" "${API}${path}"
  fi
}

MODE="$(call GET /auth/config | python3 -c 'import json,sys; print(json.load(sys.stdin).get("mode",""))' 2>/dev/null || true)"
if [ "$MODE" != "demo" ]; then
  echo "ARRÊT : l'application sur le port ${PORT} n'est pas en mode démonstration (mode reçu : '${MODE}')."
  echo "Relancer avec : SUPABASE_URL= bun run dev --port ${PORT}"
  exit 1
fi

# Jeu de contrôle : nom | domaine | source « Site officiel »
SET='Kalray|kalrayinc.com|https://www.kalrayinc.com/feed/
Keolabs|keolabs.com|https://www.keolabs.com/feed/
Digigram|digigram.com|https://www.digigram.com/feed/
Teem Photonics|teemphotonics.com|https://www.teemphotonics.com/feed/
HydroQuest|hydroquest.fr|https://www.hydroquest.fr/feed/
Naver Labs Europe|naverlabs.com|https://europe.naverlabs.com/feed/
Arturia|arturia.com|https://www.arturia.com/
Alpao|alpao.com|https://www.alpao.com/feed/'

# Les données de démonstration occupent déjà le quota de 150 entreprises :
# on retire 8 entreprises fictives sans signal (en mémoire seulement).
call GET /companies | python3 -c '
import json, sys
names = {"kalray","keolabs","digigram","teem photonics","hydroquest","naver labs europe","arturia","alpao"}
d = json.load(sys.stdin)
for c in [c for c in d if c.get("signalCount", 0) == 0 and c["name"].lower() not in names][:8]:
    print(c["id"])
' | while read -r id; do call DELETE "/companies/${id}" >/dev/null; done

echo "$SET" | while IFS='|' read -r name domain url; do
  call POST /companies "{\"name\":\"${name}\",\"domain\":\"${domain}\",\"sector\":\"Test\"}" >/dev/null
  cid="$(call GET /companies | python3 -c "import json,sys; print(next(c['id'] for c in json.load(sys.stdin) if c['name']=='${name}'))")"
  call POST /sources "{\"companyId\":\"${cid}\",\"type\":\"site_officiel\",\"label\":\"Site officiel — ${name}\",\"url\":\"${url}\"}" >/dev/null
done

{
  echo "Test de collecte — branche ${BRANCH} (${COMMIT}) — $(date '+%d/%m/%Y %H:%M')"
  echo
  printf '%-20s %-15s %-24s %8s  %-20s %s\n' "Entreprise" "Source" "Statut" "Nouvelles" "Code" "Message"
  START=$(date +%s)
  echo "$SET" | while IFS='|' read -r name domain url; do
    cid="$(call GET /companies | python3 -c "import json,sys; print(next(c['id'] for c in json.load(sys.stdin) if c['name']=='${name}'))")"
    call GET "/sources?companyId=${cid}" | python3 -c '
import json, sys
for s in json.load(sys.stdin): print(s["id"] + "|" + s["type"])
' | while IFS='|' read -r sid stype; do
      call POST "/sources/${sid}/collect" | python3 -c '
import json, sys
name, stype = sys.argv[1], sys.argv[2]
r = json.load(sys.stdin)
if "error" in r:
    e = r["error"]
    row = (name, stype, "REFUS API", "-", e.get("code") or "", (e.get("message") or "")[:70])
else:
    row = (name, stype, r.get("status") or "", str(r.get("newObservations", 0)),
           r.get("errorCode") or "", (r.get("errorMessage") or "")[:70])
print("%-20s %-15s %-24s %8s  %-20s %s" % row)
' "$name" "$stype"
    done
  done
  echo
  echo "Durée totale de collecte : $(( $(date +%s) - START )) s"
  echo
  echo "Refus de sécurité attendus (création de source) :"
  cid="$(call GET /companies | python3 -c "import json,sys; print(next(c['id'] for c in json.load(sys.stdin) if c['name']=='Keolabs'))")"
  for bad in "http://127.0.0.1/feed" "https://example.com:8443/feed"; do
    msg="$(call POST /sources "{\"companyId\":\"${cid}\",\"type\":\"site_officiel\",\"label\":\"Essai refus\",\"url\":\"${bad}\"}" \
      | python3 -c 'import json,sys; r=json.load(sys.stdin); print("REFUSÉE : " + r["error"]["message"] if "error" in r else "ACCEPTÉE (id " + r.get("id","?") + ")")')"
    echo "  ${bad} -> ${msg}"
  done
} | tee "$OUT"

rm -f "$JAR"
echo
echo "Résultat enregistré dans ${OUT}"
