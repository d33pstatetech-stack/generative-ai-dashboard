#!/usr/bin/env bash
# Push Modal spend/balance into the Generative AI Dashboard's manual slot.
# No secrets in this file. Required env:
#   DASHBOARD_URL  e.g. https://generative-ai-dashboard.<sub>.workers.dev
# Optional (Cloudflare Access service token, once the dashboard is Access-locked):
#   CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET
# Usage:
#   ./push-modal-billing.sh            # uses `modal billing summary --json`
#   ./push-modal-billing.sh 12.34      # manual value instead
set -euo pipefail
: "${DASHBOARD_URL:?set DASHBOARD_URL first}"

AUTH_ARGS=()
if [[ -n "${CF_ACCESS_CLIENT_ID:-}" && -n "${CF_ACCESS_CLIENT_SECRET:-}" ]]; then
  AUTH_ARGS=(-H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET")
fi

if [[ $# -ge 1 ]]; then
  VALUE="$1"
else
  if ! command -v modal >/dev/null 2>&1; then
    echo "modal CLI not found; pass a manual value: $0 12.34" >&2
    exit 1
  fi
  VALUE="$(modal billing summary --for "this month" --json 2>/dev/null | python3 -c \
    'import json,sys; d=json.load(sys.stdin); print(d.get("total_cost") or d.get("total") or "")' || true)"
  if [[ -z "$VALUE" ]]; then
    echo "could not parse modal output; pass a manual value: $0 12.34" >&2
    exit 1
  fi
fi

curl -sS -X PUT "$DASHBOARD_URL/api/balance/modal" \
  "${AUTH_ARGS[@]}" \
  -H 'Content-Type: application/json' \
  -d "{\"value\": $VALUE, \"note\": \"pushed from VPS $(date -u +%FT%TZ)\"}"
echo
